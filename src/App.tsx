import { Suspense, lazy } from "react";
import LoadingScreen from "./components/LoadingScreen";
import type { ClassicMatchProps } from "./game/modes/classic/ClassicMatch";
import type { GauntletMatchProps } from "./game/modes/gauntlet/GauntletMatch";

const ClassicMatch = lazy(() => import("./game/modes/classic/ClassicMatch"));
const GauntletMatch = lazy(() => import("./game/modes/gauntlet/GauntletMatch"));
const ArenaMatch = lazy(() => import("./game/modes/arena/ArenaMatch"));

export type AppProps =
  | ({ mode: "classic" | "tactics" } & ClassicMatchProps)
  | ({ mode: "gauntlet" | "arena" } & GauntletMatchProps);

const MATCH_FALLBACK = <LoadingScreen />;

export default function App(props: AppProps) {
  if (props.mode === "gauntlet") {
    const { mode: _mode, ...matchProps } = props;
    return (
      <Suspense fallback={MATCH_FALLBACK}>
        <GauntletMatch {...matchProps} />
      </Suspense>
    );
  }

  if (props.mode === "arena") {
    const { mode: _mode, ...matchProps } = props;
    return (
      <Suspense fallback={MATCH_FALLBACK}>
        <ArenaMatch {...matchProps} />
      </Suspense>
    );
  }

  const { mode: _mode, ...matchProps } = props;
  return (
    <Suspense fallback={MATCH_FALLBACK}>
      <ClassicMatch {...matchProps} mode={props.mode} />
    </Suspense>
  );
}
