export const GAME_MODE_OPTIONS = ["grimoire", "ante", "skill"] as const;

export type GameModeOption = (typeof GAME_MODE_OPTIONS)[number];

export type GameMode = GameModeOption[];

export const DEFAULT_GAME_MODE: GameMode = [];

export const GAME_MODE_LABELS: Record<GameModeOption, string> = {
  skill: "Skill Mode",
  grimoire: "Grimoire",
  ante: "Ante",
};

export const GAME_MODE_DETAILS: Record<
  GameModeOption,
  {
    title: string;
    subtitle: string;
    highlights: string[];
    difficulty: {
      label: string;
      badgeClassName: string;
    };
  }
> = {
  skill: {
    title: "Skills",
    subtitle: "Use abilities on cards for tactical plays.",
    highlights: [
      "Cards on board grant one-shot abilities like Swap, Reroll, and Boost.",
    ],
    difficulty: {
      label: "Intermediate",
      badgeClassName: "border-amber-400/60 bg-amber-500/10 text-amber-300",
    },
  },
  grimoire: {
    title: "Grimoire",
    subtitle: "Adds spells, which can alter match outcomes.",
    highlights: [
      "Card totals in Reserve grant Mana, spend Mana to cast spells and use arcana symbols to boost them.",
    ],
    difficulty: {
      label: "Expert",
      badgeClassName: "border-rose-400/60 bg-rose-500/10 text-rose-300",
    },
  },
  ante: {
    title: "Ante",
    subtitle: "Wager existing wins at the start of every round.",
    highlights: [
      "Win rounds to multiply your ante by dynamic odds",
    ],
    difficulty: {
      label: "Easy",
      badgeClassName: "border-emerald-400/60 bg-emerald-500/10 text-emerald-300",
    },
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
