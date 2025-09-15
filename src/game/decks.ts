// src/game/decks.ts
import { Card, Fighter } from "./types";
import { shuffle } from "./math";

const uid = (() => { let i = 1; return () => `C${i++}`; })();

export function starterDeck(): Card[] {
  const base: Card[] = Array.from({ length: 10 }, (_, n) => ({
    id: uid(),
    name: `${n}`,
    type: "normal",
    number: n,
    tags: [],
  }));
  return shuffle(base);
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
