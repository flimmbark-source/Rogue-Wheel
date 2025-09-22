import React, { useMemo, useState } from "react";
import { DEFAULT_GAME_MODE, GAME_MODE_DETAILS, type GameMode } from "./gameModes";

type ModeSelectProps = {
  initialMode?: GameMode;
  onConfirm: (mode: GameMode) => void;
  onBack: () => void;
  backLabel?: string;
  confirmLabel?: string;
};

export default function ModeSelect({
  initialMode = DEFAULT_GAME_MODE,
  onConfirm,
  onBack,
  backLabel = "← Back",
  confirmLabel = "Confirm Mode",
}: ModeSelectProps) {
  const [selectedMode, setSelectedMode] = useState<GameMode>(initialMode);

  const detailEntries = useMemo(() => Object.entries(GAME_MODE_DETAILS) as [GameMode, typeof GAME_MODE_DETAILS[GameMode]][], []);

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-4 py-6 sm:px-8">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-semibold text-emerald-300 hover:text-emerald-200"
          >
            {backLabel}
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-3 text-left">
          <h1 className="text-3xl font-bold sm:text-4xl">Choose a Mode</h1>
          <p className="max-w-2xl text-sm text-slate-300 sm:text-base">
            Classic keeps today&apos;s streamlined experience. Grimoire layers in experimental systems for seasoned players.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {detailEntries.map(([mode, info]) => {
            const isSelected = selectedMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setSelectedMode(mode)}
                className={[
                  "rounded-2xl border p-5 text-left transition focus:outline-none",
                  "bg-slate-900/60 hover:bg-slate-900/80",
                  isSelected ? "border-emerald-400 shadow-[0_0_0_2px_rgba(16,185,129,0.35)]" : "border-slate-700",
                ].join(" ")}
                aria-pressed={isSelected}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold sm:text-xl">{info.title}</div>
                    <div className="text-sm text-slate-300 sm:text-base">{info.subtitle}</div>
                  </div>
                  {isSelected && (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-200">
                      Selected
                    </span>
                  )}
                </div>
                <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-300">
                  {info.highlights.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-400 sm:text-sm">
            You can swap modes later from the main menu.
          </div>
          <button
            type="button"
            onClick={() => onConfirm(selectedMode)}
            className="inline-flex items-center justify-center rounded-full bg-emerald-400 px-6 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
