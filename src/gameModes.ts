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
      "No mana, spells, or archetype management",
      "Great for quick matches and onboarding",
    ],
  },
  grimoire: {
    title: "Grimoire",
    subtitle: "Experimental systems and power-ups.",
    highlights: [
      "Adds mana economy and spellcasting windows",
      "Wheel archetypes and progression modifiers",
      "Best for advanced players seeking depth",
    ],
  },
};
