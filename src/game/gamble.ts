import { Card, LegacySide, TagId } from "./types";

export type GambleTagKind = "wager" | "coinflip" | "reroll" | "jackpot" | "legacy";

export type GambleTagMeta = {
  id: TagId;
  kind: GambleTagKind;
  label: string;
  badge: string;
  description: string;
  stake?: number;
};

const BASE_TAG_META: Record<TagId, GambleTagMeta> = {
  oddshift: {
    id: "oddshift",
    kind: "legacy",
    label: "Oddshift",
    badge: "Oddshift",
    description: "Legacy effect."
  },
  parityflip: {
    id: "parityflip",
    kind: "legacy",
    label: "Parity Flip",
    badge: "Parity",
    description: "Legacy effect."
  },
  echoreserve: {
    id: "echoreserve",
    kind: "legacy",
    label: "Echo Reserve",
    badge: "Echo",
    description: "Legacy effect."
  },
  wager1: {
    id: "wager1",
    kind: "wager",
    label: "Wager +1",
    badge: "+1",
    description: "Stake +1 bonus win on this wheel.",
    stake: 1
  },
  wager2: {
    id: "wager2",
    kind: "wager",
    label: "Wager +2",
    badge: "+2",
    description: "Stake +2 bonus wins on this wheel.",
    stake: 2
  },
  wager3: {
    id: "wager3",
    kind: "wager",
    label: "Wager +3",
    badge: "+3",
    description: "Stake +3 bonus wins on this wheel.",
    stake: 3
  },
  coinflip: {
    id: "coinflip",
    kind: "coinflip",
    label: "Coin Flip",
    badge: "Flip",
    description: "50% to double this card; 50% to bust."
  },
  reroll: {
    id: "reroll",
    kind: "reroll",
    label: "Reroll",
    badge: "Reroll",
    description: "Swap this card's value for a wild reroll before resolve."
  },
  jackpot: {
    id: "jackpot",
    kind: "jackpot",
    label: "Jackpot",
    badge: "Jackpot",
    description: "Feed the shared jackpot pot. Winner with Jackpot claims it all."
  },
};

export const getTagMeta = (tag: TagId): GambleTagMeta | undefined => BASE_TAG_META[tag];

export const getGambleBadges = (card: Card): GambleTagMeta[] =>
  (card.tags ?? [])
    .map((tag) => getTagMeta(tag))
    .filter((meta): meta is GambleTagMeta => !!meta && meta.kind !== "legacy");

export const getWagerStake = (tags: TagId[]): number =>
  tags.reduce((sum, tag) => {
    const meta = getTagMeta(tag);
    if (meta?.kind === "wager" && typeof meta.stake === "number") {
      return sum + meta.stake;
    }
    return sum;
  }, 0);

export const hasCoinFlip = (tags: TagId[]) => tags.some((tag) => getTagMeta(tag)?.kind === "coinflip");
export const hasReroll = (tags: TagId[]) => tags.some((tag) => getTagMeta(tag)?.kind === "reroll");
export const hasJackpot = (tags: TagId[]) => tags.some((tag) => getTagMeta(tag)?.kind === "jackpot");

export const describeTagStake = (meta: GambleTagMeta, lane: number, sideName: string) => {
  switch (meta.kind) {
    case "wager":
      return `${sideName} antes +${meta.stake} on wheel ${lane + 1}.`;
    case "coinflip":
      return `${sideName} flips for double-or-bust on wheel ${lane + 1}.`;
    case "reroll":
      return `${sideName} rerolls their value on wheel ${lane + 1}.`;
    case "jackpot":
      return `${sideName} feeds the jackpot on wheel ${lane + 1}.`;
    default:
      return `${sideName} readies ${meta.label}.`;
  }
};

export const makeAllInCard = (power: number): Card => ({
  id:
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `allin-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  name: "Jackpot Wild",
  type: "normal",
  number: power,
  tags: ["wager3", "jackpot"],
});

export const summarizeGambleEvent = (
  lane: number,
  side: LegacySide,
  text: string
) => `Wheel ${lane + 1} · ${side === "player" ? "Player" : "Enemy"}: ${text}`;
