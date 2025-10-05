import assert from "node:assert/strict";

import { chooseCpuSpellResponse } from "../src/game/ai/grimoireCpu.js";
import { countSymbolsFromCards, getVisibleSpellsForHand } from "../src/game/grimoire.js";
import { computeSpellCost, type AssignmentState } from "../src/game/spellEngine.js";
import {
  getSpellDefinitions,
  type SpellDefinition,
  type SpellId,
  type SpellRuntimeState,
} from "../src/game/spells.js";
import type { Card, Fighter, LegacySide, TagId } from "../src/game/types.js";

const CHEAP_SPELL_THRESHOLD = 2;

const createCard = (
  id: string,
  name: string,
  value: number,
  arcana: Card["arcana"],
): Card => ({
  id,
  name,
  number: value,
  arcana,
  tags: [] as TagId[],
});

const cpuSide: LegacySide = "enemy";
const playerSide: LegacySide = "player";

const cpuCaster: Fighter = {
  name: "Shade Bandit",
  deck: [],
  hand: [
    createCard("blade-reserve", "Stolen Blade", 6, "blade"),
    createCard("fire-reserve", "Lantern", 0, "fire"),
    createCard("moon-reserve", "Moon Trinket", 0, "moon"),
  ],
  discard: [],
};

const playerOpponent: Fighter = {
  name: "Hero",
  deck: [],
  hand: [createCard("hero-reserve", "Guard Reserve", 1, "fire")],
  discard: [],
};

const board: AssignmentState<Card> = {
  [playerSide]: [createCard("hero-lane", "Frontliner", 4, "blade"), null, null],
  [cpuSide]: [createCard("bandit-lane", "Sneak", 2, "blade"), null, null],
};

const spellbook: SpellId[] = ["iceShard", "crosscut"];
const runtimeState: SpellRuntimeState = {};

const handSymbols = countSymbolsFromCards(cpuCaster.hand);
const visibleSpellIds = getVisibleSpellsForHand(handSymbols, spellbook);
const visibleSpells = getSpellDefinitions(visibleSpellIds);

assert.deepEqual(
  visibleSpellIds,
  ["iceShard", "crosscut"],
  "Bandit hand should reveal Ice Shard and Crosscut",
);

const deferredSpellCosts: Record<string, number[]> = {};
const casts: string[] = [];
let mana = 0;

for (let turn = 0; turn < 5; turn += 1) {
  mana += 1;

  const affordableSpells: Array<{ spell: SpellDefinition; cost: number }> = [];
  const deferredSpells: Array<{ spell: SpellDefinition; cost: number }> = [];

  visibleSpells.forEach((spell) => {
    const allowedPhases = spell.allowedPhases ?? ["choose"];
    if (!allowedPhases.includes("choose")) return;
    const cost = computeSpellCost(spell, {
      caster: cpuCaster,
      opponent: playerOpponent,
      phase: "choose",
      runtimeState,
    });
    const entry = { spell, cost };
    if (cost <= mana) {
      affordableSpells.push(entry);
    } else {
      deferredSpells.push(entry);
      deferredSpellCosts[spell.id] = [...(deferredSpellCosts[spell.id] ?? []), cost];
    }
  });

  if (affordableSpells.length === 0) {
    continue;
  }

  const decision = chooseCpuSpellResponse({
    casterSide: cpuSide,
    caster: cpuCaster,
    opponent: playerOpponent,
    board,
    reserveSums: null,
    initiative: playerSide,
    availableSpells: affordableSpells,
  });

  if (!decision) {
    continue;
  }

  if (deferredSpells.length > 0) {
    const minDeferredCost = deferredSpells.reduce(
      (lowest, entry) => Math.min(lowest, entry.cost),
      Number.POSITIVE_INFINITY,
    );
    const cheapThreshold = Math.min(CHEAP_SPELL_THRESHOLD, Math.max(0, minDeferredCost - 1));
    if (
      cheapThreshold > 0 &&
      decision.cost <= cheapThreshold &&
      mana - decision.cost < minDeferredCost
    ) {
      continue;
    }
  }

  casts.push(decision.spell.id);
  mana -= decision.cost;

  if (decision.spell.id === "crosscut") {
    break;
  }
}

assert.deepEqual(deferredSpellCosts.crosscut, [4, 4, 4], "Crosscut cost should be tracked while saving mana");
assert.deepEqual(casts, ["crosscut"], "CPU should hold mana and cast Crosscut once affordable");

console.log("cpu spell saving test passed");
