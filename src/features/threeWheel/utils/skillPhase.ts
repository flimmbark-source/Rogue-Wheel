import type { CorePhase } from "../../../game/types";

export type RevealDecision = "skillPhase" | "revealRound";

export interface RevealFlowOptions {
  currentPhase: CorePhase;
  isSkillMode: boolean;
  skillCompleted: boolean;
}

export function decideRevealFlow({
  currentPhase,
  isSkillMode,
  skillCompleted,
}: RevealFlowOptions): RevealDecision {
  if (currentPhase !== "choose") {
    return "revealRound";
  }

  if (isSkillMode && !skillCompleted) {
    return "skillPhase";
  }

  return "revealRound";
}
