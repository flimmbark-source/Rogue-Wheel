import { useEffect } from "react";

import type { Card, Fighter } from "../../types";
import type {
  GauntletState,
  LegacySide,
  Phase,
} from "../../match/useMatchController";

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
  activationTurn: LegacySide | null;
  activationPasses: { player: boolean; enemy: boolean };
  activationLog: { side: LegacySide; action: "activate" | "pass"; cardId?: string }[];
  activateCurrent: (side: LegacySide, cardId?: string) => boolean;
  passActivation: (side: LegacySide) => boolean;
  gauntletSelectActivation: (activationId: string) => void;
  localFighter: Fighter;
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
  activationTurn,
  activationPasses,
  activationLog,
  activateCurrent,
  passActivation,
  gauntletSelectActivation,
  localFighter,
}: GauntletPhasePanelProps) {
  if (phase !== "shop" && phase !== "activation" && phase !== "activationComplete") {
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
  const activationSelection = localGauntlet?.activation.selection ?? null;
  const localHand = localFighter.hand ?? [];

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

  const inventoryForRoll = localInventory.length > 0 ? localInventory : previousInventory;
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
  }, [phase, currentRoll, canRollInventory, gauntletRollShop, inventoryForRoll, round]);

  const continueLabel = localReady ? "Ready" : "Continue to next round";

  if (phase === "shop") {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-4">
        <div className="w-full max-w-4xl space-y-6 rounded-xl border border-amber-500/40 bg-amber-950/70 p-6 text-amber-100 shadow-2xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/70">Gauntlet Shop</div>
              <div className="text-2xl font-semibold text-amber-50">{localName}'s shop</div>
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

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/70">Inventory</div>
              {localInventory.length === 0 ? (
                <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-900/20 p-4 text-sm text-amber-100/80">
                  {canRollInventory
                    ? "Preparing shop inventory..."
                    : "No cards are available to purchase yet. Return after the next round."}
                </div>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {localInventory.map((card) => (
                    <div
                      key={card.id}
                      className="rounded-lg border border-amber-500/30 bg-amber-900/40 p-4 text-sm shadow-sm"
                    >
                      <div className="font-semibold text-amber-50">{card.name}</div>
                      {typeof card.number === "number" ? (
                        <div className="text-xs text-amber-200/80">Value {card.number}</div>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => purchaseFromShop(localLegacySide, card)}
                        disabled={localGold <= 0}
                        className="mt-3 inline-flex items-center justify-center rounded bg-amber-400 px-3 py-1 text-xs font-semibold text-slate-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Buy (1g)
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-amber-500/30 bg-amber-900/30 p-4 text-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/70">Status</div>
                <div className="mt-3 space-y-2 text-xs text-amber-100">
                  <div className="flex items-center justify-between">
                    <span className="text-amber-200/70">{localName}</span>
                    <span className={`font-semibold ${localReady ? "text-emerald-300" : "text-amber-100"}`}>
                      {localReady ? "Ready" : "Shopping"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-amber-200/70">{remoteName}</span>
                    <span className={`font-semibold ${remoteReady ? "text-emerald-300" : "text-amber-100"}`}>
                      {remoteReady ? "Ready" : "Preparing"}
                    </span>
                  </div>
                </div>
                <div className="mt-3 text-[11px] italic text-amber-200/80">{readyMessage}</div>
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

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => gauntletRollShop(inventoryForRoll, round, currentRoll + 1)}
                disabled={!canRollInventory}
                className="inline-flex items-center justify-center gap-2 rounded border border-amber-500/40 bg-amber-400 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span aria-hidden="true">🎲</span> Reroll inventory
              </button>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
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
      </div>
    );
  }

  if (phase === "activation") {
    const isLocalTurn = activationTurn === localLegacySide;
    const localPassed = activationPasses[localLegacySide];
    const remotePassed = activationPasses[remoteLegacySide];

    return (
      <div className="relative z-10 mx-auto w-full max-w-3xl text-sky-100">
        <div className="rounded-lg border border-sky-500/40 bg-sky-950/40 p-4 shadow-lg">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-200/70">Activation Phase</div>
                <div className="text-lg font-semibold text-sky-100">
                  {isLocalTurn ? "Your activation" : `${remoteName}'s activation`}
                </div>
              </div>
              <div className="text-right text-xs text-sky-200/80">
                <div>Turn: {activationTurn ? namesByLegacy[activationTurn] : "—"}</div>
                <div>{remotePassed ? `${remoteName} has passed.` : `${remoteName} is deciding...`}</div>
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-200/70">
                Select a card to activate
              </div>
              {localHand.length === 0 ? (
                <div className="mt-1 text-xs text-sky-200/70">
                  No cards in hand are available for activations.
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {localHand.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => gauntletSelectActivation(card.id)}
                      className={`rounded border px-3 py-1 text-xs font-semibold transition ${
                        activationSelection === card.id
                          ? "border-sky-400 bg-sky-500/30 text-white"
                          : "border-sky-500/30 bg-sky-900/40 text-sky-100 hover:border-sky-400/60"
                      }`}
                    >
                      {card.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => activateCurrent(localLegacySide, activationSelection ?? undefined)}
                disabled={!isLocalTurn || activationSelection === null}
                className="inline-flex items-center justify-center rounded border border-sky-500/40 bg-sky-400 px-3 py-1 text-xs font-semibold text-slate-900 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Activate
              </button>
              <button
                type="button"
                onClick={() => passActivation(localLegacySide)}
                disabled={!isLocalTurn || localPassed}
                className="inline-flex items-center justify-center rounded border border-sky-500/40 bg-sky-500/20 px-3 py-1 text-xs font-semibold text-sky-100 transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {localPassed ? "Passed" : "Pass"}
              </button>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-200/70">Activation Log</div>
              <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto text-xs">
                {activationLog.length === 0 ? (
                  <li className="opacity-70">No activations yet.</li>
                ) : (
                  activationLog.map((entry, index) => (
                    <li key={`${entry.side}-${index}`}>
                      <span className="font-semibold">{namesByLegacy[entry.side]}</span>{" "}
                      {entry.action === "activate" ? "activated" : "passed"}
                      {entry.cardId ? ` (${entry.cardId})` : ""}.
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10 mx-auto w-full max-w-3xl text-emerald-100">
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-4 text-sm shadow-lg">
        Activation phase complete. Preparing the next round...
      </div>
    </div>
  );
}
