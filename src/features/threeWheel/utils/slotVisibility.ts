export type LegacySide = "player" | "enemy";

interface ShouldShowSlotCardArgs {
  hasCard: boolean;
  slotSide: LegacySide;
  localLegacySide: LegacySide;
  isPhaseChooseLike: boolean;
  slotTargetable: boolean;
}

export const shouldShowSlotCard = ({
  hasCard,
  slotSide,
  localLegacySide,
  isPhaseChooseLike,
  slotTargetable,
}: ShouldShowSlotCardArgs): boolean => {
  if (!hasCard) return false;
  if (slotSide === localLegacySide) return true;
  if (!isPhaseChooseLike) return true;
  return slotTargetable;
};

export const isChooseLikePhase = (phase: string) =>
  phase === "choose" || phase === "spellTargeting";
