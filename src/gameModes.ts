export const GAME_MODE_OPTIONS = ["grimoire", "ante"] as const;

export type GameModeOption = (typeof GAME_MODE_OPTIONS)[number];

export type GameMode = GameModeOption[];

export const DEFAULT_GAME_MODE: GameMode = [];

export const GAME_MODE_LABELS: Record<GameModeOption, string> = {
  grimoire: "Grimoire",
  ante: "Ante",
};

export const GAME_MODE_DETAILS: Record<
  GameModeOption,
  {
    title: string;
    subtitle: string;
    highlights: string[];
  }
> = {
  grimoire: {
    title: "Grimoire",
    subtitle: "Experimental systems and power-ups.",
    highlights: [
      "Adds spells, which can alter match outcomes",
      "Best for advanced players seeking depth",
    ],
  },
  ante: {
    title: "Ante",
    subtitle: "Risk wins each round for boosted payouts.",
    highlights: [
      "Wager existing wins at the start of every round",
      "Win the round to multiply your ante by dynamic odds",
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
