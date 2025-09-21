import { test } from "node:test";
import assert from "node:assert/strict";

import type { Card, Fighter, Section } from "../src/game/types.js";
import type { PendingShopPurchase } from "../src/game/match/useMatchController.js";
import {
  chooseEnemyAssignments,
  settleFighterAfterRound,
  handleLegacyRemoteShopPurchase,
} from "../src/game/match/useMatchController.js";
import { addPurchasedCardToFighter, getCardSourceId } from "../src/player/profileStore.js";

const makeCard = (id: string): Card => ({
  id,
  name: id,
  type: "normal",
  number: 0,
  tags: [],
});

const makeValuedCard = (
  id: string,
  value: number,
  reserveValue = 0,
): Card => ({
  id,
  name: id,
  type: "normal",
  number: value,
  reserve:
    reserveValue > 0
      ? ({ type: "fixed", value: reserveValue } as Card["reserve"])
      : undefined,
  tags: [],
});

const makeSection = (id: Section["id"]): Section => ({
  id,
  color: "",
  start: 1,
  end: 15,
});

const makeFighter = (deck: Card[], hand: Card[], discard: Card[] = []): Fighter => ({
  name: "Testy",
  deck: [...deck],
  hand: [...hand],
  discard: [...discard],
});

test("enemy picker preserves high reserve cards on ReserveSum", () => {
  const reserveSection = [makeSection("ReserveSum")];
  const strongSection = [makeSection("Strongest")];
  const playerCard = makeValuedCard("player-strong", 2, 0);
  const playerHand = [playerCard, makeValuedCard("player-reserve", 0, 5)];

  const highReserve = makeValuedCard("enemy-keep", 4, 8);
  const lowReserve = makeValuedCard("enemy-play", 4, 1);
  const enemyHand = [highReserve, lowReserve];

  const picks = chooseEnemyAssignments({
    enemyHand,
    currentEnemyAssign: [null, null, null],
    playerAssign: [playerCard, null, null],
    playerHand,
    wheelSections: [reserveSection, strongSection, strongSection],
    tokens: [1, 1, 1],
    initiative: "enemy",
  });

  const playedIds = new Set(picks.filter((card): card is Card => !!card).map((c) => c.id));
  assert.equal(
    playedIds.has(highReserve.id),
    false,
    "enemy should retain the highest reserve card in hand when ReserveSum is active",
  );
});

test("enemy picker favors low-value plays on Weakest and Initiative lanes", () => {
  const strongSection = [makeSection("Strongest")];
  const weakSection = [makeSection("Weakest")];
  const initiativeSection = [makeSection("Initiative")];

  const playerAssign: (Card | null)[] = [
    makeValuedCard("player-strong", 2, 0),
    makeValuedCard("player-weak", 4, 0),
    makeValuedCard("player-init", 5, 0),
  ];
  const playerHand = playerAssign.filter((card): card is Card => !!card);

  const high = makeValuedCard("enemy-high", 6, 0);
  const mid = makeValuedCard("enemy-mid", 3, 0);
  const low = makeValuedCard("enemy-low", 1, 0);

  const picks = chooseEnemyAssignments({
    enemyHand: [high, mid, low],
    currentEnemyAssign: [null, null, null],
    playerAssign,
    playerHand,
    wheelSections: [strongSection, weakSection, initiativeSection],
    tokens: [1, 1, 1],
    initiative: "enemy",
  });

  assert.equal(picks[0]?.id, high.id, "strongest lane should use the highest value card");
  assert.equal(picks[1]?.id, low.id, "weakest lane should use the lowest value card");
  assert.equal(
    picks[2]?.id,
    mid.id,
    "initiative lane should spend a smaller card, preserving higher values elsewhere",
  );
});

