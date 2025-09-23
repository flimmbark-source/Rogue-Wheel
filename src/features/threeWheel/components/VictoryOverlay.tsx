import React from "react";
import type { MatchResultSummary, LevelProgress } from "../../../player/profileStore";

interface VictoryOverlayProps {
  victoryCollapsed: boolean;
  onCollapseChange: (collapsed: boolean) => void;
  localWon: boolean;
  matchSummary: MatchResultSummary | null;
  winGoal: number;
  winnerName: string | null;
  remoteName: string;
  localName: string;
  localWinsCount: number;
  remoteWinsCount: number;
  xpDisplay: LevelProgress | null;
  xpProgressPercent: number;
  levelUpFlash: boolean;
  onRematch: () => void;
  rematchButtonLabel: string;
  isMultiplayer: boolean;
  localRematchReady: boolean;
  rematchStatusText: string | null;
  onExitClick: () => void;
  onExit?: () => void;
}

const VictoryOverlay: React.FC<VictoryOverlayProps> = ({
  victoryCollapsed,
  onCollapseChange,
  localWon,
  matchSummary,
  winGoal,
  winnerName,
  remoteName,
  localName,
  localWinsCount,
  remoteWinsCount,
  xpDisplay,
  xpProgressPercent,
  levelUpFlash,
  onRematch,
  rematchButtonLabel,
  isMultiplayer,
  localRematchReady,
  rematchStatusText,
  onExitClick,
  onExit,
}) => {
  return (
    <>
      {victoryCollapsed ? (
        <button
          onClick={() => onCollapseChange(false)}
          className={`fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border px-4 py-2 text-sm font-semibold shadow-lg transition hover:-translate-y-[1px] focus:outline-none focus:ring-2 focus:ring-emerald-400/60 ${
            localWon
              ? "border-emerald-500/40 bg-emerald-900/70 text-emerald-100"
              : "border-slate-700 bg-slate-900/80 text-slate-100"
          }`}
        >
          <span className="rounded-full bg-slate-950/40 px-2 py-0.5 text-xs uppercase tracking-wide">
            {localWon ? "Victory" : "Defeat"}
          </span>
          <span className="text-xs opacity-80">Tap to reopen results</span>
          {localWon && matchSummary?.expGained ? (
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-100">
              +{matchSummary.expGained} XP
            </span>
          ) : null}
        </button>
      ) : null}

      {!victoryCollapsed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm px-3">
          <div className="relative w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900/95 p-6 text-center shadow-2xl space-y-4">
            <button
              onClick={() => onCollapseChange(true)}
              className="group absolute top-2 right-2 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-800/80 text-slate-200 transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
              aria-label="Minimize results"
              title="Minimize"
            >
              <div className="flex flex-col items-end text-right leading-none">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/80 transition group-hover:text-emerald-100">
                  Hide
                </span>
                <svg
                  aria-hidden
                  focusable="false"
                  className="mt-1 h-5 w-5 text-emerald-200 transition group-hover:text-emerald-100"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M4 10a1 1 0 0 1 1-1h6.586L9.293 6.707a1 1 0 1 1 1.414-1.414l4.5 4.5a1 1 0 0 1 0 1.414l-4.5 4.5a1 1 0 0 1-1.414-1.414L11.586 11H5a1 1 0 0 1-1-1Z" />
                </svg>
              </div>
              <span className="text-lg font-semibold leading-none text-slate-200 transition group-hover:text-white">–</span>
            </button>

            <div className={`text-3xl font-bold ${localWon ? "text-emerald-300" : "text-rose-300"}`}>
              {localWon ? "Victory" : "Defeat"}
            </div>

            <div className="text-sm text-slate-200">
              {localWon
                ? `You reached ${winGoal} wins.`
                : `${winnerName ?? remoteName} reached ${winGoal} wins.`}
            </div>

            <div className="rounded-md border border-slate-700 bg-slate-800/80 px-4 py-3 text-sm text-slate-100">
              <div className="font-semibold tracking-wide uppercase text-xs text-slate-400">Final Score</div>
              <div className="mt-2 flex items-center justify-center gap-3 text-base font-semibold">
                <span className="text-emerald-300">{localName}</span>
                <span className="px-2 py-0.5 rounded bg-slate-900/60 text-slate-200 tabular-nums">{localWinsCount}</span>
                <span className="text-slate-500">—</span>
                <span className="px-2 py-0.5 rounded bg-slate-900/60 text-slate-200 tabular-nums">{remoteWinsCount}</span>
                <span className="text-rose-300">{remoteName}</span>
              </div>
            </div>

            {localWon && matchSummary?.didWin && xpDisplay && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-900/15 px-4 py-3 text-sm text-emerald-50">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-emerald-200/80">
                  <span>Level {xpDisplay.level}</span>
                  <span>
                    {xpDisplay.exp} / {xpDisplay.expToNext} XP
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-emerald-950/50">
                  <div
                    className="h-2 rounded-full bg-emerald-400 transition-[width] duration-500"
                    style={{ width: `${xpProgressPercent}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-emerald-100/90">
                  <span>+{matchSummary.expGained} XP</span>
                  <span>Win streak: {matchSummary.streak}</span>
                </div>
                {levelUpFlash && (
                  <div className="mt-2 text-base font-semibold uppercase tracking-wide text-amber-200">
                    Level up!
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                disabled={isMultiplayer && localRematchReady}
                onClick={onRematch}
                className="w-full rounded bg-emerald-500 px-4 py-2 font-semibold text-slate-900 disabled:opacity-50"
              >
                {rematchButtonLabel}
              </button>
              {isMultiplayer && rematchStatusText && (
                <span className="text-[11px] italic text-amber-200 leading-tight">
                  {rematchStatusText}
                </span>
              )}
              {onExit && (
                <button
                  onClick={onExitClick}
                  className="w-full rounded border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Exit to Main Menu
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default VictoryOverlay;
