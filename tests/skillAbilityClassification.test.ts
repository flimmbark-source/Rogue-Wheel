import assert from "node:assert/strict";

import {
  describeSkillAbility,
  determineSkillAbility,
  getSkillCardValue,
  isReserveBoostTarget,
} from "../src/game/skills.js";
import type { Card } from "../src/game/types.js";

const makeCard = (overrides: Partial<Record<keyof Card, unknown>>): Card => {
  const card: Card = {
    id: "test-card",
    name: "Test",
    tags: [],
  };
  Object.assign(card as unknown as Record<string, unknown>, overrides);
  return card;
};

{
  const card = makeCard({ number: 1, baseNumber: 1 });
  assert.equal(getSkillCardValue(card), 1);
  assert.equal(determineSkillAbility(card), "rerollReserve");
}

{
  const card = makeCard({ number: "1" as unknown as number });
  assert.equal(getSkillCardValue(card), 1);
  assert.equal(determineSkillAbility(card), "rerollReserve");
}

{
  const card = makeCard({ number: "8" as unknown as number });
  assert.equal(determineSkillAbility(card), "reserveBoost");
}

{
  const card = makeCard({ baseNumber: "3" as unknown as number });
  assert.equal(determineSkillAbility(card), "boostSelf");
  assert.equal(describeSkillAbility("boostSelf", card), "Add 3 to a card in play.");
}

{
  const card = makeCard({ number: 5, baseNumber: 5 });
  assert.equal(isReserveBoostTarget(card), true);
}

{
  const card = makeCard({ number: 0, baseNumber: 0 });
  assert.equal(isReserveBoostTarget(card), false);
}

{
  const card = makeCard({ number: -2, baseNumber: -2 });
  assert.equal(isReserveBoostTarget(card), false);
}

{
  const card = makeCard({ number: -7, baseNumber: 4 });
  assert.equal(getSkillCardValue(card), 4);
  assert.equal(determineSkillAbility(card), "boostSelf");
  assert.equal(isReserveBoostTarget(card), true);
}

{
  const card = makeCard({ number: 6, baseNumber: -1 });
  assert.equal(getSkillCardValue(card), -1);
  assert.equal(determineSkillAbility(card), "swapReserve");
  assert.equal(isReserveBoostTarget(card), false);
}

{
  const card = makeCard({ baseNumber: 2 });
  assert.equal(getSkillCardValue(card), 2);
  assert.equal(determineSkillAbility(card), "rerollReserve");
}
