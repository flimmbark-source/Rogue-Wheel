import { getCardArcana } from "./arcana";
import type { Card, Arcana } from "./types";
import type { SpellId } from "./spells";

export const GRIMOIRE_SYMBOL_ORDER: Arcana[] = [
  "fire",
  "blade",
  "eye",
  "moon",
  "serpent",
];

export type GrimoireSymbols = Record<Arcana, number>;

export const MAX_GRIMOIRE_SYMBOLS = 10;

export const DEFAULT_GRIMOIRE_SYMBOLS: GrimoireSymbols = {
  fire: 2,
  blade: 2,
  eye: 2,
  moon: 2,
  serpent: 2,
};

export type GrimoireRequirement = Partial<Record<Arcana, number>>;

export const GRIMOIRE_SPELL_REQUIREMENTS: Record<SpellId, GrimoireRequirement> = {
  fireball: { fire: 3 },
  kindle: { fire: 2, moon: 2 },
  hex: { serpent: 3 },
  mirrorImage: { eye: 3, moon: 1 },
  iceShard: { moon: 3 },
  suddenStrike: { blade: 3 },
  crosscut: { blade: 2, fire: 1 },
  leech: { serpent: 2, eye: 1 },
  arcaneShift: { eye: 4 },
  timeTwist: { moon: 1, eye: 2, serpent: 1 },
  offering: { fire: 2, serpent: 2 },
  phantom: { moon: 2, blade: 1, eye: 1 },
};

const SPELL_PRIORITY: SpellId[] = [
  "fireball",
  "kindle",
  "hex",
  "mirrorImage",
  "iceShard",
  "suddenStrike",
  "crosscut",
  "leech",
  "arcaneShift",
  "timeTwist",
  "offering",
  "phantom",
];

export function createEmptySymbolMap(): GrimoireSymbols {
  return GRIMOIRE_SYMBOL_ORDER.reduce<GrimoireSymbols>((acc, arcana) => {
    acc[arcana] = 0;
    return acc;
  }, {} as GrimoireSymbols);
}

export function clampSymbols(raw: Partial<Record<Arcana, number>> | null | undefined): GrimoireSymbols {
  const base = createEmptySymbolMap();
  if (raw) {
    for (const arcana of GRIMOIRE_SYMBOL_ORDER) {
      const incoming = raw[arcana];
      if (typeof incoming === "number" && Number.isFinite(incoming)) {
        base[arcana] = Math.max(0, Math.floor(incoming));
      }
    }
  }

  let total = GRIMOIRE_SYMBOL_ORDER.reduce((sum, arcana) => sum + base[arcana], 0);
  if (total <= MAX_GRIMOIRE_SYMBOLS) {
    return base;
  }

  let overflow = total - MAX_GRIMOIRE_SYMBOLS;
  for (const arcana of [...GRIMOIRE_SYMBOL_ORDER].reverse()) {
    if (overflow <= 0) break;
    const available = base[arcana];
    if (available <= 0) continue;
    const deduct = Math.min(available, overflow);
    base[arcana] = available - deduct;
    overflow -= deduct;
  }

  return base;
}

export function countSymbolsFromCards(cards: Card[]): GrimoireSymbols {
  const counts = createEmptySymbolMap();
  for (const card of cards) {
    if (card.tags?.includes("grimoireFiller")) continue;
    const arcana = getCardArcana(card);
    if (arcana && arcana in counts) {
      counts[arcana as Arcana] += 1;
    }
  }
  return counts;
}

export function requirementSatisfied(symbols: GrimoireSymbols, requirement: GrimoireRequirement | undefined): boolean {
  if (!requirement) return true;
  for (const [arcana, needed] of Object.entries(requirement)) {
    if (!arcana || typeof needed !== "number") continue;
    const key = arcana as Arcana;
    if ((symbols[key] ?? 0) < needed) {
      return false;
    }
  }
  return true;
}

export function getSpellsForSymbols(symbols: GrimoireSymbols): SpellId[] {
  const available: SpellId[] = [];
  for (const id of SPELL_PRIORITY) {
    if (requirementSatisfied(symbols, GRIMOIRE_SPELL_REQUIREMENTS[id])) {
      available.push(id);
    }
  }
  return available;
}

export function symbolsTotal(symbols: GrimoireSymbols): number {
  return GRIMOIRE_SYMBOL_ORDER.reduce((sum, arcana) => sum + (symbols[arcana] ?? 0), 0);
}
