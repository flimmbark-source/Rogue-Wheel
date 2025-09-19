import { useMemo } from "react";

import StSCard from "../StSCard";
import type { Card } from "../../game/types";
import type {
  LegacySide,
  Phase,
} from "../../game/match/useMatchController";
import type {
  ActivationAdjustmentsMap,
  ActivationSwapPairs,
} from "../../game/match/valueAdjustments";

export interface ActivationPhaseOverlayProps {
  phase: Phase;
  activationTurn: LegacySide | null;
  activationAvailable: Record<LegacySide, string[]>;
  activationInitial: Record<LegacySide, string[]>;
  activationPasses: { player: boolean; enemy: boolean };
  activationLog: { side: LegacySide; action: "activate" | "pass"; cardId?: string }[];
  activationAdjustments: ActivationAdjustmentsMap;
  activationSwapPairs: ActivationSwapPairs;
  pendingSwapCardId: string | null;
  assign: { player: (Card | null)[]; enemy: (Card | null)[] };
  localLegacySide: LegacySide;
  namesByLegacy: Record<LegacySide, string>;
  onActivateCard: (cardId: string) => void;
  onPass: () => void;
}

const panelClass =
  "max-w-4xl w-full space-y-4 rounded-xl border border-emerald-400/40 bg-slate-950/85 p-6 text-slate-100 shadow-2xl";

