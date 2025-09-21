import GauntletMatch, { type GauntletMatchProps } from "../gauntlet/GauntletMatch";

export default function ArenaMatch(props: GauntletMatchProps) {
  return <GauntletMatch {...props} mode="arena" />;
}
