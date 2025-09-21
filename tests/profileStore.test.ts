import { test } from "node:test";
import assert from "node:assert/strict";

import type { Card, Fighter } from "../src/game/types";
import {
  drawOne,
  refillTo,
  freshFive,
  addPurchasedCardToFighter,
  rollStoreOfferings,
  startGauntletRun,
  endGauntletRun,
  applyGauntletPurchase,
  buildGauntletDeckAsCards,
  getCardSourceId,
  getProfileBundle,
  addToInventory,
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
  const clonedPurchase = withPurchase.deck[0];
  assert.equal(
    clonedPurchase?.name,
    purchased.name,
    "purchased card should be the next card drawn",
  );
  assert.notEqual(
    clonedPurchase?.id,
    purchased.id,
    "purchased cards should be assigned new runtime ids",
  );
  assert.notEqual(
    withPurchase.deck[0],
    purchased,
    "purchased card should be cloned to avoid shared references",
  );

  const afterDraw = drawOne(withPurchase);
  const lastDrawn = afterDraw.hand.at(-1);
  assert.equal(
    lastDrawn?.name,
    purchased.name,
    "purchased card should enter the hand on the next draw",
  );
  assert.notEqual(
    lastDrawn?.id,
    purchased.id,
    "drawn cards should not reuse the shop offering id",
  );
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

test("rollStoreOfferings reserves the top row for ability cards", () => {
  const offers = rollStoreOfferings(6, () => 0);

  assert.equal(offers.length, 6, "shop should roll six cards");

  offers.slice(0, 3).forEach((offer, index) => {
    assert.ok(
      offer.card.behavior,
      `slot ${index + 1} should contain an ability behavior card`,
    );
  });

  const bottomRow = offers.slice(3);
  bottomRow.forEach((offer, index) => {
    assert.equal(
      offer.card.behavior,
      undefined,
      `slot ${index + 4} should draw from the standard weighted pool`,
    );
  });

  assert.ok(
    bottomRow.some((offer) => typeof offer.card.number === "number" && offer.card.number < 0),
    "at least one of the weighted slots should surface a negative card",
  );
});

test("gauntlet purchases persist after rebuilding the deck", () => {
  endGauntletRun();
  const startingGold = 10;
  const initialBundle = getProfileBundle();
  const activeDeck = initialBundle.decks.find((d) => d.isActive) ?? initialBundle.decks[0];
  assert.ok(activeDeck, "an active deck should exist before starting the run");

  addToInventory(activeDeck.cards.map((card) => ({ cardId: card.cardId, qty: card.qty })));
  const preparedBundle = getProfileBundle();
  const preparedDeck =
    preparedBundle.decks.find((deck) => deck.id === activeDeck.id) ?? preparedBundle.decks[0];
  assert.ok(preparedDeck, "prepared deck should still exist after inventory seeding");

  const purchasedId = "basic_0";
  const cardToRemove =
    preparedDeck.cards.find((card) => card.cardId !== purchasedId)?.cardId ?? purchasedId;
  const initialDeckQty =
    preparedDeck.cards.find((card) => card.cardId === purchasedId)?.qty ?? 0;
  const initialRemovedQty =
    preparedDeck.cards.find((card) => card.cardId === cardToRemove)?.qty ?? 0;
  const initialInventoryQty =
    preparedBundle.inventory.find((item) => item.cardId === purchasedId)?.qty ?? 0;

  startGauntletRun({ deckId: preparedDeck.id, startingGold });

  const purchaseCost = 3;
  applyGauntletPurchase({
    remove: [{ cardId: cardToRemove, qty: 1 }],
    add: [{ cardId: purchasedId, qty: 1 }],
    cost: purchaseCost,
  });

  const rebuiltDeck = buildGauntletDeckAsCards();
  assert.equal(rebuiltDeck.length > 0, true, "rebuilt deck should include purchased cards");
  assert.equal(
    rebuiltDeck.some((card) => getCardSourceId(card) === purchasedId),
    true,
    "purchased card should appear in the rebuilt gauntlet deck",
  );

  const updatedBundle = getProfileBundle();
  assert.ok(updatedBundle.gauntlet, "gauntlet run should remain active after purchase");

  const savedDeck = updatedBundle.decks.find((deck) => deck.id === preparedDeck.id);
  assert.ok(savedDeck, "backing saved deck should still exist after purchase");
  const savedQty = savedDeck?.cards.find((card) => card.cardId === purchasedId)?.qty ?? 0;
  assert.equal(
    savedQty,
    initialDeckQty + 1,
    "purchase should add the card to the backing saved deck",
  );

  const removedQty = savedDeck?.cards.find((card) => card.cardId === cardToRemove)?.qty ?? 0;
  assert.equal(
    removedQty,
    Math.max(0, initialRemovedQty - 1),
    "purchase should remove the swapped-out card from the saved deck",
  );

  const inventoryQty =
    updatedBundle.inventory.find((item) => item.cardId === purchasedId)?.qty ?? 0;
  assert.equal(
    inventoryQty,
    initialInventoryQty + 1,
    "purchase should increment the player's inventory for the card",
  );

  endGauntletRun();
});
