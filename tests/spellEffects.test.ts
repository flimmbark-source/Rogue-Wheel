import assert from "node:assert/strict";

import {
  applyCardStatAdjustments,
  applyChilledCardUpdates,
  type LaneChillStacks,
  type LegacySide,
} from "../src/features/threeWheel/utils/spellEffectTransforms.js";
import { collectRuntimeSpellEffects } from "../src/features/threeWheel/utils/spellEffectTransforms.js";
import {
  applySpellEffects,
  type AssignmentState,
  type SpellEffectPayload,
} from "../src/game/spellEngine.js";
import type { Card, Fighter } from "../src/game/types.js";

const opponentOf = (side: LegacySide): LegacySide => (side === "player" ? "enemy" : "player");

// Fireball reduces card number via payload adjustments.
{
  const runtimeState = {
    cardAdjustments: [
      {
        target: { type: "card", cardId: "enemy-card", owner: "enemy" },
        numberDelta: -2,
      },
    ],
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
    drawCards: 1,
  } as const;
  const caster: LegacySide = "enemy";
  const summary = collectRuntimeSpellEffects(runtimeState, caster);
  assert.equal(summary.initiative, caster);
  assert(summary.delayedEffects && summary.delayedEffects.length === 1);
  assert.equal(summary.delayedEffects![0], "Future surge charged.");
  assert(summary.drawCards && summary.drawCards.length === 1);
  assert.equal(summary.drawCards![0]!.side, caster);
  assert.equal(summary.drawCards![0]!.count, 1);
}

// applySpellEffects mutates board, hand, and initiative based on payload fields.
{
  const playerBoard: [Card, Card, Card] = [
    { id: "p0", name: "Striker", number: 3, tags: [] },
    { id: "p1", name: "Oracle", number: 4, tags: [] },
    { id: "p2", name: "Wisp", number: 2, tags: [] },
  ];
  const enemyBoard: [Card, Card, Card | null] = [
    { id: "e0", name: "Bandit", number: 5, tags: [] },
    { id: "e1", name: "Ghoul", number: 3, tags: [] },
    null,
  ];
  const assignSnapshot: AssignmentState<Card> = {
    player: playerBoard,
    enemy: enemyBoard,
  };
  let assignments: AssignmentState<Card> = {
    player: [...playerBoard],
    enemy: [...enemyBoard],
  };
  let tokens: [number, number, number] = [0, 0, 0];
  let reserveSums: { player: number; enemy: number } | null = { player: 5, enemy: 5 };
  let chillStacks: LaneChillStacks = { player: [0, 0, 0], enemy: [0, 0, 0] };
  let initiative: LegacySide = "enemy";
  const log: string[] = [];
  let playerFighter: Fighter = {
    name: "Caster",
    deck: [
      { id: "pd1", name: "Bolt", number: 3, tags: [] },
      { id: "pd2", name: "Charm", number: 2, tags: [] },
    ],
    hand: [
      { id: "ph1", name: "Spark", number: 1, tags: [] },
      { id: "ph2", name: "Guard", number: 5, tags: [] },
    ],
    discard: [],
  };
  let enemyFighter: Fighter = {
    name: "Target",
    deck: [],
    hand: [{ id: "eh1", name: "Shade", number: 4, tags: [] }],
    discard: [],
  };

  const payload: SpellEffectPayload = {
    caster: "player",
    casterName: "Caster",
    cardAdjustments: [
      { owner: "player", cardId: "p1", numberDelta: 2 },
      { owner: "enemy", cardId: "e1", numberDelta: -1 },
    ],
    handAdjustments: [{ side: "player", cardId: "ph1", numberDelta: 2 }],
    handDiscards: [{ side: "enemy", cardId: "eh1" }],
    drawCards: [{ side: "player", count: 3 }],
    positionSwaps: [{ side: "player", laneA: 0, laneB: 2 }],
    initiativeChallenges: [{ side: "player", lane: 1, cardId: "p1", mode: "higher" }],
  };

  applySpellEffects<Card>(payload, {
    assignSnapshot,
    updateAssignments: (updater) => {
      assignments = updater(assignments);
    },
    updateReserveSums: (updater) => {
      reserveSums = updater(reserveSums);
    },
    updateTokens: (updater) => {
      tokens = updater(tokens);
      return tokens;
    },
    updateLaneChillStacks: (updater) => {
      chillStacks = updater(chillStacks);
    },
    setInitiative: (side) => {
      initiative = side;
    },
    appendLog: (entry) => {
      log.push(entry);
    },
    initiative,
    isMultiplayer: false,
    updateFighter: (side, updater) => {
      if (side === "player") {
        playerFighter = updater(playerFighter);
      } else {
        enemyFighter = updater(enemyFighter);
      }
    },
  });

  assert.notEqual(assignments, assignSnapshot);
  assert.equal(assignments.player[0]?.id, "p2");
  assert.equal(assignments.player[2]?.id, "p0");
  assert.equal((assignments.player[1] as Card).number, 6);
  assert.equal((assignments.enemy[1] as Card).number, 2);
  const adjustedHand = playerFighter.hand.find((card) => card.id === "ph1");
  assert(adjustedHand);
  assert.equal(adjustedHand!.number, 3);
  assert.equal(enemyFighter.hand.length, 0);
  assert.equal(enemyFighter.discard.length, 1);
  assert.equal(enemyFighter.discard[0]!.id, "eh1");
  assert.equal(playerFighter.deck.length, 0);
  assert.equal(playerFighter.hand.length, 4);
  assert(playerFighter.hand.some((card) => card.id === "pd1"));
  assert(playerFighter.hand.some((card) => card.id === "pd2"));
  assert.equal(initiative, "player");
  assert.deepEqual(log, [
    "Caster boosted Oracle by 2 (now 6).",
    "Caster dealt 1 to Ghoul (now 2).",
    "Caster boosted reserve card Spark by 2 (now 3).",
    "Caster discarded Shade from reserve.",
    "Caster drew 2 cards.",
    "Caster swapped lane 1 (Striker 3) with lane 3 (Wisp 2).",
    "Caster's Oracle on lane 2 overpowered the foe (6 vs 2) to seize initiative.",
  ]);
  assert.deepEqual(tokens, [0, 0, 0]);
  assert.deepEqual(reserveSums, { player: 5, enemy: 5 });
  assert.deepEqual(chillStacks, { player: [0, 0, 0], enemy: [0, 0, 0] });
}

console.log("spellEffects tests passed");
