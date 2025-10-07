import assert from "node:assert/strict";

import { decideRevealFlow } from "../src/features/threeWheel/utils/skillPhase.js";
import type { CorePhase } from "../src/game/types.js";

const choosePhase: CorePhase = "choose";
const roundEndPhase: CorePhase = "roundEnd";

assert.equal(
  decideRevealFlow({ currentPhase: choosePhase, isSkillMode: false, skillCompleted: false }),
  "revealRound",
  "Classic flow should reveal immediately when Skill Mode is disabled.",
);

assert.equal(
  decideRevealFlow({ currentPhase: choosePhase, isSkillMode: true, skillCompleted: false }),
  "revealRound",
  "Skill Mode no longer pauses the reveal flow before combat.",
);

assert.equal(
  decideRevealFlow({ currentPhase: choosePhase, isSkillMode: true, skillCompleted: true }),
  "revealRound",
  "Skill Mode continues to reveal even after abilities resolve.",
);

assert.equal(
  decideRevealFlow({ currentPhase: roundEndPhase, isSkillMode: true, skillCompleted: false }),
  "revealRound",
  "Non-choose phases still bypass any additional flow.",
);

console.log("Skill phase transition checks passed.");
