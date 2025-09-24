import assert from "node:assert/strict";

import {
  isChooseLikePhase,
  shouldShowSlotCard,
  type LegacySide,
} from "../src/features/threeWheel/utils/slotVisibility.js";

const player: LegacySide = "player";
const enemy: LegacySide = "enemy";

// Enemy card hidden during choose phase when it isn't targetable.
assert.equal(
  shouldShowSlotCard({
    hasCard: true,
    slotSide: enemy,
    localLegacySide: player,
    isPhaseChooseLike: isChooseLikePhase("choose"),
    slotTargetable: false,
  }),
  false,
  "Enemy slots should remain hidden during a normal choose phase",
);

// Enemy card remains visible when it is a valid target during spell targeting.
assert.equal(
  shouldShowSlotCard({
    hasCard: true,
    slotSide: enemy,
    localLegacySide: player,
    isPhaseChooseLike: isChooseLikePhase("spellTargeting"),
    slotTargetable: true,
  }),
  true,
  "Targetable enemy slots should stay visible while selecting spell targets",
);

// Friendly cards are always visible to the local player when present.
assert.equal(
  shouldShowSlotCard({
    hasCard: true,
    slotSide: player,
    localLegacySide: player,
    isPhaseChooseLike: isChooseLikePhase("spellTargeting"),
    slotTargetable: false,
  }),
  true,
  "Friendly slots should remain visible whenever a card is present",
);

console.log("slotVisibility tests passed");
