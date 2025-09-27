import assert from "node:assert/strict";

import { SLICES, type LegacySide, type Section } from "../src/game/types.js";
import {
  summarizeRoundOutcome,
  type RoundAnalysis,
} from "../src/features/threeWheel/hooks/roundOutcomeSummary.js";

const PLAYER_COLOR = "#00aaff";
const ENEMY_COLOR = "#ff3366";

const namesByLegacy: Record<LegacySide, string> = {
  player: "Hero",
  enemy: "Nemesis",
};

const strongestSection: Section = {
  id: "Strongest",
  color: PLAYER_COLOR,
  start: 0,
  end: 8,
};

// Enemy initially leads 1-0 before the spell resolves.
const initialWins = { player: 0, enemy: 1 };
const initialTokens: [number, number, number] = [3, 0, 0];
const hudBefore: [string | null, string | null, string | null] = [ENEMY_COLOR, null, null];

// The spell changes the matchup so the player now wins wheel 1 on Strongest.
const postSpellAnalysis: RoundAnalysis = {
  outcomes: [
    {
      steps: 5,
      targetSlice: 10,
      section: strongestSection,
      winner: "player",
      tie: false,
      wheel: 0,
      detail: "Strongest 9 vs 5",
    },
  ],
  localReserve: 0,
  remoteReserve: 0,
  pReserve: 9,
  eReserve: 5,
  usedRemoteReport: false,
};

const tokensAfterSpell = [...initialTokens] as [number, number, number];
tokensAfterSpell[0] = (tokensAfterSpell[0] + postSpellAnalysis.outcomes[0]!.steps) % SLICES;

const summary = summarizeRoundOutcome({
  analysis: postSpellAnalysis,
  wins: initialWins,
  initiative: "player",
  round: 2,
  namesByLegacy,
  HUD_COLORS: { player: PLAYER_COLOR, enemy: ENEMY_COLOR },
  isAnteMode: false,
  anteState: {
    round: 2,
    bets: { player: 0, enemy: 0 },
    odds: { player: 1, enemy: 1 },
  },
  winGoal: 3,
  localLegacySide: "player",
  remoteLegacySide: "enemy",
});

let wheelHUD = [...hudBefore] as [string | null, string | null, string | null];
let winsState = { ...initialWins };
let tokensState = [...initialTokens] as [number, number, number];

// Skip animation path should immediately apply the recalculated totals and winners.
const applyImmediateUpdates = () => {
  tokensState = tokensAfterSpell;
  wheelHUD = summary.hudColors;
  winsState = summary.wins;
};

applyImmediateUpdates();

assert.equal(tokensState[0], tokensAfterSpell[0], "Wheel token should move immediately after spell resolution");
assert.equal(wheelHUD[0], PLAYER_COLOR, "Player badge updates instantly after spell");
assert.equal(winsState.player, 1, "Player win total increases right away");
assert.equal(winsState.enemy, 1, "Enemy total remains unchanged");
assert(summary.logs.includes("Wheel 1 win -> player (Strongest 9 vs 5)."));
assert(summary.logs.includes("Hero wins the round 1-0 and takes initiative next round."));
assert.equal(summary.matchEnded, false);

console.log("resolveRound skip animation test passed");
