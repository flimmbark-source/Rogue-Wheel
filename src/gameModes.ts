export const GAME_MODE_OPTIONS = ["grimoire", "ante", "skill"] as const;

export type GameModeOption = (typeof GAME_MODE_OPTIONS)[number];

export type GameMode = GameModeOption[];

export const DEFAULT_GAME_MODE: GameMode = [];

export const GAME_MODE_LABELS: Record<GameModeOption, string> = {
  skill: "Skill Mode",
  grimoire: "Grimoire",
  ante: "Ante",
  skill: "Skill",
};

export const GAME_MODE_DETAILS: Record<
  GameModeOption,
  {
    title: string;
    subtitle: string;
    highlights: string[];
  }
> = {
  skill: {
    title: "Skill Mode",
    subtitle: "Unlock lane abilities between rounds for tactical plays.",
    highlights: [
      "Board cards grant one-shot abilities during the Skill Phase.",
      "Swap, reroll, and boost using reserve tactics before combat.",
    ],
  },
  grimoire: {
    title: "Grimoire",
    subtitle: "Adds spells, which can alter match outcomes.",
    highlights: [
      "Use Reserve to gain Mana, spend Mana to cast spells.",
    ],
  },
  ante: {
    title: "Ante",
    subtitle: "Wager existing wins at the start of every round.",
    highlights: [
      "Win rounds to multiply your ante by dynamic odds",
    ],
  },
  skill: {
    title: "Skill",
    subtitle: "Trigger lane abilities before each round begins.",
    highlights: [
      "Enter a Skill Phase to activate abilities on your lanes.",
      "Spend reserve cards to swap, reroll, or boost strategically.",
    ],
  },
};

export function normalizeGameMode(modes: readonly GameModeOption[]): GameMode {
  const set = new Set<GameModeOption>();
  for (const option of GAME_MODE_OPTIONS) {
    if (modes.includes(option)) {
      set.add(option);
    }
  }
  return Array.from(set);
}

export function toggleGameMode(current: readonly GameModeOption[], option: GameModeOption): GameMode {
  if (current.includes(option)) {
    return current.filter((mode) => mode !== option);
  }
  return normalizeGameMode([...current, option]);
}

export function gameModeDisplayName(modes: readonly GameModeOption[]): string {
  if (modes.length === 0) return "Classic";
  return normalizeGameMode(modes).map((mode) => GAME_MODE_LABELS[mode]).join(" + ");
}

export function coerceGameMode(value: unknown): GameMode | null {
  if (Array.isArray(value)) {
    const filtered = value.filter((item): item is GameModeOption =>
      GAME_MODE_OPTIONS.includes(item as GameModeOption),
    );
    return normalizeGameMode(filtered);
  }
  if (typeof value === "string") {
    if (value === "classic" || value.trim() === "") {
      return DEFAULT_GAME_MODE;
    }
    if (GAME_MODE_OPTIONS.includes(value as GameModeOption)) {
      return [value as GameModeOption];
    }
  }
  return null;
}

export function isGameMode(value: unknown): value is GameMode {
  return coerceGameMode(value) !== null;
}