export default function ActivationPhaseOverlay({
  phase,
  activationTurn,
  activationAvailable,
  activationInitial,
  activationPasses,
  activationLog,
  activationAdjustments,
  activationSwapPairs,
  pendingSwapCardId,
  assign,
  localLegacySide,
  namesByLegacy,
  onActivateCard,
  onPass,
}: ActivationPhaseOverlayProps) {
  if (phase !== "activation") return null;

  const remoteLegacySide: LegacySide = localLegacySide === "player" ? "enemy" : "player";

  const availableLocal = useMemo(
    () => new Set(activationAvailable[localLegacySide] ?? []),
    [activationAvailable, localLegacySide],
  );
  const initialLocal = useMemo(
    () => new Set(activationInitial[localLegacySide] ?? []),
    [activationInitial, localLegacySide],
  );
  const availableRemote = useMemo(
    () => new Set(activationAvailable[remoteLegacySide] ?? []),
    [activationAvailable, remoteLegacySide],
  );
  const initialRemote = useMemo(
    () => new Set(activationInitial[remoteLegacySide] ?? []),
    [activationInitial, remoteLegacySide],
  );

  const allCardsById = useMemo(() => {
    const map = new Map<string, Card>();
    for (const card of assign.player) {
      if (card) map.set(card.id, card);
    }
    for (const card of assign.enemy) {
      if (card) map.set(card.id, card);
    }
    return map;
  }, [assign.enemy, assign.player]);

  const localCards = assign[localLegacySide].filter(
    (card): card is Card => !!card && initialLocal.has(card.id),
  );
  const remoteCards = assign[remoteLegacySide].filter(
    (card): card is Card => !!card && initialRemote.has(card.id),
  );

  const isLocalTurn = activationTurn === localLegacySide;
  const localHasActions = availableLocal.size > 0;
  const localHasPassed = activationPasses[localLegacySide];
  const remoteHasPassed = activationPasses[remoteLegacySide];

  const swapPairs = activationSwapPairs.map(([a, b]) => new Set([a, b]));

  const describeLogEntry = (entry: ActivationPhaseOverlayProps["activationLog"][number]) => {
    const actorName = namesByLegacy[entry.side];
    if (entry.action === "pass") {
      return `${actorName} passes.`;
    }
    const cardName = entry.cardId ? allCardsById.get(entry.cardId)?.name ?? "Card" : "Card";
    return `${actorName} activates ${cardName}.`;
  };

  const renderCard = (card: Card, isLocal: boolean) => {
    const availableSet = isLocal ? availableLocal : availableRemote;
    const initialSet = isLocal ? initialLocal : initialRemote;
    const activated = initialSet.has(card.id) && !availableSet.has(card.id);
    const canActivate = isLocal && isLocalTurn && availableSet.has(card.id);
    const adjustment = activationAdjustments[card.id]?.type ?? null;
    const isSwapTarget =
      pendingSwapCardId === card.id || swapPairs.some((pair) => pair.has(card.id));

    const statusLabel = (() => {
      if (pendingSwapCardId === card.id) return "Waiting";
      if (adjustment === "split") return "Halved";
      if (adjustment === "boost") return "Boosted";
      if (activated) return "Used";
      return canActivate ? "Ready" : null;
    })();

    return (
      <div key={card.id} className="relative flex flex-col items-center gap-2">
        <StSCard
          card={card}
          size="sm"
          variant="minimal"
          onPick={canActivate ? () => onActivateCard(card.id) : undefined}
          disabled={!canActivate}
        />
        {statusLabel ? (
          <span
            className={`text-[11px] uppercase tracking-wide ${
              statusLabel === "Ready"
                ? "text-emerald-300"
                : statusLabel === "Used"
                ? "text-slate-300"
                : "text-amber-300"
            }`}
          >
            {statusLabel}
          </span>
        ) : null}
        {isSwapTarget && statusLabel !== "Waiting" ? (
          <span className="text-[10px] uppercase tracking-wide text-sky-300">Swapped</span>
        ) : null}
      </div>
    );
  };

  const localStatus = isLocalTurn
    ? localHasActions
      ? "Select a card to activate."
      : "No cards left — pass when ready."
    : `Waiting for ${namesByLegacy[activationTurn ?? remoteLegacySide]}.`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-4">
      <div className={panelClass}>
        <header className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-emerald-200/80">Activation Phase</div>
          <h2 className="text-2xl font-semibold text-emerald-100">
            {isLocalTurn ? "Your turn" : `${namesByLegacy[activationTurn ?? remoteLegacySide]} to act`}
          </h2>
          <p className="text-sm text-emerald-100/80">{localStatus}</p>
          {pendingSwapCardId ? (
            <p className="text-[12px] text-sky-200/80">
              Swap primed: the next activation will exchange values with your swap card.
            </p>
          ) : null}
        </header>

        <section className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-emerald-200/80 uppercase tracking-wide">
              {namesByLegacy[localLegacySide]}&rsquo;s cards
            </h3>
            {localCards.length === 0 ? (
              <p className="mt-2 text-sm text-slate-200/70">No cards available to activate.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-4">
                {localCards.map((card) => renderCard(card, true))}
              </div>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-emerald-200/60 uppercase tracking-wide">
              {namesByLegacy[remoteLegacySide]}&rsquo;s cards
            </h3>
            {remoteCards.length === 0 ? (
              <p className="mt-2 text-sm text-slate-200/60">No cards awaiting activation.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-4">
                {remoteCards.map((card) => renderCard(card, false))}
              </div>
            )}
          </div>
        </section>

        <footer className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-emerald-100/80">
              {localHasPassed ? "You have passed." : localHasActions ? "" : "No actions available."}
            </span>
            <button
              type="button"
              onClick={onPass}
              disabled={!isLocalTurn || localHasPassed}
              className="rounded bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-slate-900 disabled:opacity-50"
            >
              {localHasPassed ? "Passed" : "Pass"}
            </button>
          </div>

          <div className="rounded-lg border border-emerald-400/30 bg-emerald-950/50 p-3 text-sm">
            <div className="text-[11px] uppercase tracking-wide text-emerald-200/70">Activity</div>
            {activationLog.length === 0 ? (
              <p className="mt-1 text-xs text-emerald-100/70">No actions yet this phase.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-xs text-emerald-100/85">
                {activationLog.map((entry, idx) => (
                  <li key={`${entry.side}-${entry.action}-${entry.cardId ?? "none"}-${idx}`}>
                    • {describeLogEntry(entry)}
                  </li>
                ))}
              </ul>
            )}
            {remoteHasPassed && !localHasPassed ? (
              <p className="mt-2 text-[11px] text-emerald-100/70">
                {namesByLegacy[remoteLegacySide]} has passed.
              </p>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
