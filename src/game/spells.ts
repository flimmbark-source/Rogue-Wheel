import type { Fighter, Phase } from "./types";

export type SpellArchetype = "wanderer" | "bandit" | "sorcerer" | "beast";

export type SpellDefinition = {
  id: string;
  name: string;
  cost: number;
  description: string;
  icon?: string;
  allowedPhases?: Phase[];
};

const SPELLBOOK: Record<SpellArchetype, SpellDefinition[]> = {
  wanderer: [
    {
      id: "spark-bolt",
      name: "Spark Bolt",
      cost: 1,
      description: "Send a jolt through a visible enemy card, reducing its value by 1.",
      icon: "⚡",
      allowedPhases: ["choose"],
    },
    {
      id: "lightstep",
      name: "Lightstep",
      cost: 2,
      description: "Swap one of your assigned cards with another in hand.",
      icon: "🚶",
      allowedPhases: ["choose"],
    },
    {
      id: "aether-wash",
      name: "Aether Wash",
      cost: 3,
      description: "Return all cards from discard to hand, then redraw down to five.",
      icon: "💧",
      allowedPhases: ["roundEnd"],
    },
  ],
  bandit: [
    {
      id: "smokescreen",
      name: "Smokescreen",
      cost: 1,
      description: "Obscure one enemy slot so it cannot be targeted this round.",
      icon: "💨",
      allowedPhases: ["choose"],
    },
    {
      id: "blade-flurry",
      name: "Blade Flurry",
      cost: 2,
      description: "Increase the value of one of your revealed cards by 2 for this round.",
      icon: "🗡️",
      allowedPhases: ["showEnemy", "anim"],
    },
    {
      id: "cut-purse",
      name: "Cut Purse",
      cost: 3,
      description: "Steal 2 mana from the opponent if they have any remaining.",
      icon: "🪙",
      allowedPhases: ["choose"],
    },
  ],
  sorcerer: [
    {
      id: "scry",
      name: "Scry",
      cost: 1,
      description: "Peek at the top card of your deck and optionally draw it.",
      icon: "🔮",
      allowedPhases: ["choose"],
    },
    {
      id: "arcane-shift",
      name: "Arcane Shift",
      cost: 2,
      description: "Change the victory condition of the current wheel to Closest to Target.",
      icon: "🌀",
      allowedPhases: ["choose"],
    },
    {
      id: "mana-surge",
      name: "Mana Surge",
      cost: 3,
      description: "Refresh 2 mana and draw a card.",
      icon: "✨",
      allowedPhases: ["roundEnd"],
    },
  ],
  beast: [
    {
      id: "feral-roar",
      name: "Feral Roar",
      cost: 1,
      description: "Force the opponent to reroll their chosen card on a wheel.",
      icon: "🦁",
      allowedPhases: ["choose"],
    },
    {
      id: "pack-hunt",
      name: "Pack Hunt",
      cost: 2,
      description: "Duplicate one of your assigned cards for this resolution.",
      icon: "🐺",
      allowedPhases: ["showEnemy"],
    },
    {
      id: "alpha-claim",
      name: "Alpha Claim",
      cost: 3,
      description: "Seize initiative for the next round.",
      icon: "👑",
      allowedPhases: ["roundEnd"],
    },
  ],
};

const ARCHETYPES: SpellArchetype[] = ["wanderer", "bandit", "sorcerer", "beast"];

function isSpellArchetype(value: unknown): value is SpellArchetype {
  return typeof value === "string" && (ARCHETYPES as string[]).includes(value);
}

export function inferSpellArchetypeFromFighter(fighter: Fighter): SpellArchetype {
  const maybeArchetype = (fighter as Fighter & { archetype?: unknown }).archetype;
  if (isSpellArchetype(maybeArchetype)) {
    return maybeArchetype;
  }

  const normalized = fighter.name?.toLowerCase?.() ?? "";
  if (normalized.includes("bandit")) return "bandit";
  if (normalized.includes("sorcerer")) return "sorcerer";
  if (normalized.includes("beast")) return "beast";
  return "wanderer";
}

export function getSpellbookForArchetype(archetype: SpellArchetype): SpellDefinition[] {
  return SPELLBOOK[archetype] ?? [];
}

export function getLearnedSpellsForFighter(fighter: Fighter): SpellDefinition[] {
  const archetype = inferSpellArchetypeFromFighter(fighter);
  const book = getSpellbookForArchetype(archetype);
  const learned = (fighter as Fighter & { learnedSpells?: unknown }).learnedSpells;

  if (Array.isArray(learned) && learned.length > 0) {
    const allowed = new Set(learned.filter((id): id is string => typeof id === "string"));
    if (allowed.size > 0) {
      return book.filter((spell) => allowed.has(spell.id));
    }
  }

  return book;
}
