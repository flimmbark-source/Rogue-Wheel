import type { SpellId } from "./archetypes";
import type { Phase } from "./types";

export type SpellDefinition = {
  id: SpellId;
  name: string;
  cost: number;
  description: string;
  icon?: string;
  allowedPhases?: Phase[];
};

const SPELL_CATALOGUE: Record<SpellId, SpellDefinition> = {
  smokeBomb: {
    id: "smokeBomb",
    name: "Smoke Bomb",
    cost: 1,
    description: "Obscure an enemy slot so it cannot be targeted until the round resets.",
    icon: "💨",
    allowedPhases: ["choose"],
  },
  shadowStep: {
    id: "shadowStep",
    name: "Shadow Step",
    cost: 2,
    description: "Swap one of your assigned cards with another wheel slot you control.",
    icon: "🕳️",
    allowedPhases: ["choose"],
  },
  cutpurse: {
    id: "cutpurse",
    name: "Cutpurse",
    cost: 2,
    description: "Steal 1 mana from the opponent if they have any remaining this round.",
    icon: "🪙",
    allowedPhases: ["choose"],
  },
  ambush: {
    id: "ambush",
    name: "Ambush",
    cost: 3,
    description: "Mark a wheel to deal 2 bonus damage if you win it during resolution.",
    icon: "🗡️",
    allowedPhases: ["showEnemy", "anim"],
  },
  timeWarp: {
    id: "timeWarp",
    name: "Time Warp",
    cost: 3,
    description: "Shift every wheel pointer forward by 2 before resolution.",
    icon: "⏳",
    allowedPhases: ["choose"],
  },
  arcaneShield: {
    id: "arcaneShield",
    name: "Arcane Shield",
    cost: 2,
    description: "Mirror the opponent's revealed value on a wheel during resolution.",
    icon: "🛡️",
    allowedPhases: ["showEnemy", "anim"],
  },
  manaSurge: {
    id: "manaSurge",
    name: "Mana Surge",
    cost: 2,
    description: "Refresh 2 mana and draw a replacement card at round end.",
    icon: "✨",
    allowedPhases: ["roundEnd"],
  },
  scry: {
    id: "scry",
    name: "Scry",
    cost: 1,
    description: "Peek at the next card in your deck; optionally swap it with one in hand.",
    icon: "🔮",
    allowedPhases: ["choose"],
  },
  feralRoar: {
    id: "feralRoar",
    name: "Feral Roar",
    cost: 1,
    description: "Force the opponent to reroll one of their assigned cards before reveal.",
    icon: "🦁",
    allowedPhases: ["choose"],
  },
  pounce: {
    id: "pounce",
    name: "Pounce",
    cost: 2,
    description: "Move one of your cards to an empty wheel slot and add +1 to its value.",
    icon: "🐾",
    allowedPhases: ["choose"],
  },
  packTactics: {
    id: "packTactics",
    name: "Pack Tactics",
    cost: 3,
    description: "Duplicate one of your wheel results when determining reserve totals.",
    icon: "🐺",
    allowedPhases: ["showEnemy", "anim"],
  },
  regenerate: {
    id: "regenerate",
    name: "Regenerate",
    cost: 2,
    description: "Gain 1 mana and heal 1 damage on each wheel you control this round.",
    icon: "🌿",
    allowedPhases: ["roundEnd"],
  },
};

export function getSpellDefinition(spellId: SpellId): SpellDefinition | undefined {
  return SPELL_CATALOGUE[spellId];
}

export function getSpellDefinitions(spellIds: SpellId[]): SpellDefinition[] {
  return spellIds
    .map((spellId) => getSpellDefinition(spellId))
    .filter((spell): spell is SpellDefinition => Boolean(spell));
}

