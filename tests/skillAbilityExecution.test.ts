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

const blankFighter: Fighter = { name: "Tester", deck: [], hand: [], discard: [] };

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
    },
    appendLog: (msg) => {
      logs.push(msg);
    },
    updateFighter: noopUpdateFighter,
  });

  const result = applySkillAbilityEffect(options);
  assert.equal(result.success, true);
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
