import assert from "node:assert/strict";

import {
  applyCardStatAdjustments,
  applyChilledCardUpdates,
  type LaneChillStacks,
  type LegacySide,
} from "../src/features/threeWheel/utils/spellEffectTransforms.js";
import { collectRuntimeSpellEffects } from "../src/features/threeWheel/utils/spellEffectTransforms.js";
import type { Card } from "../src/game/types.js";

const opponentOf = (side: LegacySide): LegacySide => (side === "player" ? "enemy" : "player");

// Fireball reduces card number via payload adjustments.
{
  const runtimeState = {
    lastFireballTarget: { type: "card", cardId: "enemy-card", owner: "enemy" },
  } as const;
  const caster: LegacySide = "player";
  const summary = collectRuntimeSpellEffects(runtimeState, caster);
  assert(summary.cardAdjustments && summary.cardAdjustments.length === 1);
  const adjustment = summary.cardAdjustments![0]!;
  assert.equal(adjustment.owner, opponentOf(caster));
  assert.equal(adjustment.numberDelta, -2);

  const assignState = {
    player: [null, null, null] as (Card | null)[],
    enemy: [
      { id: "enemy-card", name: "Brute", number: 6, tags: [] },
      null,
      null,
    ] as (Card | null)[],
  };
  const updated = applyCardStatAdjustments(assignState, summary.cardAdjustments!);
  assert(updated, "Card adjustment should produce a new assign state");
  assert.equal((updated!.enemy[0] as Card).number, 4);
}

// Ice Shard freezes the matching lane by adding chilled stacks.
{
  const runtimeState = {
    chilledCards: { "enemy-card": 1 },
  } as const;
  const caster: LegacySide = "player";
  const summary = collectRuntimeSpellEffects(runtimeState, caster);
  assert(summary.chilledCards && summary.chilledCards.length === 1);
  const chilled = summary.chilledCards![0]!;
  assert.equal(chilled.owner, opponentOf(caster));
  assert.equal(chilled.stacks, 1);

  const assignState = {
    player: [null, null, null] as (Card | null)[],
    enemy: [
      { id: "enemy-card", name: "Rogue", number: 3, tags: [] },
      null,
      null,
    ] as (Card | null)[],
  };
  const laneStacks: LaneChillStacks = { player: [0, 0, 0], enemy: [0, 0, 0] };
  const updatedStacks = applyChilledCardUpdates(laneStacks, assignState, summary.chilledCards!);
  assert(updatedStacks, "Chilled update should return modified lane stacks");
  assert.equal(updatedStacks!.enemy[0], 1);
}

// Time Twist builds initiative and queues delayed log messages.
{
  const runtimeState = {
    timeMomentum: 2,
    delayedEffects: ["Future surge charged."],
  } as const;
  const caster: LegacySide = "enemy";
  const summary = collectRuntimeSpellEffects(runtimeState, caster);
  assert.equal(summary.initiative, caster);
  assert(summary.delayedEffects && summary.delayedEffects.length === 1);
  assert.equal(summary.delayedEffects![0], "Future surge charged.");
}

console.log("spellEffects tests passed");
