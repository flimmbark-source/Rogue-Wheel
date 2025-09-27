import assert from "node:assert/strict";

import { SLICES, type LegacySide } from "../src/game/types.js";
import {
  applySpellEffects,
  type AssignmentState,
  type ReserveState,
  type SpellEffectApplicationContext,
} from "../src/game/spellEngine.js";
import type { LaneChillStacks } from "../src/features/threeWheel/utils/spellEffectTransforms.js";

const initialInitiative: LegacySide = "player";

type TestCard = { id: string; name: string; number: number; tags?: string[] };

const createInitialAssignments = (): AssignmentState<TestCard> => ({
  player: [
    { id: "player-card", name: "Valiant", number: 4, tags: [] },
    null,
    null,
  ],
  enemy: [
    { id: "enemy-card", name: "Warden", number: 7, tags: [] },
    null,
    null,
  ],
});

const computeInitialTokens = (assignments: AssignmentState<TestCard>): [number, number, number] => {
  const playerValue = assignments.player[0]?.number ?? 0;
  const enemyValue = assignments.enemy[0]?.number ?? 0;
  return [((playerValue + enemyValue) % SLICES + SLICES) % SLICES, 0, 0];
};

{
  let assignments = createInitialAssignments();
  let tokens = computeInitialTokens(assignments);
  let reserveState: ReserveState | null = { player: 0, enemy: 0 };
  let laneChillStacks: LaneChillStacks = { player: [0, 0, 0], enemy: [0, 0, 0] };
  let initiative: LegacySide = initialInitiative;
  const logs: string[] = [];
  const tokenVisualUpdates: Array<{ index: number; value: number }> = [];
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
    setInitiative: (side) => {
      initiative = side;
    },
    appendLog: (message) => {
      logs.push(message);
    },
    initiative,
    isMultiplayer: false,
    broadcastEffects: undefined,
    updateTokenVisual: (index, value) => {
      tokenVisualUpdates.push({ index, value });
    },
  };

  applySpellEffects<TestCard>(
    {
      caster: "player",
      mirrorCopyEffects: [
        {
          targetCardId: "player-card",
          mode: "opponent",
        },
      ],
    },
    context,
  );

  assert.equal(assignments.player[0]?.number, assignments.enemy[0]?.number);
  assert.equal(assignments.player[0]?.number, 7);

  const expectedTokenValue = (7 + 7) % SLICES;
  assert.equal(tokens[0], expectedTokenValue);
  assert.equal(tokenUpdateCallCount, 1);
  assert.deepEqual(tokenVisualUpdates, [{ index: 0, value: expectedTokenValue }]);

  assert.equal(reserveState?.player, 0);
  assert.equal(laneChillStacks.player[0], 0);
  assert.equal(initiative, initialInitiative);
  assert.equal(logs.length, 0);
}

console.log("mirrorImageResolution tests passed");