test("settleFighterAfterRound discards the entire hand before refilling", () => {
  const hand = ["h1", "h2", "h3", "h4", "h5"].map(makeCard);
  const deck = ["d1", "d2", "d3", "d4", "d5", "d6"].map(makeCard);
  const fighter = makeFighter(deck, hand);

  const played = hand.slice(0, 2);
  const result = settleFighterAfterRound(fighter, played);

  assert.equal(result.hand.length, 5, "hand should be refilled to five cards");
  const handIds = new Set(result.hand.map((card) => card.id));
  hand.forEach((card) => {
    assert.equal(
      handIds.has(card.id),
      false,
      `card ${card.id} should not persist in hand after the round ends`,
    );
  });

  const expectedNewHand = deck.slice(0, 5).map((card) => card.id);
  assert.deepEqual(
    result.hand.map((card) => card.id),
    expectedNewHand,
    "hand should draw fresh cards from the top of the deck",
  );
});

test("settleFighterAfterRound places shop purchases into hand before refilling", () => {
  const startingDeck = ["d1", "d2", "d3", "d4", "d5", "d6"].map(makeCard);
  const fighter = makeFighter(startingDeck, []);

  const purchasedCard = makeCard("shop-card");
  const purchases: Card[] = [purchasedCard];

  const afterNextRound = settleFighterAfterRound(fighter, [], purchases);
  const drawnPurchase = afterNextRound.hand[0];
  assert.equal(
    drawnPurchase?.name,
    purchasedCard.name,
    "shop purchases should be added to the front of the new hand",
  );
  assert.notEqual(
    drawnPurchase?.id,
    purchasedCard.id,
    "purchased cards should receive new runtime ids when cloned",
  );

  const expectedFollowUps = startingDeck.slice(0, 4).map((card) => card.id);
  assert.deepEqual(
    afterNextRound.hand.slice(1).map((card) => card.id),
    expectedFollowUps,
    "the remainder of the hand should draw from the top of the deck",
  );
});

test("shop purchases remain available for immediate resume processing", () => {
  const startingDeck = ["d1", "d2", "d3", "d4", "d5", "d6"].map(makeCard);
  const startingHand = ["h1", "h2", "h3", "h4", "h5"].map(makeCard);
  const fighter = makeFighter(startingDeck, startingHand);

  const purchase: PendingShopPurchase = {
    card: makeCard("shop-card"),
    cost: 3,
    sourceId: "offer-1",
  };

  type Queue = Record<"player" | "enemy", PendingShopPurchase[]>;
  const queueRef: { current: Queue } = { current: { player: [], enemy: [] } };

  const enqueuePurchase = (prev: Queue): Queue => {
    const next: Queue = {
      player: [...prev.player, purchase],
      enemy: prev.enemy,
    };
    queueRef.current = next;
    return next;
  };

  const queued = enqueuePurchase(queueRef.current);

  assert.equal(
    queueRef.current.player.length,
    1,
    "shopPurchasesRef should reflect the enqueued purchase immediately",
  );
  assert.equal(
    queued.player[0]?.card.id,
    purchase.card.id,
    "purchase should be added to the player's queue",
  );

  const afterNextRound = settleFighterAfterRound(
    fighter,
    [],
    queueRef.current.player.map((purchase) => purchase.card),
  );
  const resumedCard = afterNextRound.hand.find((card) => card.name === purchase.card.name);
  assert.equal(
    resumedCard !== undefined,
    true,
    "the purchased card should be present in hand when the round resumes",
  );
  assert.notEqual(
    resumedCard?.id,
    purchase.card.id,
    "purchased cards should not reuse the shop offering id",
  );

  queueRef.current = { player: [], enemy: [] };
  assert.equal(
    queueRef.current.player.length,
    0,
    "shopPurchasesRef should be cleared after processing completes",
  );
});

