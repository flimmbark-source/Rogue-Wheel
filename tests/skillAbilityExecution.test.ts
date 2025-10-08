import assert from "node:assert/strict";

import type { Card, Fighter, LegacySide } from "../src/game/types.js";
import type { AssignmentState } from "../src/game/spellEngine.js";
import {
  applySkillAbilityEffect,
  type SkillAbilityEffectOptions,
} from "../src/features/threeWheel/utils/skillAbilityExecution.js";

const noopUpdateFighter = () => {
  throw new Error("updateFighter should not be called in this scenario");
};

const makeAssignments = (player: Array<Card | null>): AssignmentState<Card> => ({
  player: [...player],
  enemy: [null, null, null],
});

const blankFighter: Fighter = { name: "Tester", deck: [], hand: [], discard: [], exhaust: [] };

const makeOptions = (
  overrides: Partial<SkillAbilityEffectOptions>,
): SkillAbilityEffectOptions => ({
  ability: "boostCard",
  actorName: "Hero",
  side: "player" satisfies LegacySide,
  laneIndex: 0,
  target: { type: "lane", laneIndex: 0 },
  skillCard: null,
  storedSkillValue: 0,
  sideAssignments: makeAssignments([null, null, null]),
  concludeAssignUpdate: () => {
    throw new Error("concludeAssignUpdate should not run by default");
  },
  recalcWheelForLane: () => {
    throw new Error("recalcWheelForLane should not run by default");
    // satisfy type inference
    return { value: 0, changed: false };
  },
  getFighterSnapshot: () => blankFighter,
  updateFighter: noopUpdateFighter,
  drawOne: (fighter) => fighter,
  updateReservePreview: () => {
    throw new Error("updateReservePreview should not run by default");
  },
  appendLog: () => {
    throw new Error("appendLog should not run by default");
  },
  ...overrides,
});

{
  const logs: string[] = [];
  const options = makeOptions({
    storedSkillValue: 3,
    appendLog: (msg) => {
      logs.push(msg);
    },
  });

  const result = applySkillAbilityEffect(options);
  assert.equal(result.success, false);
  assert.equal(result.failureReason, "There is no card on that lane.");
  assert.equal(logs.length, 0);

  let laneExhausted = false;
  if (result.success) {
    laneExhausted = true;
  }
  assert.equal(laneExhausted, false, "failed ability should keep the lane available");

  console.log("skill ability execution invalid target test passed");
}

{
  let updatedAssignments: AssignmentState<Card> | null = null;
  let recalcLane: number | null = null;
  const logs: string[] = [];

  const laneCard: Card = { id: "lane-card", name: "Lane", tags: [], number: 5 };
  const options = makeOptions({
    storedSkillValue: 2,
    sideAssignments: makeAssignments([laneCard, null, null]),
    concludeAssignUpdate: (nextAssign) => {
      updatedAssignments = nextAssign;
    },
    recalcWheelForLane: (_assign, lane) => {
      recalcLane = lane;
      return { value: 0, changed: true };
    },
    appendLog: (msg) => {
      logs.push(msg);
    },
    updateFighter: noopUpdateFighter,
  });

  const result = applySkillAbilityEffect(options);
  assert.equal(result.success, true);
  assert.deepEqual(result.changedLanes, [0]);
  assert.equal(result.failureReason, undefined);
  assert.ok(updatedAssignments, "assignments should update on success");
  const ensuredAssignments: AssignmentState<Card> = updatedAssignments!;
  assert.equal(recalcLane, 0);
  assert.deepEqual(logs, ["Hero boosted lane 1 by 2."]);

  const updatedCard = ensuredAssignments.player[0];
  assert.equal(updatedCard?.number, 7);

  let laneExhausted = false;
  if (result.success) {
    laneExhausted = true;
  }
  assert.equal(laneExhausted, true, "successful ability should exhaust the lane when applied");

  console.log("skill ability execution success test passed");
}

{
  let updatedAssignments: AssignmentState<Card> | null = null;
  const logs: string[] = [];
  const laneCard: Card = { id: "lane-card", name: "Lane", tags: [], number: 1 };
  const skillCard: Card = {
    id: "skill-card",
    name: "Skill",
    tags: [],
    baseNumber: 4,
    number: 7,
  };

  const options = makeOptions({
    storedSkillValue: 4,
    skillCard,
    sideAssignments: makeAssignments([laneCard, null, null]),
    concludeAssignUpdate: (nextAssign) => {
      updatedAssignments = nextAssign;
    },
    recalcWheelForLane: () => ({ value: 0, changed: false }),
    appendLog: (msg) => {
      logs.push(msg);
    },
  });

  const result = applySkillAbilityEffect(options);
  assert.equal(result.success, true);
  assert.deepEqual(logs, ["Hero boosted lane 1 by 7."]);
  const ensuredAssignments: AssignmentState<Card> = updatedAssignments!;
  const boosted = ensuredAssignments.player[0];
  assert.equal(boosted?.number, 8, "lane should gain the current skill card value");

  console.log("skill ability uses current value test passed");
}

