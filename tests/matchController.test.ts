import { test } from "node:test";
import assert from "node:assert/strict";

import type { Card, Fighter } from "../src/game/types.js";
import { settleFighterAfterRound } from "../src/game/match/useMatchController.js";

const makeCard = (id: string): Card => ({
  id,
  name: id,
  type: "normal",
  number: 0,
  tags: [],
});

const makeFighter = (deck: Card[], hand: Card[], discard: Card[] = []): Fighter => ({
  name: "Testy",
  deck: [...deck],
  hand: [...hand],
  discard: [...discard],
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
