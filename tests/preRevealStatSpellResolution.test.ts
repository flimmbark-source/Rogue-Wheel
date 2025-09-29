import assert from "node:assert/strict";

import { SLICES } from "../src/game/types.js";
import {
  applySpellEffects,
  type AssignmentState,
  type ReserveState,
  type SpellEffectApplicationContext,
} from "../src/game/spellEngine.js";
import type { LaneChillStacks, LegacySide } from "../src/features/threeWheel/utils/spellEffectTransforms.js";

type TestCard = { id: string; name: string; number: number; tags?: string[] };

const PLAYER: LegacySide = "player";

const createAssignments = (): AssignmentState<TestCard> => ({
  player: [
    { id: "player-card", name: "Heroic", number: 5, tags: [] },
    null,
    null,
  ],
  enemy: [
    { id: "enemy-card", name: "Brute", number: 6, tags: [] },
    null,
    null,
  ],
});

{
  let assignments = createAssignments();
  let tokens: [number, number, number] = [3, 0, 0];
  let reserveState: ReserveState | null = { player: 0, enemy: 0 };
  let laneChillStacks: LaneChillStacks = { player: [0, 0, 0], enemy: [0, 0, 0] };
  const previewUpdates: Array<{ index: number; value: number }> = [];
  let tokenUpdateCallCount = 0;

  const context: SpellEffectApplicationContext<TestCard> = {
    assignSnapshot: assignments,
    updateAssignments: (updater) => {
      assignments = updater(assignments);
    },
    updateReserveSums: (updater) => {
      reserveState = updater(reserveState);
    },
    updateTokens: (updater) => {
      tokenUpdateCallCount += 1;
      tokens = updater(tokens);
    },
    updateLaneChillStacks: (updater) => {
      laneChillStacks = updater(laneChillStacks);
    },
    setInitiative: () => {},
    appendLog: () => {},
    initiative: PLAYER,
    isMultiplayer: false,
    broadcastEffects: undefined,
    updateTokenVisual: (index, value) => {
      previewUpdates.push({ index, value });
    },
    startingTokens: [...tokens] as [number, number, number],
  };

  applySpellEffects<TestCard>(
    {
      caster: PLAYER,
      cardAdjustments: [
        {
          owner: PLAYER,
          cardId: "player-card",
          numberDelta: 4,
        },
      ],
    },
    context,
  );

  assert.equal(assignments.player[0]?.number, 9);
  assert.equal(assignments.enemy[0]?.number, 6);
  assert.equal(tokenUpdateCallCount, 0, "pre-reveal stat changes should not persist tokens");
  assert.deepEqual(tokens, [3, 0, 0], "starting tokens remain unchanged before reveal");

  const updatedPlayer = assignments.player[0]?.number ?? 0;
  const updatedEnemy = assignments.enemy[0]?.number ?? 0;
  const spinSteps = (updatedPlayer + updatedEnemy) % SLICES;
  const expectedLanding = spinSteps;

  assert.deepEqual(previewUpdates, [
    { index: 0, value: expectedLanding },
    { index: 1, value: 0 },
    { index: 2, value: 0 },
  ]);

  const actualLanding = (updatedPlayer + updatedEnemy) % SLICES;
  assert.equal(actualLanding, expectedLanding, "landing is based on the adjusted card totals");
  assert.equal(actualLanding, previewUpdates[0]?.value ?? -1, "preview matches resolved landing");
}

console.log("preReveal stat spell resolution test passed");
