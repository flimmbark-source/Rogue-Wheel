import React, { useEffect, useMemo, useState } from "react";
import { wrapIndex } from "../ui/RogueWheelHub";

type SoloModeRouteProps = {
  onBack: () => void;
  onSelectClassic: () => void;
  onSelectGauntlet: () => void;
};

type ModeOption = {
  key: "classic" | "gauntlet";
  title: string;
  subtitle: string;
  description: string;
  onSelect: () => void;
};

export default function SoloModeRoute({
  onBack,
  onSelectClassic,
  onSelectGauntlet,
}: SoloModeRouteProps) {
  const options = useMemo<ModeOption[]>(
    () => [
      {
        key: "classic",
        title: "Classic",
        subtitle: "Spin, draft, and defeat Nemesis in a single showdown.",
        description:
          "Play the traditional Rogue Wheel experience. Face Nemesis in a best-of series with your drafted squad and experiment with every spin of the wheel.",
        onSelect: onSelectClassic,
      },
      {
        key: "gauntlet",
        title: "Gauntlet",
        subtitle: "Climb through escalating battles with limited recovery.",
        description:
          "Tackle a run of consecutive encounters where every decision matters. Manage your roster between fights and see how far you can push your luck.",
        onSelect: onSelectGauntlet,
      },
    ],
    [onSelectClassic, onSelectGauntlet]
  );

  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        setSelected((index) => wrapIndex(index + 1, options.length));
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        setSelected((index) => wrapIndex(index - 1, options.length));
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        options[selected]?.onSelect();
      } else if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        onBack();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack, options, selected]);

  useEffect(() => {
    setSelected((index) => wrapIndex(index, options.length));
  }, [options.length]);

  const active = options[selected] ?? options[0];

  return (
    <div className="min-h-dvh bg-slate-950 text-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-10 pt-8 sm:px-6 lg:px-10">
        <header className="flex items-center justify-between gap-4 border-b border-white/10 pb-6">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/30 hover:text-white"
          >
            ← Back
          </button>
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.35em] text-white/50">Solo Adventure</p>
            <h1 className="text-2xl font-semibold text-white">Choose Your Mode</h1>
          </div>
          <span aria-hidden className="hidden w-20 sm:block" />
        </header>

        <div className="mt-8 flex flex-1 flex-col gap-6 lg:flex-row">
          <nav aria-label="Solo modes" className="lg:w-80">
            <ul className="grid gap-4">
              {options.map((option, index) => {
                const isActive = index === selected;
                return (
                  <li key={option.key}>
                    <button
                      type="button"
                      onMouseEnter={() => setSelected(index)}
                      onFocus={() => setSelected(index)}
                      onClick={option.onSelect}
                      className={[
                        "w-full rounded-2xl border px-5 py-4 text-left transition",
                        "bg-white/5 border-white/10 hover:border-white/30 hover:bg-white/10",
                        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400/40",
                        isActive ? "ring-2 ring-emerald-400" : "ring-0",
                      ].join(" ")}
                      aria-current={isActive ? "true" : undefined}
                    >
                      <div className="text-sm font-semibold text-white">{option.title}</div>
                      <p className="mt-2 text-sm text-white/70">{option.subtitle}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <section className="grow rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-white/0 p-6">
            <div className="flex h-full flex-col justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">{active.title}</h2>
                <p className="mt-3 text-base text-white/80">{active.description}</p>
              </div>
              <div className="mt-6 text-sm text-white/60">
                <p>Press Enter to launch. Press Esc to go back.</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
