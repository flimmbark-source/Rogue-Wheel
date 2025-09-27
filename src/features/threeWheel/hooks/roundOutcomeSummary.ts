import type { LegacySide, Section } from "../../../game/types";

type WheelOutcome = {
  steps: number;
  targetSlice: number;
  section: Section;
  winner: LegacySide | null;
  tie: boolean;
  wheel: number;
  detail: string;
};

export type RoundAnalysis = {
  outcomes: WheelOutcome[];
  localReserve: number;
  remoteReserve: number;
  pReserve: number;
  eReserve: number;
  usedRemoteReport: boolean;
};

export type AnteSnapshot = {
  round: number;
  bets: Record<LegacySide, number>;
  odds: Record<LegacySide, number>;
};

export type RoundOutcomeSummaryInput = {
  analysis: RoundAnalysis;
  wins: { player: number; enemy: number };
  initiative: LegacySide;
  round: number;
  namesByLegacy: Record<LegacySide, string>;
  HUD_COLORS: { player: string; enemy: string };
  isAnteMode: boolean;
  anteState: AnteSnapshot;
  winGoal: number;
  localLegacySide: LegacySide;
  remoteLegacySide: LegacySide;
};

export type RoundOutcomeSummary = {
  hudColors: [string | null, string | null, string | null];
  wins: { player: number; enemy: number };
  nextInitiative: LegacySide;
  roundWinner: LegacySide | null;
  logs: string[];
  shouldResetAnte: boolean;
  matchEnded: boolean;
};

export function summarizeRoundOutcome({
  analysis,
  wins,
  initiative,
  round,
  namesByLegacy,
  HUD_COLORS,
  isAnteMode,
  anteState,
  winGoal,
  localLegacySide,
  remoteLegacySide,
}: RoundOutcomeSummaryInput): RoundOutcomeSummary {
  const { outcomes } = analysis;

  let pWins = wins.player;
  let eWins = wins.enemy;
  const hudColors: [string | null, string | null, string | null] = [null, null, null];
  const roundWinsCount: Record<LegacySide, number> = { player: 0, enemy: 0 };
  const logs: string[] = [];

  outcomes.forEach((o) => {
    if (o.tie) {
      logs.push(`Wheel ${o.wheel + 1} tie: ${o.detail} — no win.`);
    } else if (o.winner) {
      hudColors[o.wheel] = HUD_COLORS[o.winner];
      roundWinsCount[o.winner] += 1;
      if (o.winner === "player") pWins++;
      else eWins++;
      logs.push(`Wheel ${o.wheel + 1} win -> ${o.winner} (${o.detail}).`);
    }
  });

  const playerRoundWins = roundWinsCount.player;
  const enemyRoundWins = roundWinsCount.enemy;
  const roundWinner: LegacySide | null =
    playerRoundWins === enemyRoundWins
      ? null
      : playerRoundWins > enemyRoundWins
          ? "player"
          : "enemy";

  let shouldResetAnte = false;
  if (isAnteMode && anteState.round === round) {
    const { bets, odds } = anteState;
    if (bets.player !== 0 || bets.enemy !== 0) {
      shouldResetAnte = true;
    }

    if (roundWinner === "player") {
      const profit = Math.round(bets.player * Math.max(0, odds.player - 1));
      const loss = bets.enemy;
      if (profit > 0) {
        pWins += profit;
        logs.push(`${namesByLegacy.player} wins ante (+${profit}).`);
      }
      if (loss > 0) {
        const nextEnemy = Math.max(0, eWins - loss);
        if (nextEnemy !== eWins) {
          eWins = nextEnemy;
          logs.push(`${namesByLegacy.enemy} loses ante (-${loss}).`);
        }
      }
    } else if (roundWinner === "enemy") {
      const profit = Math.round(bets.enemy * Math.max(0, odds.enemy - 1));
      const loss = bets.player;
      if (profit > 0) {
        eWins += profit;
        logs.push(`${namesByLegacy.enemy} wins ante (+${profit}).`);
      }
      if (loss > 0) {
        const nextPlayer = Math.max(0, pWins - loss);
        if (nextPlayer !== pWins) {
          pWins = nextPlayer;
          logs.push(`${namesByLegacy.player} loses ante (-${loss}).`);
        }
      }
    } else if (bets.player > 0 || bets.enemy > 0) {
      logs.push(`Ante pushes on a tie.`);
    }
  }

  const roundScore = `${roundWinsCount.player}-${roundWinsCount.enemy}`;
  let nextInitiative: LegacySide;
  if (roundWinner === null) {
    nextInitiative = initiative === "player" ? "enemy" : "player";
    logs.push(
      `Round ${round} tie (${roundScore}) — initiative swaps to ${namesByLegacy[nextInitiative]}.`,
    );
  } else if (roundWinner === "player") {
    nextInitiative = "player";
    logs.push(
      `${namesByLegacy.player} wins the round ${roundScore} and takes initiative next round.`,
    );
  } else {
    nextInitiative = "enemy";
    logs.push(
      `${namesByLegacy.enemy} wins the round ${roundScore} and takes initiative next round.`,
    );
  }

  const matchEnded = pWins >= winGoal || eWins >= winGoal;
  if (matchEnded) {
    const localWins = localLegacySide === "player" ? pWins : eWins;
    logs.push(
      localWins >= winGoal
        ? "You win the match!"
        : `${namesByLegacy[remoteLegacySide]} wins the match!`,
    );
  }

  return {
    hudColors,
    wins: { player: pWins, enemy: eWins },
    nextInitiative,
    roundWinner,
    logs,
    shouldResetAnte,
    matchEnded,
  };
}

export type { WheelOutcome };