test("purchased cards are drawn even when the queue is cleared before state updates", () => {
  const startingDeck = ["d1", "d2", "d3", "d4", "d5", "d6"].map(makeCard);
  const startingHand = ["h1", "h2", "h3", "h4", "h5"].map(makeCard);
  const fighter = makeFighter(startingDeck, startingHand);

  const purchase: PendingShopPurchase = {
    card: makeCard("shop-card"),
    cost: 4,
    sourceId: "offer-2",
  };

  type Queue = Record<"player" | "enemy", PendingShopPurchase[]>;
  const queueRef: { current: Queue } = { current: { player: [], enemy: [] } };

  const enqueuePurchase = (prev: Queue): Queue => {
    const next: Queue = {
      player: [...prev.player, purchase],
      enemy: [...prev.enemy],
    };
    queueRef.current = next;
    return next;
  };

  const queued = enqueuePurchase(queueRef.current);

  // Simulate the queue being drained synchronously before any React state setters run.
  const drained = queued;
  queueRef.current = { player: [], enemy: [] };

  const purchasesForNextRound = drained.player.map((item) => item.card);
  const afterAdvance = settleFighterAfterRound(fighter, [], purchasesForNextRound);
  const advancedCard = afterAdvance.hand[0];
  assert.equal(
    advancedCard?.name,
    purchase.card.name,
    "nextRoundCore should draw the purchased card into hand even when the queue cleared early",
  );
  assert.notEqual(
    advancedCard?.id,
    purchase.card.id,
    "purchased cards drawn into hand should be assigned a new runtime id",
  );

  assert.equal(
    afterAdvance.deck.some((card) => card.name === purchase.card.name),
    false,
    "purchased cards should not remain in the deck after being added to hand",
  );
});

test("remote legacy shopPurchase adds the offering card to the enemy deck", () => {
  const offeringId = "legacy-offer";
  const baseCard: Card = {
    id: "template-card",
    name: "Legacy Offer",
    type: "normal",
    number: 0,
    tags: [],
    cost: 3,
  };
  (baseCard as Card & { sourceId?: string }).sourceId = offeringId;

  const offering = {
    id: offeringId,
    rarity: "common" as const,
    cost: 3,
    summary: "",
    card: baseCard,
  };

  const fighters: Record<"player" | "enemy", Fighter> = {
    player: makeFighter([], []),
    enemy: makeFighter([], []),
  };

  const recordedPurchases: { side: "player" | "enemy"; cardId: string; round: number }[] = [];

  const applyShopPurchaseStub = (
    side: "player" | "enemy",
    target:
      | typeof offering
      | { offeringId: string; cost?: number }
      | string
      | { card: Card; cost: number; sourceId?: string | null },
  ) => {
    if (typeof target === "string" || !("card" in target)) {
      throw new Error("expected offering payload");
    }
    fighters[side] = addPurchasedCardToFighter(fighters[side], target.card);
    return true;
  };

  handleLegacyRemoteShopPurchase({
    side: "enemy",
    cardId: offeringId,
    round: 3,
    applyGauntletPurchaseFor: (side, purchase) => {
      recordedPurchases.push({ side, ...purchase });
    },
    findOfferingForSide: () => offering,
    applyShopPurchase: (
      side,
      target,
      opts?: { force?: boolean; sourceId?: string | null },
    ) => {
      expectForceOption(opts);
      return applyShopPurchaseStub(side, target);
    },
  });

  const enemyDeckSources = fighters.enemy.deck.map(getCardSourceId);

  assert.deepEqual(recordedPurchases, [
    { side: "enemy", cardId: offeringId, round: 3 },
  ]);
  assert.equal(
    enemyDeckSources.includes(offeringId),
    true,
    "enemy deck should contain the purchased offering",
  );
  assert.equal(
    enemyDeckSources.filter((id) => id === offeringId).length,
    1,
    "enemy deck should gain exactly one copy of the purchased card",
  );
});

function expectForceOption(opts?: { force?: boolean }) {
  assert.equal(opts?.force, true, "remote purchases should force the shop transaction");
}
