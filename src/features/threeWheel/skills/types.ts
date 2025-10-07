import type { Card, LegacySide } from "../../../game/types";
import type { SkillAbility } from "../../../game/skills";
import type { SkillPhaseSnapshot } from "./skillPhaseMachine";

export type SkillOption = {
  lane: number;
  card: Card;
  ability: SkillAbility;
  description: string;
  canActivate: boolean;
  reason?: string;
};

export type SkillPhaseView = SkillPhaseSnapshot & {
  options: SkillOption[];
};

export type SkillTargetingState =
  | {
      kind: "reserve";
      ability: "swapReserve" | "reserveBoost" | "rerollReserve";
      side: LegacySide;
      laneIndex: number;
      targetsRemaining: number;
      targetsTotal: number;
    }
  | {
      kind: "lane";
      ability: "boostCard";
      side: LegacySide;
      laneIndex: number;
      targetsRemaining: number;
      targetsTotal: number;
    };

export type SkillTargetSelection =
  | {
      kind: "reserve";
      cardId: string;
    }
  | {
      kind: "lane";
      laneIndex: number;
    };
