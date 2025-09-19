import { useEffect } from "react";

import type { Card } from "../../types";
import type {
  GauntletState,
  LegacySide,
  Phase,
} from "../../match/useMatchController";
import StSCard from "../../../components/StSCard";

export type GauntletPhasePanelProps = {
  phase: Phase;
  round: number;
  localLegacySide: LegacySide;
  remoteLegacySide: LegacySide;
  namesByLegacy: Record<LegacySide, string>;
  gold: Record<LegacySide, number>;
  shopInventory: Record<LegacySide, Card[]>;
  shopPurchases: Record<LegacySide, Card[]>;
  shopReady: { player: boolean; enemy: boolean };
  gauntletState: GauntletState;
  gauntletRollShop: (inventory: Card[], round: number, roll?: number) => void;
  configureShopInventory: (
    inventory: Partial<Record<LegacySide, Card[]>>,
  ) => void;
  purchaseFromShop: (side: LegacySide, card: Card, cost?: number) => boolean;
  markShopComplete: (side: LegacySide) => boolean;
};

export default function GauntletPhasePanel({
  phase,
  round,
  localLegacySide,
  remoteLegacySide,
  namesByLegacy,
  gold,
  shopInventory,
  shopPurchases,
  shopReady,
  gauntletState,
  gauntletRollShop,
  configureShopInventory,
  purchaseFromShop,
  markShopComplete,
}: GauntletPhasePanelProps) {
  if (phase !== "shop") {
    return null;
  }

  const localName = namesByLegacy[localLegacySide];
  const remoteName = namesByLegacy[remoteLegacySide];
  const localGold = gold[localLegacySide] ?? 0;
  const remoteReady = shopReady[remoteLegacySide];
  const localReady = shopReady[localLegacySide];
  const localInventory = shopInventory[localLegacySide] ?? [];
  const localPurchases = shopPurchases[localLegacySide] ?? [];
  const localGauntlet = gauntletState[localLegacySide];
  const currentRoll = localGauntlet?.shop.roll ?? 0;
  const previousInventory = localGauntlet?.shop.inventory ?? [];

  const readyMessage = (() => {
    if (localReady && remoteReady) {
      return "Both sides are ready to continue.";
    }
    if (localReady && !remoteReady) {
      return `Waiting for ${remoteName}...`;
    }
    if (!localReady && remoteReady) {
      return `${remoteName} is ready to fight.`;
    }
    return "Spend your gold and continue when you're ready.";
  })();

  const inventoryForRoll =
    localInventory.length > 0 ? localInventory : previousInventory;
  const canRollInventory = inventoryForRoll.length > 0;

  useEffect(() => {
    if (phase !== "shop") return;
    if (localInventory.length > 0) return;
    if (previousInventory.length === 0) return;
    configureShopInventory({ [localLegacySide]: previousInventory });
  }, [
    configureShopInventory,
    localInventory.length,
    localLegacySide,
    phase,
    previousInventory,
  ]);

  useEffect(() => {
    if (phase !== "shop") return;
    if (currentRoll > 0) return;
    if (!canRollInventory) return;
    gauntletRollShop(inventoryForRoll, round, currentRoll + 1);
  }, [
    phase,
    currentRoll,
    canRollInventory,
    gauntletRollShop,
    inventoryForRoll,
    round,
  ]);

  const continueLabel = localReady ? "Ready" : "Continue to next round";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl space-y-6 rounded-xl border border-amber-500/40 bg-amber-950/70 p-6 text-amber-100 shadow-2xl">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/70">
              Gauntlet Shop
            </div>
            <div className="text-2xl font-semibold text-amber-50">
              {localName}&rsquo;s shop
            </div>
            <div className="text-xs text-amber-200/80">Round {round}</div>
          </div>
          <div className="flex flex-col items-end gap-1 text-sm text-amber-200/80">
            <div className="flex items-center gap-2 text-base">
              <span className="text-amber-200/70">Gold</span>
              <span className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-900/60 px-2 py-1 text-lg font-semibold text-amber-50">
                <span aria-hidden="true">🪙</span>
                <span className="tabular-nums">{localGold}</span>
              </span>
            </div>
            <div>Roll #{currentRoll}</div>
          </div>
        </div>

        {/* Body */}
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          {/* LEFT: Inventory */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/70">
              Inventory
            </div>

            {localInventory.length === 0 ? (
              <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-900/20 p-4 text-sm text-amber-100/80">
                {canRollInventory
                  ? "Preparing shop inventory..."
                  : "No cards are available to purchase yet. Return after the next round."}
              </div>
            ) : (
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {localInventory.map((card) => {
                  const cost =
                    typeof card.cost === "number" && card.cost > 0
                      ? card.cost
                      : 10;
                  const canAfford = localGold >= cost;
                  const label = card.name ?? "Card";
                  const summary = (card.effectSummary ?? label)
                    .replace(/\s+/g, " ")
                    .trim();
                  const hoverText = summary
                    ? `${label}: ${summary.length > 120 ? `${summary.slice(0, 117)}...` : summary}`
                    : label;

                  return (
                    <div
                      key={card.id}
                      className="flex flex-col items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-900/30 p-4 text-sm shadow-sm"
                      title={hoverText ?? undefined}
                    >
                      <StSCard
                        card={card}
                        size="md"
                        variant="minimal"
                        showReserve={false}
                        disabled={!canAfford}
                        onPick={() =>
                          purchaseFromShop(localLegacySide, card, cost)
                        }
                      />
                      <div className="flex w-full items-center justify-between text-xs text-amber-200/90">
                        <span className="uppercase tracking-wide text-[10px] text-amber-200/70">
                          Cost
                        </span>
                        <span className="font-semibold text-amber-50">
                          {cost}g
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          purchaseFromShop(localLegacySide, card, cost)
                        }
                        disabled={!canAfford}
                        className="inline-flex w-full items-center justify-center rounded bg-amber-400 px-3 py-1 text-xs font-semibold text-slate-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Buy
                      </button>
                      {!canAfford ? (
                        <div className="text-[11px] text-rose-200/70">
                          Need {cost - localGold} more gold.
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* RIGHT: Status + Purchased */}
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-900/30 p-4 text-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/70">
                Status
              </div>
              <div className="mt-3 space-y-2 text-xs text-amber-100">
                <div className="flex items-center justify-between">
                  <span className="text-amber-200/70">{localName}</span>
                  <span
                    className={`font-semibold ${
                      localReady ? "text-emerald-300" : "text-amber-100"
                    }`}
                  >
                    {localReady ? "Ready" : "Shopping"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-amber-200/70">{remoteName}</span>
                  <span
                    className={`font-semibold ${
                      remoteReady ? "text-emerald-300" : "text-amber-100"
                    }`}
                  >
                    {remoteReady ? "Ready" : "Preparing"}
                  </span>
                </div>
              </div>
              <div className="mt-3 text-[11px] italic text-amber-200/80">
                {readyMessage}
              </div>
            </div>

            {localPurchases.length > 0 ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-900/30 p-4 text-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/70">
                  Purchased this round
                </div>
                <ul className="mt-2 space-y-1 text-xs text-amber-100/90">
                  {localPurchases.map((card) => (
                    <li key={card.id}>• {card.name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => markShopComplete(localLegacySide)}
            disabled={localReady}
            className={`inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-60 ${
              localReady
                ? "border border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                : "border border-emerald-500/60 bg-emerald-400 text-slate-900 hover:bg-emerald-300"
            }`}
          >
            {continueLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
