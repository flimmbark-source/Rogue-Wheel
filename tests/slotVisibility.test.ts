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
    revealBoardDuringSpell: false,
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
    revealBoardDuringSpell: false,
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
    revealBoardDuringSpell: false,
  }),
  true,
  "Friendly slots should remain visible whenever a card is present",
);

// All board cards are revealed while the local player is casting a spell.
assert.equal(
  shouldShowSlotCard({
    hasCard: true,
    slotSide: enemy,
    localLegacySide: player,
    isPhaseChooseLike: isChooseLikePhase("spellTargeting"),
    slotTargetable: false,
    revealBoardDuringSpell: true,
  }),
  true,
  "Enemy slots should be revealed when the local player is casting a spell",
);

console.log("slotVisibility tests passed");
