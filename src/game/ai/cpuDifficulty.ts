export type CpuDifficulty = "easy" | "medium" | "hard";

export const DEFAULT_CPU_DIFFICULTY: CpuDifficulty = "medium";

export const CPU_DIFFICULTY_TRIALS: Record<CpuDifficulty, number> = {
  easy: 80,
  medium: 200,
  hard: 400,
};

export const CPU_DIFFICULTY_OPTIONS: { value: CpuDifficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];
