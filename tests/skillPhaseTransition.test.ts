import assert from "node:assert/strict";

import { determinePostResolvePhase } from "../src/features/threeWheel/utils/skillPhase.js";

assert.equal(
  determinePostResolvePhase({ isSkillMode: false, skillCompleted: false }),
  "roundEnd",
  "Classic flow should proceed directly to the round end phase.",
);

assert.equal(
  determinePostResolvePhase({ isSkillMode: true, skillCompleted: false }),
  "skill",
  "Skill Mode should enter the Skill phase after resolve when unfinished.",
);

assert.equal(
  determinePostResolvePhase({ isSkillMode: true, skillCompleted: true }),
  "roundEnd",
  "Skill Mode should skip the Skill phase once it has been completed.",
);

console.log("Skill phase transition checks passed.");
