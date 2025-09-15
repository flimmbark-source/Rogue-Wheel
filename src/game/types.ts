// src/game/types.ts
export const SLICES = 16 as const;
export const TARGET_WINS = 7 as const;

export type Side = "player" | "enemy";
export type TagId = "oddshift" | "parityflip" | "echoreserve";

export type CardType = "normal" | "split";

export type Card = {
  id: string;
  name: string;
  type?: CardType;   // default "normal"
  number?: number;   // when type === "normal"
  leftValue?: number;  // when type === "split"
  rightValue?: number; // when type === "split"
  tags: TagId[];
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

// Activation support
export type SplitChoiceMap = Record<string, "left" | "right">;
