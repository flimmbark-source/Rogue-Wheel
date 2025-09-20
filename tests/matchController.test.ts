import { test } from "node:test";
import assert from "node:assert/strict";

import type { Card, Fighter, Section } from "../src/game/types.js";
import type { PendingShopPurchase } from "../src/game/match/useMatchController.js";
import {
  chooseEnemyAssignments,
  settleFighterAfterRound,
  stackPurchasesOnDeck,
} from "../src/game/match/useMatchController.js";

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

test("resumeAfterShop stacks purchases before advancing to the next round", () => {
  const startingDeck = ["d1", "d2", "d3", "d4", "d5", "d6"].map(makeCard);
  const startingHand = ["h1", "h2", "h3", "h4", "h5"].map(makeCard);
  const fighter = makeFighter(startingDeck, startingHand);

  const purchasedCard = makeCard("shop-card");
  const purchases: PendingShopPurchase[] = [
    { card: purchasedCard, cost: 3, sourceId: "offer-1" },
  ];

  const afterShop = stackPurchasesOnDeck(fighter, purchases);
  assert.equal(
    afterShop.deck[0]?.id,
    purchasedCard.id,
    "resumeAfterShop should place the purchased card on top of the deck",
  );

  const afterNextRound = settleFighterAfterRound(afterShop, []);
  assert.equal(
    afterNextRound.hand[0]?.id,
    purchasedCard.id,
    "nextRoundCore should immediately draw the purchased card into hand",
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

  const stacked = stackPurchasesOnDeck(fighter, queueRef.current.player);
  assert.equal(
    stacked.deck[0]?.id,
    purchase.card.id,
    "resumeAfterShop should stack the purchase on top of the deck",
  );

  const afterNextRound = settleFighterAfterRound(stacked, []);
  assert.equal(
    afterNextRound.hand[0]?.id,
    purchase.card.id,
    "the purchased card should be drawn into hand when the round resumes",
  );

  queueRef.current = { player: [], enemy: [] };
  assert.equal(
    queueRef.current.player.length,
    0,
    "shopPurchasesRef should be cleared after processing completes",
  );
});
