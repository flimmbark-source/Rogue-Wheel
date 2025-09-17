// src/game/decks.ts
import { Card, Fighter } from "./types";
import { shuffle } from "./math";
import { getProfileBundle } from "../local/decks";

const uid = (() => { let i = 1; return () => `C${i++}`; })();

export function starterDeck(): Card[] {
  const profileDeck = loadActiveProfileDeck();
  if (profileDeck) {
    return shuffle(profileDeck);
  }

  const base: Card[] = Array.from({ length: 10 }, (_, n) => ({
    id: uid(),
    name: `${n}`,
    type: "normal",
    number: n,
    tags: [],
  }));
  return shuffle(base);
}

function loadActiveProfileDeck(): Card[] | null {
  if (typeof window === "undefined") return null;
  try {
    const { active } = getProfileBundle();
    if (!active) return null;
    const cards: Card[] = [];
    for (const entry of active.cards) {
      for (let i = 0; i < entry.qty; i += 1) {
        cards.push(cardFromId(entry.cardId));
      }
    }
    return cards.length ? cards : null;
  } catch (err) {
    console.warn("starterDeck: failed to load profile deck", err);
    return null;
  }
}

function cardFromId(cardId: string): Card {
  const nextId = uid();
  if (cardId.startsWith("split_")) {
    const [leftRaw, rightRaw] = cardId.replace("split_", "").split("|");
    const left = parseCardNumber(leftRaw);
    const right = parseCardNumber(rightRaw);
    return {
      id: nextId,
      name: `Split ${formatSigned(left)} | ${formatSigned(right)}`,
      type: "split",
      leftValue: left,
      rightValue: right,
      tags: [],
    };
  }

  const value = (() => {
    if (cardId.startsWith("basic_")) return parseCardNumber(cardId.split("_")[1]);
    if (cardId.startsWith("neg_")) return parseCardNumber(cardId.split("_")[1]);
    return parseCardNumber(cardId);
  })();

  return {
    id: nextId,
    name: formatSigned(value),
    type: "normal",
    number: value,
    tags: [],
  };
}

function parseCardNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

export function makeFighter(name: string): Fighter {
  const deck = starterDeck();
  return refillTo({ name, deck, hand: [], discard: [] }, 5);
}

export function drawOne(f: Fighter): Fighter {
  const next = { ...f, deck: [...f.deck], hand: [...f.hand], discard: [...f.discard] };
  if (next.deck.length === 0 && next.discard.length > 0) {
    next.deck = shuffle(next.discard);
    next.discard = [];
  }
  if (next.deck.length) next.hand.push(next.deck.shift()!);
  return next;
}

export function refillTo(f: Fighter, target: number): Fighter {
  let cur = { ...f };
  while (cur.hand.length < target) {
    const before = cur.hand.length;
    cur = drawOne(cur);
    if (cur.hand.length === before) break;
  }
  return cur;
}

export function freshFive(f: Fighter): Fighter {
  const pool = shuffle([...f.deck, ...f.hand, ...f.discard]);
  const hand = pool.slice(0, 5);
  const deck = pool.slice(5);
  return { name: f.name, hand, deck, discard: [] };
}
