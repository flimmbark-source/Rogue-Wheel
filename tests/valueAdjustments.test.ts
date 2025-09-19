import { test } from "node:test";
import assert from "node:assert/strict";

import type { Card } from "../src/game/types";
import {
  computeAdjustedCardValue,
  computeEffectiveCardValues,
  type ActivationAdjustmentsMap,
  type ActivationSwapPairs,
} from "../src/game/match/valueAdjustments.js";

const makeCard = (id: string, value: number): Card => ({
  id,
  name: id,
  type: "normal",
  number: value,
  tags: [],
});

test("boost adjustments double the base card value", () => {
  const card = makeCard("c1", 7);
  const adjustments: ActivationAdjustmentsMap = { c1: { type: "boost" } };
  assert.equal(computeAdjustedCardValue(card, adjustments), 14);

  const map = computeEffectiveCardValues([card], adjustments, [] satisfies ActivationSwapPairs);
  assert.equal(map.get("c1"), 14);
});

test("split adjustments halve and truncate the card value", () => {
  const card = makeCard("c2", 11);
  const adjustments: ActivationAdjustmentsMap = { c2: { type: "split" } };
  assert.equal(computeAdjustedCardValue(card, adjustments), 5);

  const map = computeEffectiveCardValues([card], adjustments, [] satisfies ActivationSwapPairs);
  assert.equal(map.get("c2"), 5);
});

test("swapped cards exchange their adjusted values", () => {
  const boosted = makeCard("boosted", 5);
  const plain = makeCard("plain", 9);
  const adjustments: ActivationAdjustmentsMap = { boosted: { type: "boost" } };
  const swaps: ActivationSwapPairs = [["boosted", "plain"]];

  const map = computeEffectiveCardValues([boosted, plain], adjustments, swaps);
  assert.equal(map.get("boosted"), 9, "boosted card should receive partner value after swap");
  assert.equal(map.get("plain"), 10, "plain card should receive boosted value after swap");
});
