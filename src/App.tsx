import { Suspense, lazy } from "react";
import type { ClassicMatchProps } from "./game/modes/classic/ClassicMatch";
import type { GauntletMatchProps } from "./game/modes/gauntlet/GauntletMatch";

const ClassicMatch = lazy(() => import("./game/modes/classic/ClassicMatch"));
const GauntletMatch = lazy(() => import("./game/modes/gauntlet/GauntletMatch"));

export type AppProps =
  | ({ mode: "classic" } & ClassicMatchProps)
  | ({ mode: "gauntlet" } & GauntletMatchProps);

const MATCH_FALLBACK = <div>Loading match…</div>;

export default function App(props: AppProps) {
  if (props.mode === "gauntlet") {
    const { mode: _mode, ...matchProps } = props;
    return (
      <Suspense fallback={MATCH_FALLBACK}>
        <GauntletMatch {...matchProps} />
      </Suspense>
    );
  }

  const { mode: _mode, ...matchProps } = props;
  return (
    <Suspense fallback={MATCH_FALLBACK}>
      <ClassicMatch {...matchProps} />
    </Suspense>
  );
}
