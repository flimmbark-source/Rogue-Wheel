import ClassicMatch, { type ClassicMatchProps } from "./game/modes/classic/ClassicMatch";

export type AppProps =
  | ({ mode: "classic" } & ClassicMatchProps)
  | ({ mode: "gauntlet" } & ClassicMatchProps);

export default function App(props: AppProps) {
  const { mode, ...matchProps } = props;

  if (mode === "gauntlet") {
    return <GauntletComingSoon {...matchProps} />;
  }

  return <ClassicMatch {...matchProps} />;
}

function GauntletComingSoon({ onExit }: ClassicMatchProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 p-6 text-white">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-3xl font-semibold">Gauntlet Mode</h1>
        <p className="text-base text-white/80">
          The Gauntlet is under construction. Keep an eye out for upcoming builds with multi-battle runs and escalating
          challenges.
        </p>
        <button
          type="button"
          onClick={onExit}
          className="inline-flex items-center justify-center rounded-full border border-white/20 px-6 py-2 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/10"
        >
          ← Back to Menu
        </button>
      </div>
    </div>
  );
}