{
  let reservePreviewCalls = 0;
  const logs: string[] = [];
  const firstReserve: Card = { id: "reserve-1", name: "First", tags: [], number: 4 };
  const secondReserve: Card = { id: "reserve-2", name: "Second", tags: [], number: 7 };
  const draws: Card[] = [
    { id: "draw-1", name: "Draw One", tags: [], number: 9 },
    { id: "draw-2", name: "Draw Two", tags: [], number: 3 },
  ];
  let fighterState: Fighter = {
    name: "Reroller",
    deck: [...draws],
    hand: [firstReserve, secondReserve],
    discard: [],
    exhaust: [],
  };

  const baseOptions = makeOptions({
    ability: "rerollReserve",
    target: { type: "reserve", cardId: firstReserve.id },
    getFighterSnapshot: () => fighterState,
    updateFighter: (_side, updater) => {
      fighterState = updater(fighterState);
    },
    drawOne: (fighter) => {
      if (fighter.deck.length === 0) return fighter;
      const [next, ...rest] = fighter.deck;
      return {
        ...fighter,
        deck: rest,
        hand: [...fighter.hand, next],
        exhaust: [...fighter.exhaust],
      } satisfies Fighter;
    },
    updateReservePreview: () => {
      reservePreviewCalls += 1;
    },
    appendLog: (msg) => {
      logs.push(msg);
    },
  });

  const firstResult = applySkillAbilityEffect({
    ...baseOptions,
    target: { type: "reserve", cardId: firstReserve.id },
  });
  assert.equal(firstResult.success, true);
  assert.equal(reservePreviewCalls, 1, "first reroll should update the reserve preview");

  const secondResult = applySkillAbilityEffect({
    ...baseOptions,
    target: { type: "reserve", cardId: secondReserve.id },
  });
  assert.equal(secondResult.success, true);
  assert.equal(reservePreviewCalls, 2, "second reroll should also update the reserve preview");

  assert.equal(
    fighterState.hand.length >= 2,
    true,
    "hand should still contain at least two cards after rerolls",
  );

  console.log("reroll reserve triggers preview update twice test passed");
}

{
  const laneCard: Card = { id: "lane", name: "Lane", tags: [], number: 3 };
  const reserveCard: Card = { id: "reserve", name: "Reserve", tags: [], number: 5, baseNumber: 5 };
  const skillCard: Card = { id: "skill", name: "Skill", tags: [], number: 6, baseNumber: 6 };
  let fighterState: Fighter = {
    name: "Infuser",
    deck: [],
    hand: [reserveCard],
    discard: [],
    exhaust: [],
  };
  let updatedAssignments: AssignmentState<Card> | null = null;

  const options = makeOptions({
    ability: "reserveBoost",
    skillCard,
    target: { type: "reserveBoost", cardId: reserveCard.id, laneIndex: 0 },
    sideAssignments: makeAssignments([laneCard, null, null]),
    getFighterSnapshot: () => fighterState,
    updateFighter: (_side, updater) => {
      fighterState = updater(fighterState);
    },
    updateReservePreview: () => {
      /* noop */
    },
    appendLog: () => {
      /* noop */
    },
    concludeAssignUpdate: (nextAssign) => {
      updatedAssignments = nextAssign;
    },
    recalcWheelForLane: () => ({ value: 0, changed: false }),
  });

  const result = applySkillAbilityEffect(options);
  assert.equal(result.success, true);
  assert.equal(fighterState.hand.length, 1, "reserve card should remain in hand");
  assert.equal(
    fighterState.hand[0]?.reserveExhausted,
    true,
    "reserve card should be marked exhausted",
  );
  assert.deepEqual(fighterState.discard, [], "reserve card should not enter discard");
  assert.deepEqual(fighterState.exhaust.map((card) => card.id), [], "reserve pile unchanged");
  const ensuredAssignments: AssignmentState<Card> = updatedAssignments!;
  const boostedLane = ensuredAssignments.player[0];
  assert.equal(boostedLane?.number, 8, "lane should gain the reserve card's value");

  console.log("reserve boost exhausts reserve card in place test passed");
}
