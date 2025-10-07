import assert from "node:assert/strict";

import type { Card } from "../src/game/types.js";
import {
  aiChooseAction,
  beginActivation,
  cancelTargeting,
  confirmActivation,
  getOptions,
  initSkillPhase,
  pass,
  pickTarget,
  type SkillPhaseState,
} from "../src/features/threeWheel/skillPhase.js";

const makeCard = (printed: number, id = `card-${printed}-${Math.random()}`): Card => ({
  id,
  name: `Card ${printed}`,
  number: printed,
  baseNumber: printed,
  tags: [],
});

const emptyUi = undefined;

const lanes = (
  values: Array<{ side: "player" | "enemy"; index: number; card?: Card | null }>,
): Array<{ side: "player" | "enemy"; index: number; card: Card | null }> =>
  values.map(({ side, index, card }) => ({ side, index, card: card ?? null }));

function reserves(player: Card[], enemy: Card[]) {
  return { player: [...player], enemy: [...enemy] };
}

// Phase entry banners for active starter
{
  const messages: string[] = [];
  const state = initSkillPhase(
    lanes([
      { side: "player", index: 0, card: makeCard(3, "a") },
      { side: "enemy", index: 0, card: makeCard(3, "b") },
    ]),
    reserves([makeCard(2, "ry1")], [makeCard(2, "rr1")]),
    "player",
    1,
    {
      banner: (msg) => messages.push(msg),
    },
  );
  assert.equal(messages[0], "Skill Phase begins. You act first.");
  assert.equal(state.activeSide, "player");
}

// Phase entry hands initiative when starter lacks actions
{
  const messages: string[] = [];
  const state = initSkillPhase(
    lanes([
      { side: "player", index: 0, card: makeCard(0, "a") },
      { side: "enemy", index: 0, card: makeCard(3, "b") },
    ]),
    reserves([], [makeCard(2, "rr1")]),
    "player",
    5,
    {
      banner: (msg) => messages.push(msg),
    },
  );
  assert.equal(messages[0], "You have no skill actions—opponent starts.");
  assert.equal(state.activeSide, "enemy");
}

// Phase skips entirely when no actions
{
  const messages: string[] = [];
  const state = initSkillPhase(
    lanes([
      { side: "player", index: 0, card: makeCard(0, "a") },
      { side: "enemy", index: 0, card: makeCard(0, "b") },
    ]),
    reserves([], []),
    "player",
    1,
    {
      banner: (msg) => messages.push(msg),
    },
  );
  assert.equal(messages[0], "No skill actions available.");
  assert.equal(state.passed.player && state.passed.enemy, true);
}

// Reserve boost only available with positive reserve
{
  const state = initSkillPhase(
    lanes([{ side: "player", index: 0, card: makeCard(5, "a") }]),
    reserves([makeCard(-1, "neg")], []),
    "player",
    2,
    emptyUi,
  );
  const options1 = getOptions(state, "player");
  assert.equal(options1[0].available, false);
  assert.equal(options1[0].reason, "no positive reserve");
  const withPositive: SkillPhaseState = {
    ...state,
    reserves: { player: [makeCard(3, "pos")], enemy: [] },
  };
  const options2 = getOptions(withPositive, "player");
  assert.equal(options2[0].available, true);
}

// Reroll greys out after two uses
{
  const baseState = initSkillPhase(
    lanes([{ side: "player", index: 0, card: makeCard(1, "a") }]),
    reserves([makeCard(2, "r1")], []),
    "player",
    10,
    emptyUi,
  );
  const afterTwo: SkillPhaseState = {
    ...baseState,
    limits: { rerollsUsed: { player: 2, enemy: 0 } },
  };
  const options = getOptions(afterTwo, "player");
  assert.equal(options[0].available, false);
  assert.equal(options[0].reason, "phase reroll limit reached");
}

// Targeting cancel restores snapshot
{
  let state = initSkillPhase(
    lanes([{ side: "player", index: 0, card: makeCard(5, "a") }]),
    reserves([makeCard(2, "boost")], []),
    "player",
    9,
    emptyUi,
  );
  state = beginActivation(state, "player", 0);
  state = pickTarget(state, "boost");
  const cancelled = cancelTargeting(state);
  assert.equal(cancelled.targeting, undefined);
  assert.equal(cancelled.reserves.player.some((c) => c.id === "boost"), true);
}

