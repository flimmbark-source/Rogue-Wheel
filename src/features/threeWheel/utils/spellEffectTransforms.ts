export type LegacySide = "player" | "enemy";

export type CardStatAdjustment = {
  owner: LegacySide;
  cardId: string;
  numberDelta?: number;
  leftValueDelta?: number;
  rightValueDelta?: number;
};

export type ChilledCardUpdate = {
  owner: LegacySide;
  cardId: string;
  stacks: number;
};

export type LaneChillStacks = {
  player: [number, number, number];
  enemy: [number, number, number];
};

type CardLike = {
  id: string;
  number?: number;
  leftValue?: number;
  rightValue?: number;
  [key: string]: unknown;
};

type AssignmentState<CardT extends CardLike> = {
  player: (CardT | null)[];
  enemy: (CardT | null)[];
};

export type SpellEffectPayload = {
  caster: LegacySide;
  mirrorCopyEffects?: Array<{ targetCardId: string; mode?: string }>;
  wheelTokenAdjustments?: Array<{ wheelIndex: number; amount: number }>;
  reserveDrains?: Array<{ side: LegacySide; amount: number }>;
  drawCards?: Array<{ side: LegacySide; count: number }>;
  cardAdjustments?: CardStatAdjustment[];
  handAdjustments?: Array<{ side: LegacySide; cardId: string; numberDelta?: number }>;
  handDiscards?: Array<{ side: LegacySide; cardId: string }>;
  positionSwaps?: Array<{ side: LegacySide; laneA: number; laneB: number }>;
  initiativeChallenges?: Array<{
    side: LegacySide;
    lane: number;
    cardId: string;
    mode: "higher" | "lower";
    winOnTie?: boolean;
  }>;
  chilledCards?: ChilledCardUpdate[];
  delayedEffects?: string[];
  initiative?: LegacySide | null;
  logMessages?: string[];
};

export type RuntimeSpellEffectSummary = Pick<
  SpellEffectPayload,
  "cardAdjustments" | "chilledCards" | "delayedEffects" | "drawCards" | "initiative"
>;

type TargetLike = {
  type?: string;
  cardId?: string;
  owner?: string;
};

type RuntimeStateLike = {
  cardAdjustments?: unknown;
  chilledCards?: Record<string, unknown> | null;
  delayedEffects?: unknown;
  timeMomentum?: unknown;
  drawCards?: unknown;
  [key: string]: unknown;
};

const opponentOf = (side: LegacySide): LegacySide => (side === "player" ? "enemy" : "player");

export function applyCardStatAdjustments<CardT extends CardLike>(
  assignState: AssignmentState<CardT>,
  adjustments: CardStatAdjustment[],
): AssignmentState<CardT> | null {
  if (!Array.isArray(adjustments) || adjustments.length === 0) return null;

  let nextPlayer = assignState.player;
  let nextEnemy = assignState.enemy;
  let changed = false;

  for (const adj of adjustments) {
    if (!adj || typeof adj.cardId !== "string") continue;
    const { owner } = adj;
    const lane = owner === "player" ? assignState.player : assignState.enemy;
    const laneIndex = lane.findIndex((card) => card?.id === adj.cardId);
    if (laneIndex === -1) continue;

    const targetCard = lane[laneIndex];
    if (!targetCard) continue;

    const nextLane =
      owner === "player"
        ? nextPlayer === assignState.player
          ? [...assignState.player]
          : nextPlayer
        : nextEnemy === assignState.enemy
        ? [...assignState.enemy]
        : nextEnemy;

    const card = { ...targetCard } as CardT;

    if (typeof adj.numberDelta === "number" && Number.isFinite(adj.numberDelta)) {
      const current = typeof card.number === "number" ? card.number : 0;
      const updated = Math.max(0, Math.round(current + adj.numberDelta));
      if (updated !== current) card.number = updated;
    }
    if (typeof adj.leftValueDelta === "number" && Number.isFinite(adj.leftValueDelta)) {
      const current = typeof card.leftValue === "number" ? card.leftValue : 0;
      const updated = Math.max(0, Math.round(current + adj.leftValueDelta));
      if (updated !== current) card.leftValue = updated;
    }
    if (typeof adj.rightValueDelta === "number" && Number.isFinite(adj.rightValueDelta)) {
      const current = typeof card.rightValue === "number" ? card.rightValue : 0;
      const updated = Math.max(0, Math.round(current + adj.rightValueDelta));
      if (updated !== current) card.rightValue = updated;
    }

    const laneArr = nextLane as (CardT | null)[];
    const previousCard = laneArr[laneIndex];
    const hasChange =
      (previousCard?.number ?? null) !== (card.number ?? null) ||
      (previousCard?.leftValue ?? null) !== (card.leftValue ?? null) ||
      (previousCard?.rightValue ?? null) !== (card.rightValue ?? null);

    if (!hasChange) {
      if (owner === "player") nextPlayer = nextLane;
      else nextEnemy = nextLane;
      continue;
    }

    laneArr[laneIndex] = card;
    if (owner === "player") nextPlayer = laneArr;
    else nextEnemy = laneArr;
    changed = true;
  }

  if (!changed) return null;
  return { player: nextPlayer, enemy: nextEnemy } as AssignmentState<CardT>;
}

