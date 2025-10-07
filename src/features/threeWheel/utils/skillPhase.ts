import type { CorePhase } from "../../../game/types";

export type RevealDecision = "skillPhase" | "revealRound";

export interface RevealFlowOptions {
  currentPhase: CorePhase;
  isSkillMode: boolean;
  skillCompleted: boolean;
}

export function decideRevealFlow({
  currentPhase,
}: RevealFlowOptions): RevealDecision {
  if (currentPhase !== "choose") {
    return "revealRound";
  }

  return "revealRound";
}
