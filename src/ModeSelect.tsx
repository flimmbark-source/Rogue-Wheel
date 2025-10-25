import React, { useEffect, useMemo, useState } from "react";

import { TARGET_WINS } from "./game/types";
import {
  CPU_DIFFICULTY_OPTIONS,
  DEFAULT_CPU_DIFFICULTY,
  type CpuDifficulty,
} from "./game/ai/cpuDifficulty";
import {
  DEFAULT_GAME_MODE,
  GAME_MODE_DETAILS,
  normalizeGameMode,
  toggleGameMode,
  type GameMode,
  type GameModeOption,
} from "./gameModes";
import EasyModeSwitch from "./components/EasyModeSwitch";

type ModeSelectProps = {
  initialMode?: GameMode;
  initialTargetWins?: number;
  initialEasyMode?: boolean;
  initialCpuDifficulty?: CpuDifficulty;
  showTargetWinsInput?: boolean;
  showCpuDifficulty?: boolean;
  onConfirm: (
    mode: GameMode,
    targetWins: number,
    easyMode: boolean,
    cpuDifficulty: CpuDifficulty,
  ) => void;
  onBack: () => void;
  backLabel?: string;
  confirmLabel?: string;
};

export default function ModeSelect({
  initialMode = DEFAULT_GAME_MODE,
  initialTargetWins = TARGET_WINS,
  initialEasyMode = false,
  initialCpuDifficulty = DEFAULT_CPU_DIFFICULTY,
  showTargetWinsInput = false,
  showCpuDifficulty = false,
  onConfirm,
  onBack,
  backLabel = "← Back",
  confirmLabel = "Confirm Mode",
}: ModeSelectProps) {
  const [selectedModes, setSelectedModes] = useState<GameMode>(() => normalizeGameMode(initialMode));
  const [targetWins, setTargetWins] = useState<number>(() => clampTargetWins(initialTargetWins));
  const [targetWinsInput, setTargetWinsInput] = useState<string>(String(clampTargetWins(initialTargetWins)));
  const [easyMode, setEasyMode] = useState<boolean>(Boolean(initialEasyMode));
  const [cpuDifficulty, setCpuDifficulty] = useState<CpuDifficulty>(initialCpuDifficulty);

  const detailEntries = useMemo(
    () =>
      Object.entries(GAME_MODE_DETAILS) as [
        GameModeOption,
        (typeof GAME_MODE_DETAILS)[GameModeOption],
      ][],
    [],
  );

  useEffect(() => {
    const next = clampTargetWins(initialTargetWins);
    setTargetWins(next);
    setTargetWinsInput(String(next));
  }, [initialTargetWins]);

  useEffect(() => {
    setSelectedModes(normalizeGameMode(initialMode));
  }, [initialMode]);

  useEffect(() => {
    setEasyMode(Boolean(initialEasyMode));
  }, [initialEasyMode]);

  useEffect(() => {
    setCpuDifficulty(initialCpuDifficulty);
  }, [initialCpuDifficulty]);

  const handleWinsChange = (value: string) => {
    if (!/^\d*$/.test(value)) return;
    setTargetWinsInput(value);
    if (value === "") return;

    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      setTargetWins(clampTargetWins(parsed));
    }
  };

  const handleWinsBlur = () => {
    if (targetWinsInput === "") {
      setTargetWins(TARGET_WINS);
      setTargetWinsInput(String(TARGET_WINS));
      return;
    }

    const parsed = Number.parseInt(targetWinsInput, 10);
    if (Number.isFinite(parsed)) {
      const next = clampTargetWins(parsed);
      setTargetWins(next);
      setTargetWinsInput(String(next));
    }
  };

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-4 py-6 sm:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-semibold text-emerald-300 hover:text-emerald-200"
          >
            {backLabel}
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-3 text-left">
          <h1 className="text-3xl font-bold sm:text-4xl">Choose Game Modes</h1>
          <p className="text-sm text-slate-300 sm:text-base">
            Classic rules are always on. Toggle any additional modes you want to include.
          </p>
        </div>

        {showTargetWinsInput && (
          <div className="mt-4 flex flex-col gap-2">
            <label className="sr-only" htmlFor="target-wins-input">
              Wins to take the match
            </label>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <input
                id="target-wins-input"
                type="number"
                inputMode="numeric"
                min={1}
                max={25}
                className="w-24 rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-center text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                value={targetWinsInput}
                onChange={(event) => handleWinsChange(event.target.value)}
                onBlur={handleWinsBlur}
              />
              <span className="text-xs text-slate-400 sm:text-sm">First to {targetWins} wins.</span>
              <EasyModeSwitch
                checked={easyMode}
                onToggle={setEasyMode}
                className="shrink-0"
              />
            </div>
          </div>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {detailEntries.map(([mode, info]) => {
            const isSelected = selectedModes.includes(mode);
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setSelectedModes((prev) => toggleGameMode(prev, mode))}
                className={[
                  "rounded-2xl border p-5 text-left transition focus:outline-none",
                  "bg-slate-900/60 hover:bg-slate-900/80",
                  isSelected ? "border-emerald-400 shadow-[0_0_0_2px_rgba(16,185,129,0.35)]" : "border-slate-700",
                ].join(" ")}
                aria-pressed={isSelected}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="text-lg font-semibold sm:text-xl">{info.title}</div>
                      <span
                        className={[
                          "rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                          info.difficulty.badgeClassName,
                        ].join(" ")}
                      >
                        {info.difficulty.label}
                      </span>
                    </div>
                    <div className="text-sm text-slate-300 sm:text-base">{info.subtitle}</div>
                  </div>
                  {isSelected && (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-200">
                      Enabled
                    </span>
                  )}
                </div>
                <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-300">
                </ul>
              </button>
            );
          })}
        </div>

        <div
          className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end"
        >
          {showCpuDifficulty && (
            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-2">
              <span className="font-semibold text-slate-300">CPU Difficulty</span>
              <select
                className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                value={cpuDifficulty}
                onChange={(event) => setCpuDifficulty(event.target.value as CpuDifficulty)}
              >
                {CPU_DIFFICULTY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() =>
              onConfirm(
                normalizeGameMode(selectedModes),
                targetWins,
                easyMode,
                cpuDifficulty,
              )
            }
            className="inline-flex items-center justify-center rounded-full bg-emerald-400 px-6 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function clampTargetWins(value: number) {
  if (!Number.isFinite(value)) return TARGET_WINS;
  const rounded = Math.round(value);
  return Math.max(1, Math.min(25, rounded));
}
