import { test } from "node:test";
import assert from "node:assert/strict";

import type { Card, Fighter } from "../src/game/types";
import {
  drawOne,
  refillTo,
  freshFive,
  addPurchasedCardToFighter,
} from "../src/player/profileStore.js";

const makeCard = (id: string, value = 0): Card => ({
  id,
  name: id,
  type: "normal",
  number: value,
  tags: [],
});

const makeFighter = (deck: Card[], hand: Card[] = [], discard: Card[] = []): Fighter => ({
  name: "Tester",
  deck: [...deck],
  hand: [...hand],
  discard: [...discard],
});

test("addPurchasedCardToFighter places a cloned card on top of the deck", () => {
  const baseCard = makeCard("base", 3);
  const purchased = makeCard("shop", 7);
  const fighter = makeFighter([baseCard]);

  const withPurchase = addPurchasedCardToFighter(fighter, purchased);

  assert.equal(withPurchase.deck.length, 2, "purchased card should extend the deck");
  assert.equal(
    withPurchase.deck[0]?.id,
    purchased.id,
    "purchased card should be the next card drawn",
  );
  assert.notEqual(
    withPurchase.deck[0],
    purchased,
    "purchased card should be cloned to avoid shared references",
  );

  const afterDraw = drawOne(withPurchase);
  const lastDrawn = afterDraw.hand.at(-1);
  assert.equal(lastDrawn?.id, purchased.id, "purchased card should enter the hand on the next draw");
});

test("drawOne pulls from the discard pile when the deck is empty", () => {
  const discardCard = makeCard("discard", 5);
  const fighter = makeFighter([], [], [discardCard]);

  const next = drawOne(fighter);

  assert.equal(next.hand.length, 1, "a card should be drawn from the discard");
  assert.equal(next.hand[0]?.id, discardCard.id, "the discarded card should be drawn");
  assert.equal(next.discard.length, 0, "discard should be emptied after reshuffle");
});

test("refillTo draws until the hand reaches the requested size or runs out of cards", () => {
  const cardA = makeCard("a", 1);
  const fighter = makeFighter([cardA]);

  const refilled = refillTo(fighter, 2);

  assert.equal(refilled.hand.length, 1, "only one card should be drawn when the deck runs out");
  assert.equal(refilled.deck.length, 0, "deck should be empty after drawing the last card");
});

test("freshFive rebuilds the fighter state with a new shuffled hand", () => {
  const cards = Array.from({ length: 8 }, (_, index) => makeCard(`c${index}`, index));
  const fighter = makeFighter(cards.slice(0, 3), cards.slice(3, 5), cards.slice(5));

  const fresh = freshFive(fighter);

  assert.equal(fresh.hand.length, 5, "hand should be reset to five cards");
  assert.equal(fresh.discard.length, 0, "discard should be cleared after refreshing");
  assert.equal(
    fresh.deck.length,
    cards.length - fresh.hand.length,
    "remaining cards should stay in the deck",
  );
});
