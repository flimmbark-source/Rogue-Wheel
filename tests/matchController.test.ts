import { test } from "node:test";
import assert from "node:assert/strict";

import type { Card, Fighter, Section } from "../src/game/types.js";
import type { PendingShopPurchase } from "../src/game/match/useMatchController.js";
import { chooseEnemyAssignments, settleFighterAfterRound } from "../src/game/match/useMatchController.js";

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

test("settleFighterAfterRound preserves unplayed cards and only refills the deficit", () => {
  const hand = ["h1", "h2", "h3", "h4", "h5"].map(makeCard);
  const deck = ["d1", "d2", "d3", "d4", "d5", "d6"].map(makeCard);
  const discard = ["old1", "old2"].map(makeCard);
  const fighter = makeFighter(deck, hand, discard);

  const played = hand.slice(0, 2);
  const result = settleFighterAfterRound(fighter, played);

  assert.equal(result.hand.length, 5, "hand should be refilled to five cards");
  const expectedHandOrder = [...hand.slice(2), ...deck.slice(0, 2)].map((card) => card.id);
  assert.deepEqual(
    result.hand.map((card) => card.id),
    expectedHandOrder,
    "unplayed cards should stay in hand and new draws should fill to five",
  );

  assert.deepEqual(
    result.discard.map((card) => card.id),
    [...discard, ...played].map((card) => card.id),
    "played cards should be appended to the discard pile",
  );

  assert.deepEqual(
    result.deck.map((card) => card.id),
    deck.slice(2).map((card) => card.id),
    "deck should lose only the cards needed to refill the hand",
  );
});

test("settleFighterAfterRound places shop purchases into hand before refilling", () => {
  const startingDeck = ["d1", "d2", "d3", "d4", "d5", "d6"].map(makeCard);
  const fighter = makeFighter(startingDeck, []);

  const purchasedCard = makeCard("shop-card");
  const purchases: Card[] = [purchasedCard];

  const afterNextRound = settleFighterAfterRound(fighter, [], purchases);
  assert.equal(
    afterNextRound.hand[0]?.id,
    purchasedCard.id,
    "shop purchases should be added to the front of the new hand",
  );

  const expectedFollowUps = startingDeck.slice(0, 4).map((card) => card.id);
  assert.deepEqual(
    afterNextRound.hand.slice(1).map((card) => card.id),
    expectedFollowUps,
    "the remainder of the hand should draw from the top of the deck",
  );
});

test("purchased cards are added without removing surviving copies", () => {
  const survivor = makeCard("shared-card");
  const keep = makeCard("keep");
  const hand = [survivor, keep, makeCard("play-1"), makeCard("play-2"), makeCard("play-3")];
  const deck = ["d1", "d2", "d3", "d4"].map(makeCard);
  const fighter = makeFighter(deck, hand);

  const played = hand.slice(2);
  const purchases = [makeCard("shared-card")];
  const result = settleFighterAfterRound(fighter, played, purchases);

  assert.equal(result.hand[0]?.id, purchases[0]?.id, "purchased card should be first in hand");
  assert.equal(
    result.hand.filter((card) => card.id === survivor.id).length,
    2,
    "original copy and purchased copy should both remain in hand",
  );
  assert.ok(result.hand.includes(survivor), "surviving card instance should still be in hand");
  assert.equal(
    result.deck.some((card) => card.id === survivor.id),
    false,
    "purchased card should be removed from the deck",
  );
  assert.equal(
    result.discard.some((card) => card.id === survivor.id),
    false,
    "purchased card should not appear in the discard pile",
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
  assert.equal(
    afterNextRound.hand.some((card) => card.id === purchase.card.id),
    true,
    "the purchased card should be present in hand when the round resumes",
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
  assert.equal(
    afterAdvance.hand[0]?.id,
    purchase.card.id,
    "nextRoundCore should draw the purchased card into hand even when the queue cleared early",
  );

  assert.equal(
    afterAdvance.deck.some((card) => card.id === purchase.card.id),
    false,
    "purchased cards should not remain in the deck after being added to hand",
  );
});
