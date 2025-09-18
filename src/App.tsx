import ClassicMatch, { type ClassicMatchProps } from "./game/modes/classic/ClassicMatch";
import GauntletMatch, { type GauntletMatchProps } from "./game/modes/gauntlet/GauntletMatch";

export type AppProps =
  | ({ mode: "classic" } & ClassicMatchProps)
  | ({ mode: "gauntlet" } & GauntletMatchProps);

export default function App(props: AppProps) {
  const { mode, ...matchProps } = props;

  if (mode === "gauntlet") {
    return <GauntletMatch {...matchProps} />;
  }

  return <ClassicMatch {...matchProps} />;

}
