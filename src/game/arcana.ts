import type { Card, Arcana, TagId } from "./types.js";
import { isSplit } from "./values.js";

export const ARCANA_EMOJI: Record<Arcana, string> = {
  fire: "🔥",
  blade: "🗡️",
  eye: "👁️",
  moon: "🌒",
  serpent: "🐍",
};

export const ARCANA_TEXT_CLASS: Record<Arcana, string> = {
  fire: "text-orange-300",
  blade: "text-sky-200",
  eye: "text-violet-200",
  moon: "text-slate-200",
  serpent: "text-emerald-300",
};

const TAG_TO_ARCANA: Partial<Record<TagId, Arcana>> = {
  oddshift: "serpent",
  parityflip: "blade",
  echoreserve: "eye",
};

const ARCANA_ORDER: Arcana[] = ["fire", "blade", "eye", "moon", "serpent"];

function inferArcanaFromValue(value: number): Arcana {
  const normalized = Number.isFinite(value) ? Math.abs(Math.round(value)) : 0;
  const index = normalized % ARCANA_ORDER.length;
  return ARCANA_ORDER[index] ?? "fire";
}

export function deriveArcanaForCard(card: Card): Arcana {
  if (card.arcana && ARCANA_ORDER.includes(card.arcana)) {
    return card.arcana;
  }

  const tagged = card.tags?.find((tag) => TAG_TO_ARCANA[tag]);
  if (tagged) {
    return TAG_TO_ARCANA[tagged] ?? "fire";
  }

  const baseValue = isSplit(card)
    ? (card.leftValue ?? 0) + (card.rightValue ?? 0)
    : card.number ?? 0;

  return inferArcanaFromValue(baseValue);
}

export function getCardArcana(card: Card): Arcana {
  return deriveArcanaForCard(card);
}

export function getArcanaIcon(arcana: Arcana): string {
  return ARCANA_EMOJI[arcana];
}

export function getArcanaTextClass(arcana?: Arcana | null, fallback = "text-slate-200"): string {
  if (!arcana) return fallback;
  return ARCANA_TEXT_CLASS[arcana] ?? fallback;
}

export function matchesArcana(arcana: Arcana | undefined, requirement?: Arcana | Arcana[]): boolean {
  if (!requirement) return true;
  if (!arcana) return false;
  if (Array.isArray(requirement)) {
    return requirement.includes(arcana);
  }
  return arcana === requirement;
}

export function arcanaListToIcons(requirement?: Arcana | Arcana[]): string[] {
  if (!requirement) return [];
  const list = Array.isArray(requirement) ? requirement : [requirement];
  return list.map((arcana) => ARCANA_EMOJI[arcana]);
}
