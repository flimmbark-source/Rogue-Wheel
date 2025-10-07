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
  "skillPhase",
  "Skill Mode should enter the Skill Phase before combat when unresolved.",
);

assert.equal(
  decideRevealFlow({ currentPhase: choosePhase, isSkillMode: true, skillCompleted: true }),
  "revealRound",
  "Skill Mode should continue to reveal once the Skill Phase is complete.",
);

assert.equal(
  decideRevealFlow({ currentPhase: roundEndPhase, isSkillMode: true, skillCompleted: false }),
  "revealRound",
  "Non-choose phases should bypass the Skill Phase entirely.",
);

type ModeScenario = {
  label: string;
  phase: CorePhase;
  skillCompleted: boolean;
  expected: ReturnType<typeof decideRevealFlow>;
};

const grimoireRegressionCases: ModeScenario[] = [
  { label: "Grimoire choose", phase: "choose", skillCompleted: true, expected: "revealRound" },
  { label: "Ante roundEnd", phase: "roundEnd", skillCompleted: false, expected: "revealRound" },
];

grimoireRegressionCases.forEach(({ label, phase, skillCompleted, expected }) => {
  assert.equal(
    decideRevealFlow({ currentPhase: phase, isSkillMode: false, skillCompleted }),
    expected,
    `${label} should continue to match pre-skill behaviour.`,
  );
});

console.log("Skill phase transition checks passed.");
