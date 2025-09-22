// src/game/types.ts
export const SLICES = 16 as const;
export const TARGET_WINS = 7 as const;

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
};

export type VC =
  | "Strongest"
  | "Weakest"
  | "ReserveSum"
  | "ClosestToTarget"
  | "Initiative";

export type Section = {
  id: VC;
  color: string;
  start: number;
  end: number;
  target?: number;
};

export type Fighter = {
  name: string;
  deck: Card[];
  hand: Card[];
  discard: Card[];
};

/** Helpful 2P maps (optional, but convenient) */
export type HandMap = Record<Side, Card[]>;
export type ChosenCardMap = Partial<Record<Side, Card>>;
export type NumberBySide = Record<Side, number>;

// Activation support
export type SplitChoiceMap = Record<string, "left" | "right">;