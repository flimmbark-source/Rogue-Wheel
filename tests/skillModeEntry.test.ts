import assert from "node:assert/strict";

import type { Card } from "../src/game/types.js";
import { initSkillPhase } from "../src/features/threeWheel/skillPhase.js";

const makeCard = (printed: number, id: string): Card => ({
  id,
  name: id,
  number: printed,
  baseNumber: printed,
  tags: [],
});

// Simulate the board state the hook would produce for a single-player skill-mode reveal.
const board = [
  { side: "player" as const, index: 0, card: makeCard(3, "p0") },
  { side: "player" as const, index: 1, card: makeCard(1, "p1") },
  { side: "player" as const, index: 2, card: makeCard(0, "p2") },
  { side: "enemy" as const, index: 0, card: makeCard(2, "e0") },
  { side: "enemy" as const, index: 1, card: makeCard(0, "e1") },
  { side: "enemy" as const, index: 2, card: makeCard(1, "e2") },
];

const reserves = {
  player: [makeCard(4, "pr0"), makeCard(2, "pr1")],
  enemy: [makeCard(3, "er0")],
};

const state = initSkillPhase(board, reserves, "player", 99);

assert.equal(state.passed.player, false, "Player should begin with available actions");
assert.equal(state.passed.enemy, false, "Enemy should also have actions queued");
assert.equal(state.activeSide, "player", "Player keeps initiative at phase start");

console.log("skill mode entry test passed");