export function applyChilledCardUpdates<CardT extends CardLike>(
  stacksState: LaneChillStacks,
  assignState: AssignmentState<CardT>,
  updates: ChilledCardUpdate[],
): LaneChillStacks | null {
  if (!Array.isArray(updates) || updates.length === 0) return null;

  let nextPlayer = stacksState.player;
  let nextEnemy = stacksState.enemy;
  let changed = false;

  for (const update of updates) {
    if (!update || typeof update.cardId !== "string") continue;
    if (typeof update.stacks !== "number" || !Number.isFinite(update.stacks) || update.stacks === 0) continue;

    const owner = update.owner;
    const lanes = owner === "player" ? assignState.player : assignState.enemy;
    const laneIndex = lanes.findIndex((card) => card?.id === update.cardId);
    if (laneIndex === -1) continue;

    if (owner === "player") {
      const base = nextPlayer === stacksState.player ? [...stacksState.player] : nextPlayer;
      const current = base[laneIndex] ?? 0;
      const updated = Math.max(0, current + update.stacks);
      if (updated !== current) {
        base[laneIndex] = updated;
        nextPlayer = base as [number, number, number];
        changed = true;
      }
    } else {
      const base = nextEnemy === stacksState.enemy ? [...stacksState.enemy] : nextEnemy;
      const current = base[laneIndex] ?? 0;
      const updated = Math.max(0, current + update.stacks);
      if (updated !== current) {
        base[laneIndex] = updated;
        nextEnemy = base as [number, number, number];
        changed = true;
      }
    }
  }

  if (!changed) return null;
  return { player: nextPlayer, enemy: nextEnemy };
}

export function collectRuntimeSpellEffects(
  runtimeState: RuntimeStateLike,
  caster: LegacySide,
): RuntimeSpellEffectSummary {
  const summary: RuntimeSpellEffectSummary = {};

  const adjustmentsRaw = runtimeState.cardAdjustments;
  if (Array.isArray(adjustmentsRaw)) {
    const adjustments: CardStatAdjustment[] = [];
    for (const entry of adjustmentsRaw) {
      if (!entry || typeof entry !== "object") continue;
      const target = (entry as { target?: unknown }).target;
      if (!target || typeof target !== "object") continue;
      if ((target as TargetLike).type !== "card") continue;
      const cardId = (target as TargetLike).cardId;
      if (typeof cardId !== "string") continue;
      const ownerRaw = (target as TargetLike).owner;
      const owner = ownerRaw === "ally" ? caster : ownerRaw === "enemy" ? opponentOf(caster) : caster;

      const numberDelta = (entry as { numberDelta?: unknown }).numberDelta;
      const leftValueDelta = (entry as { leftValueDelta?: unknown }).leftValueDelta;
      const rightValueDelta = (entry as { rightValueDelta?: unknown }).rightValueDelta;

      const adj: CardStatAdjustment = {
        owner,
        cardId,
      };

      if (typeof numberDelta === "number" && Number.isFinite(numberDelta)) {
        adj.numberDelta = numberDelta;
      }
      if (typeof leftValueDelta === "number" && Number.isFinite(leftValueDelta)) {
        adj.leftValueDelta = leftValueDelta;
      }
      if (typeof rightValueDelta === "number" && Number.isFinite(rightValueDelta)) {
        adj.rightValueDelta = rightValueDelta;
      }

      adjustments.push(adj);
    }

    if (adjustments.length > 0) {
      summary.cardAdjustments = adjustments;
    }
  }

  const chilled = runtimeState.chilledCards;
  if (chilled && typeof chilled === "object") {
    const owner = opponentOf(caster);
    const updates: ChilledCardUpdate[] = [];
    for (const [cardId, rawStacks] of Object.entries(chilled as Record<string, unknown>)) {
      if (typeof cardId !== "string") continue;
      const stacks = typeof rawStacks === "number" ? rawStacks : Number(rawStacks);
      if (!Number.isFinite(stacks) || stacks === 0) continue;
      updates.push({ owner, cardId, stacks });
    }
    if (updates.length > 0) {
      summary.chilledCards = updates;
    }
  }

  const delayedSource = runtimeState.delayedEffects;
  if (Array.isArray(delayedSource)) {
    const delayed = delayedSource
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim());
    if (delayed.length > 0) {
      summary.delayedEffects = delayed;
    }
  }

  const drawCardsRaw = runtimeState.drawCards;
  const drawCount =
    typeof drawCardsRaw === "number"
      ? drawCardsRaw
      : typeof drawCardsRaw === "string"
      ? Number.parseInt(drawCardsRaw, 10)
      : 0;
  if (Number.isFinite(drawCount) && drawCount > 0) {
    const normalized = Math.max(1, Math.floor(drawCount));
    summary.drawCards = [{ side: caster, count: normalized }];
  }

  const momentum = runtimeState.timeMomentum;
  if (typeof momentum === "number" && momentum > 0) {
    summary.initiative = caster;
  }

  return summary;
}