// Confirm activation consumes use and updates state
{
  let state = initSkillPhase(
    lanes([{ side: "player", index: 0, card: makeCard(5, "a") }]),
    reserves([makeCard(3, "boost")], []),
    "player",
    9,
    emptyUi,
  );
  state = beginActivation(state, "player", 0);
  state = pickTarget(state, "boost");
  state = confirmActivation(state);
  const lane = state.lanes.find((l) => l.index === 0)!;
  assert.equal(lane.boost, 3);
  assert.equal(lane.usesRemaining, 0);
}

// Turn advances only when opponent can act
{
  let state = initSkillPhase(
    lanes([
      { side: "player", index: 0, card: makeCard(5, "a") },
      { side: "enemy", index: 0, card: makeCard(0, "b") },
    ]),
    reserves([makeCard(2, "boost")], []),
    "player",
    9,
    emptyUi,
  );
  state = beginActivation(state, "player", 0);
  state = pickTarget(state, "boost");
  state = confirmActivation(state);
  assert.equal(state.activeSide, "player");
}

// Swap reserve exchanges cards
{
  let state = initSkillPhase(
    lanes([{ side: "player", index: 0, card: makeCard(0, "lane") }]),
    reserves([makeCard(4, "res")], []),
    "player",
    4,
    emptyUi,
  );
  state = beginActivation(state, "player", 0);
  state = pickTarget(state, "res");
  state = confirmActivation(state);
  const lane = state.lanes.find((l) => l.index === 0)!;
  assert.equal(lane.card?.id, "res");
  assert.equal(state.reserves.player.some((c) => c.id === "lane"), true);
}

// Reroll increments limit and draws deterministically
{
  let state = initSkillPhase(
    lanes([{ side: "player", index: 0, card: makeCard(1, "lane") }]),
    reserves([makeCard(1, "res")], []),
    "player",
    1234,
    emptyUi,
  );
  state = beginActivation(state, "player", 0);
  const targetId = state.reserves.player[0].id;
  state = pickTarget(state, targetId);
  state = confirmActivation(state);
  assert.equal(state.limits.rerollsUsed.player, 1);
  assert.equal(state.reserves.player.length, 1);
}

// Boost card adds printed value
{
  let state = initSkillPhase(
    lanes([
      { side: "player", index: 0, card: makeCard(3, "lane") },
      { side: "player", index: 1, card: makeCard(2, "ally") },
    ]),
    reserves([], []),
    "player",
    11,
    emptyUi,
  );
  state = beginActivation(state, "player", 0);
  state = pickTarget(state, 1);
  state = confirmActivation(state);
  const lane = state.lanes.find((l) => l.index === 1)!;
  assert.equal(lane.boost, 3);
}

// Reserve boost removes reserve card
{
  let state = initSkillPhase(
    lanes([{ side: "player", index: 0, card: makeCard(5, "lane") }]),
    reserves([makeCard(3, "boost")], []),
    "player",
    9,
    emptyUi,
  );
  state = beginActivation(state, "player", 0);
  state = pickTarget(state, "boost");
  state = confirmActivation(state);
  assert.equal(state.reserves.player.length, 0);
}

// Passing updates turn order and can end the phase
{
  let state = initSkillPhase(
    lanes([
      { side: "player", index: 0, card: makeCard(5, "lane") },
      { side: "enemy", index: 0, card: makeCard(3, "foe") },
    ]),
    reserves([makeCard(3, "boost")], [makeCard(2, "foeRes")]),
    "player",
    9,
    emptyUi,
  );
  state = pass(state, "player");
  assert.equal(state.activeSide, "enemy");
}

// AI prefers deterministic boost
{
  const state = initSkillPhase(
    lanes([
      { side: "enemy", index: 0, card: makeCard(5, "lane") },
      { side: "player", index: 0, card: makeCard(6, "opp") },
    ]),
    reserves([], [makeCard(3, "boost")]),
    "player",
    20,
    emptyUi,
  );
  const action = aiChooseAction(state, "enemy");
  assert.equal(action.type, "activate");
  assert.equal(action.laneIndex, 0);
  assert.equal(action.chosenTarget, "boost");
}

console.log("skill mode phase tests passed");
