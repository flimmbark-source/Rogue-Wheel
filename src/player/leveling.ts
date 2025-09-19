const EXP_BASE = 100;

export function expRequiredForLevel(level: number): number {
  return (level + 1) * EXP_BASE;
}

export { EXP_BASE };
