import ClassicMatch, { type ClassicMatchProps } from "./game/modes/classic/ClassicMatch";

export type AppProps = { mode: "classic" | "gauntlet" } & ClassicMatchProps;

export default function App(props: AppProps) {
  return <ClassicMatch {...props} />;
}
