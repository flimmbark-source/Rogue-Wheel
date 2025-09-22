// src/game/types.ts
export const SLICES = 16 as const;
export const TARGET_WINS = 7 as const;

export type MatchModeId = "short" | "standard" | "marathon";

export type MatchModeConfig = {
  id: MatchModeId;
  name: string;
  description: string;
  targetWins: number;
  timerSeconds?: number | null;
};

export const DEFAULT_MATCH_MODE_ID: MatchModeId = "standard";

export const MATCH_MODE_PRESETS: Record<MatchModeId, MatchModeConfig> = {
  short: {
    id: "short",
    name: "Short",
    description: "Quick race to three wins with a brisk timer.",
    targetWins: 3,
    timerSeconds: 180,
  },
  standard: {
    id: "standard",
    name: "Standard",
    description: "Classic target of seven wins and no clock.",
    targetWins: TARGET_WINS,
    timerSeconds: null,
  },
  marathon: {
    id: "marathon",
    name: "Marathon",
    description: "Extended match to eleven wins with a long clock.",
    targetWins: 11,
    timerSeconds: 1200,
  },
};

export function resolveMatchMode(id: string | null | undefined): MatchModeConfig {
  if (!id) return MATCH_MODE_PRESETS[DEFAULT_MATCH_MODE_ID];
  if (id in MATCH_MODE_PRESETS) {
    return MATCH_MODE_PRESETS[id as MatchModeId];
  }
  return MATCH_MODE_PRESETS[DEFAULT_MATCH_MODE_ID];
}

/** New canonical sides for 2P */
export type Side = "left" | "right";

/** Back-compat with existing code that still uses 'player'/'enemy' */
export type LegacySide = "player" | "enemy";
export const SIDE_FROM_LEGACY: Record<LegacySide, Side> = {
  player: "left",
  enemy: "right",
};
export const LEGACY_FROM_SIDE: Record<Side, LegacySide> = {
  left: "player",
  right: "enemy",
};

/** Player metadata used by UI (names/colors) and networking (ids) */
export type PlayerId = string;
export type PlayerCore = {
  id: PlayerId;
  name: string;
  color: string; // UI accent for that side
};
export type Players = Record<Side, PlayerCore>;

export type TagId =
  | "oddshift"
  | "parityflip"
  | "echoreserve"
  | "swap"
  | "steal"
  | "decoy"
  | "reveal";

export type OddshiftMeta = { direction?: number };
export type ParityFlipMeta = { target?: "self" | "opponent" | "both"; amount?: number };
export type SwapMeta = { with?: number };
export type StealMeta = { from?: number };
export type EchoReserveMeta = { mode?: "copy-opponent" | "mirror" | "bonus"; bonus?: number };
export type RevealMeta = { lanes?: number | number[] };
export type DecoyMeta = { display?: string; reserveValue?: number };

export type CardMeta = {
  oddshift?: OddshiftMeta;
  parityflip?: ParityFlipMeta;
  swap?: SwapMeta;
  steal?: StealMeta;
  echoreserve?: EchoReserveMeta;
  reveal?: RevealMeta;
  decoy?: DecoyMeta;
};

export type LinkKind = "lane" | "numberMatch";

export type CardLinkDescriptor = {
  kind: LinkKind;
  key: string;
  label: string;
  bonusSteps: number;
  description?: string;
};

export type CardType = "normal" | "split";

export type Card = {
  id: string;
  name: string;
  type?: CardType;      // default "normal"
  number?: number;      // when type === "normal"
  leftValue?: number;   // when type === "split"
  rightValue?: number;  // when type === "split"
  tags: TagId[];
  meta?: CardMeta;
  hint?: string;
  multiLane?: boolean;
  linkDescriptors?: CardLinkDescriptor[];
};

export type VC =
  | "Strongest"
  | "Weakest"
  | "ReserveSum"
  | "ClosestToTarget"
  | "Initiative";

export type WheelArchetype = "bandit" | "sorcerer" | "beast" | "guardian" | "chaos";

export type Section = {
  id: VC;
  color: string;
  start: number;
  end: number;
  target?: number;
};

export const SORCERER_PERKS = [
  "arcaneOverflow",
  "spellEcho",
  "planarSwap",
  "recallMastery",
] as const;

export type SorcererPerk = (typeof SORCERER_PERKS)[number];

export type Fighter = {
  name: string;
  deck: Card[];
  hand: Card[];
  discard: Card[];
  mana: number;
  perks: SorcererPerk[];
};

/** Helpful 2P maps (optional, but convenient) */
export type HandMap = Record<Side, Card[]>;
export type ChosenCardMap = Partial<Record<Side, Card>>;
export type NumberBySide = Record<Side, number>;

// Activation support
export type SplitChoiceMap = Record<string, "left" | "right">;