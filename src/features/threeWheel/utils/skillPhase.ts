import type { CorePhase } from "../../../game/types";

export interface PostResolvePhaseOptions {
  isSkillMode: boolean;
  skillCompleted: boolean;
}

export function determinePostResolvePhase({
  isSkillMode,
  skillCompleted,
}: PostResolvePhaseOptions): CorePhase {
  if (isSkillMode && !skillCompleted) {
    return "skill";
  }

  return "roundEnd";
}
