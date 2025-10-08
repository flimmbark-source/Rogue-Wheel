import { isNormal } from "../../../game/values";
import { refillTo } from "../../../player/profileStore";
import type { Card, Fighter, LegacySide } from "../../../game/types";

const MIN_WHEEL = 160;

export function calcWheelSize(viewH: number, viewW: number, dockAllowance = 0) {
  const isMobile = viewW <= 480;
  const chromeAllowance = viewW >= 1024 ? 200 : 140;
  const raw = Math.floor((viewH - chromeAllowance - dockAllowance) / 3);
  const MOBILE_MAX = 188;
  const DESKTOP_MAX = 220;
  const maxAllowed = isMobile ? MOBILE_MAX : DESKTOP_MAX;
  return Math.max(MIN_WHEEL, Math.min(maxAllowed, raw));
}

export function autoPickEnemy(hand: Card[]): (Card | null)[] {
  const pool = [...hand].filter(isNormal);
  const picks: (Card | null)[] = [null, null, null];
  const take = (c: typeof pool[number]) => {
    const k = pool.indexOf(c);
    if (k >= 0) pool.splice(k, 1);
    return c;
  };
  const best = [...pool].sort((a, b) => (b.number ?? 0) - (a.number ?? 0))[0];
  if (best) picks[0] = take(best);
  const low = [...pool].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))[0];
  if (low) picks[1] = take(low);
  const sorted = [...pool].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  const mid = sorted[Math.floor(sorted.length / 2)];
  if (mid) picks[2] = take(mid);
  for (let i = 0; i < 3; i++) if (!picks[i] && pool.length) picks[i] = take(pool[0]!);
  return picks;
}

export function computeReserveSum(
  who: LegacySide,
  used: (Card | null)[],
  hands: Record<LegacySide, Card[]>
) {
  const hand = hands[who] ?? [];
  const usedIds = new Set((used.filter(Boolean) as Card[]).map((c) => c.id));
  const left = hand.filter((c) => !usedIds.has(c.id));
  return left.slice(0, 2).reduce((a, c) => a + (isNormal(c) ? c.number ?? 0 : 0), 0);
}

export function settleFighterAfterRound(f: Fighter, played: Card[]): Fighter {
  const playedIds = new Set(played.map((c) => c.id));
  const leftovers = f.hand.filter((c) => !playedIds.has(c.id));
  const next: Fighter = {
    name: f.name,
    deck: [...f.deck],
    hand: [],
    discard: [...f.discard, ...played, ...leftovers],
    exhaust: [...f.exhaust],
  };

  const refilled = refillTo(next, 5);

  return ensureFiveHand(refilled, 5);
}

export function ensureFiveHand<T extends Fighter>(f: T, TARGET = 5): T {
  if (f.hand.length >= TARGET) return f;

  const padded = [...f.hand];
  while (padded.length < TARGET) {
    padded.push({
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `pad-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: "Reserve",
      number: 0,
      baseNumber: 0,
      kind: "normal",
    } as unknown as Card);
  }
  return { ...f, hand: padded } as T;
}
