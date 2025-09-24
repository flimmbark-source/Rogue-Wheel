export type GameMode = "classic" | "grimoire";

export const DEFAULT_GAME_MODE: GameMode = "classic";

export const GAME_MODE_DETAILS: Record<
  GameMode,
  {
    title: string;
    subtitle: string;
    highlights: string[];
  }
> = {
  classic: {
    title: "Classic",
    subtitle: "Pure spins and tactical cardplay.",
    highlights: [
      "Original ruleset with straightforward drafting",
      "Great for quick matches and onboarding",
    ],
  },
  grimoire: {
    title: "Grimoire",
    subtitle: "Experimental systems and power-ups.",
    highlights: [
      "Adds spells, which can alter match outcomes",
      "Best for advanced players seeking depth",
    ],
  },
};
