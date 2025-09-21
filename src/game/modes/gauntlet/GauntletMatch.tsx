import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MatchBoard from "../../../components/match/MatchBoard";
import HandDock from "../../../components/match/HandDock";
import TouchDragLayer, {
  useTouchDragLayer,
} from "../../../components/match/TouchDragLayer";
import GauntletPhasePanel from "./GauntletPhasePanel";
import type { Players, Side as TwoSide } from "../../types";
import useMultiplayerChannel from "../../match/useMultiplayerChannel";
import {
  type MPIntent,
  type Phase,
  useMatchController,
} from "../../match/useMatchController";
import {
  endGauntletRun,
  getGauntletRun,
  startGauntletRun,
} from "../../../player/profileStore";

const THEME = {
  panelBg: "#2c1c0e",
  panelBorder: "#5c4326",
  slotBg: "#1b1209",
  slotBorder: "#7a5a33",
  brass: "#b68a4e",
  textWarm: "#ead9b9",
} as const;

export interface GauntletMatchProps {
  localSide: TwoSide;
  localPlayerId: string;
  players: Players;
  seed: number;
  roomCode?: string;
  hostId?: string;
  targetWins?: number;
  onExit?: () => void;
  mode?: "gauntlet" | "arena";
}

export default function GauntletMatch({
  localSide,
  localPlayerId,
  players,
  seed,
  roomCode,
  hostId,
  targetWins,
  onExit,
  mode = "gauntlet",
}: GauntletMatchProps) {
  const isMultiplayer = Boolean(roomCode);

  const remoteIntentRef = useRef<(intent: MPIntent) => void>(() => {});

  const { sendIntent: channelSend } = useMultiplayerChannel<MPIntent>({
    roomCode,
    clientId: localPlayerId,
    onIntent: useCallback((intent: MPIntent) => {
      remoteIntentRef.current(intent);
    }, []),
  });

  const controller = useMatchController({
    localSide,
    players,
    seed,
    hostId,
    targetWins,
    isMultiplayer,
    sendIntent: channelSend,
    onExit,
    mode,
  });

  useEffect(() => {
    remoteIntentRef.current = controller.handleRemoteIntent;
  }, [controller.handleRemoteIntent]);

  useEffect(() => {
    const activeRun = getGauntletRun();
    if (!activeRun) {
      startGauntletRun();
    }

    return () => {
      endGauntletRun();
    };
  }, []);

  const {
    active,
    advanceVotes,
    assign,
    assignToWheelLocal,
    dragCardId,
    dragOverWheel,
    handleExitClick,
    handleNextClick,
    handleRematchClick,
    handleRevealClick,
    handClearance,
    HUD_COLORS,
    initiative,
    isMultiplayer: controllerIsMultiplayer,
    localLegacySide,
    localName,
    localWinsCount,
    localWon,
    lockedWheelSize,
    matchSummary,
    namesByLegacy,
    phase,
    player,
    enemy,
    remoteLegacySide,
    remoteName,
    remoteWinsCount,
    rematchVotes,
    reserveSums,
    resolveVotes,
    round,
    selectedCardId,
    setDragCardId,
    setDragOverWheel,
    setHandClearance,
    setSelectedCardId,
    wheelHUD,
    wheelRefs,
    wheelSections,
    wheelSize,
    winGoal,
    wins,
    matchWinner,
    xpDisplay,
    levelUpFlash,
    gold,
    shopInventory,
    shopPurchases,
    shopReady,
    configureShopInventory,
    markShopComplete,
    purchaseFromShop,
    gauntletRollShop,
    gauntletState,
    activationTurn,
    activationPasses,
    activationLog,
    activationAvailable,
    activationInitial,
    activationSwapPairs,
    activationAdjustments,
    pendingSwapCardId,
    activateCurrent,
    passActivation,
  } = controller;

  const {
    isDragging: isPointerDragging,
    dragCard: pointerDragCard,
    pointerPosition,
    startPointerDrag,
  } = useTouchDragLayer({
    active,
    assignToWheel: assignToWheelLocal,
    setDragOverWheel,
    setDragCardId,
    setSelectedCardId,
  });

  const [showRef, setShowRef] = useState(false);
  const [victoryCollapsed, setVictoryCollapsed] = useState(false);

  useEffect(() => {
    if (phase !== "ended") {
      setVictoryCollapsed(false);
    }
  }, [phase]);

  const resolveButtonDisabled =
    !controller.canReveal || (controllerIsMultiplayer && resolveVotes[localLegacySide]);
  const resolveButtonLabel =
    controllerIsMultiplayer && resolveVotes[localLegacySide] ? "Ready" : "Resolve";
  const resolveStatusText = useMemo(() => {
    if (!controllerIsMultiplayer || phase !== "choose") return null;
    const localReady = resolveVotes[localLegacySide];
    const remoteReady = resolveVotes[remoteLegacySide];
    if (localReady && !remoteReady) {
      return `Waiting for ${namesByLegacy[remoteLegacySide]}...`;
    }
    if (!localReady && remoteReady) {
      return `${namesByLegacy[remoteLegacySide]} is ready.`;
    }
    return null;
  }, [controllerIsMultiplayer, namesByLegacy, phase, resolveVotes, localLegacySide, remoteLegacySide]);

  const activationCardNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of assign.player) {
      if (card) map.set(card.id, card.name);
    }
    for (const card of assign.enemy) {
      if (card) map.set(card.id, card.name);
    }
    return map;
  }, [assign.enemy, assign.player]);

  const describeActivationEntry = useCallback(
    (entry: (typeof activationLog)[number]) => {
      const actorName = namesByLegacy[entry.side];
      if (entry.action === "pass") {
        return `${actorName} passes.`;
      }
      const cardName = entry.cardId ? activationCardNames.get(entry.cardId) ?? "Card" : "Card";
      return `${actorName} activates ${cardName}.`;
    },
    [activationCardNames, namesByLegacy],
  );

  const activationRecentText = useMemo(() => {
    if (activationLog.length === 0) return null;
    return describeActivationEntry(activationLog[activationLog.length - 1]);
  }, [activationLog, describeActivationEntry]);

  const isActivationPhase = phase === "activation";
  const isLocalActivationTurn = activationTurn === localLegacySide;
  const localHasActions = (activationAvailable[localLegacySide] ?? []).length > 0;
  const localHasPassed = activationPasses[localLegacySide];
  const remoteHasPassed = activationPasses[remoteLegacySide];
  const activationStatusText = isLocalActivationTurn
    ? localHasPassed
      ? "You have passed."
      : localHasActions
      ? "Tap one of your cards to activate it."
      : "No cards left — pass when ready."
    : `Waiting for ${namesByLegacy[activationTurn ?? remoteLegacySide]}.`;

  const advanceButtonDisabled = controllerIsMultiplayer && advanceVotes[localLegacySide];
  const advanceButtonLabel =
    controllerIsMultiplayer && advanceVotes[localLegacySide] ? "Ready" : "Next";
  const advanceStatusText = useMemo(() => {
    if (!controllerIsMultiplayer || phase !== "roundEnd") return null;
    const localReady = advanceVotes[localLegacySide];
    const remoteReady = advanceVotes[remoteLegacySide];
    if (localReady && !remoteReady) {
      return `Waiting for ${namesByLegacy[remoteLegacySide]}...`;
    }
    if (!localReady && remoteReady) {
      return `${namesByLegacy[remoteLegacySide]} is ready.`;
    }
    return null;
  }, [controllerIsMultiplayer, namesByLegacy, phase, advanceVotes, localLegacySide, remoteLegacySide]);

  const rematchButtonLabel =
    controllerIsMultiplayer && rematchVotes[localLegacySide] ? "Ready" : "Rematch";
  const rematchStatusText = useMemo(() => {
    if (!controllerIsMultiplayer || phase !== "ended") return null;
    const localReady = rematchVotes[localLegacySide];
    const remoteReady = rematchVotes[remoteLegacySide];
    if (localReady && !remoteReady) {
      return `Waiting for ${namesByLegacy[remoteLegacySide]}...`;
    }
    if (!localReady && remoteReady) {
      return `${namesByLegacy[remoteLegacySide]} is ready.`;
    }
    return null;
  }, [controllerIsMultiplayer, namesByLegacy, phase, rematchVotes, localLegacySide, remoteLegacySide]);

  const localGold = gold[localLegacySide] ?? 0;
  const gauntletPhaseUI = (
    <GauntletPhasePanel
      phase={phase}
      round={round}
      gold={gold}
      shopInventory={shopInventory}
      shopPurchases={shopPurchases}
      shopReady={shopReady}
      localLegacySide={localLegacySide}
      remoteLegacySide={remoteLegacySide}
      namesByLegacy={namesByLegacy}
      gauntletState={gauntletState}
      gauntletRollShop={gauntletRollShop}
      configureShopInventory={configureShopInventory}
      purchaseFromShop={purchaseFromShop}
      markShopComplete={markShopComplete}
      mode={mode}
    />
  );

  const xpProgressPercent = xpDisplay ? Math.min(100, xpDisplay.percent * 100) : 0;

  const HUDPanels = useCallback(() => {
    const rsPlayer = reserveSums ? reserveSums.player : null;
    const rsEnemy = reserveSums ? reserveSums.enemy : null;

    const Panel = ({ side }: { side: "player" | "enemy" }) => {
      const isPlayerSide = side === "player";
      const color = isPlayerSide
        ? players.left.color ?? HUD_COLORS.player
        : players.right.color ?? HUD_COLORS.enemy;
      const name = isPlayerSide ? players.left.name : players.right.name;
      const winCount = isPlayerSide ? wins.player : wins.enemy;
      const reserve = isPlayerSide ? rsPlayer : rsEnemy;
      const hasInit = initiative === side;
      const isReserveVisible =
        (phase === "showEnemy" || phase === "anim" || phase === "roundEnd" || phase === "ended") &&
        reserve !== null;

      return (
        <div className="flex h-full flex-col items-center w-full">
          <div
            className="relative flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1 text-[12px] shadow w-full"
            style={{
              maxWidth: "100%",
              background: THEME.panelBg,
              borderColor: THEME.panelBorder,
              color: THEME.textWarm,
            }}
          >
            <div className="w-1.5 h-6 rounded" style={{ background: color }} />
            <div className="flex items-center min-w-0 flex-1">
              <span className="truncate block font-semibold">{name}</span>
              {(isPlayerSide ? "player" : "enemy") === localLegacySide && (
                <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px]">You</span>
              )}
            </div>
            <div className="flex items-center gap-1 ml-1 flex-shrink-0">
              <span className="opacity-80">Wins</span>
              <span className="text-base font-extrabold tabular-nums">{winCount}</span>
            </div>
            <div
              className={`ml-2 hidden sm:flex rounded-full border px-2 py-0.5 text-[11px] overflow-hidden text-ellipsis whitespace-nowrap transition-opacity ${
                isReserveVisible ? "opacity-100 visible" : "opacity-0 invisible"
              }`}
              style={{
                maxWidth: "44vw",
                minWidth: "90px",
                background: "#1b1209ee",
                borderColor: THEME.slotBorder,
                color: THEME.textWarm,
              }}
              title={reserve !== null ? `Reserve: ${reserve}` : undefined}
            >
              Reserve: <span className="font-bold tabular-nums">{reserve ?? 0}</span>
            </div>

            {hasInit && (
              <span
                aria-label="Has initiative"
                className="absolute -top-1 -right-1 leading-none select-none"
                style={{ fontSize: 24, filter: "drop-shadow(0 1px 1px rgba(0,0,0,.6))" }}
              >
                ⚑
              </span>
            )}
          </div>

          {isReserveVisible && (
            <div className="mt-1 w-full sm:hidden">
              <div
                className="w-full rounded-full border px-3 py-1 text-[11px] text-center"
                style={{
                  background: "#1b1209ee",
                  borderColor: THEME.slotBorder,
                  color: THEME.textWarm,
                }}
                title={reserve !== null ? `Reserve: ${reserve}` : undefined}
              >
                Reserve: <span className="font-bold tabular-nums">{reserve ?? 0}</span>
              </div>
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="w-full flex flex-col items-center">
        <div className="grid w-full max-w-[900px] grid-cols-2 items-stretch gap-2 overflow-x-hidden">
          <div className="min-w-0 w-full max-w-[420px] mx-auto h-full">
            <Panel side="player" />
          </div>
          <div className="min-w-0 w-full max-w-[420px] mx-auto h-full">
            <Panel side="enemy" />
          </div>
        </div>
      </div>
    );
  }, [HUD_COLORS.enemy, HUD_COLORS.player, initiative, localLegacySide, phase, players, reserveSums, wins]);

  return (
    <div
      className="h-screen w-screen overflow-x-hidden overflow-y-hidden text-slate-100 p-1 grid gap-2"
      style={{ gridTemplateRows: "auto auto 1fr auto" }}
    >
      <div className="flex items-center justify-between text-[12px] min-h-[24px]">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div>
              <span className="opacity-70">Round</span> <span className="font-semibold">{round}</span>
            </div>
            <div>
              <span className="opacity-70">Phase</span> <span className="font-semibold">{phase}</span>
            </div>
            <div>
              <span className="opacity-70">Goal</span> <span className="font-semibold">First to {winGoal} wins</span>
            </div>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-amber-200/80">
            <span aria-hidden="true">🪙</span>
            <span className="tabular-nums font-semibold text-amber-100">{localGold}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 relative">
          <button
            onClick={() => setShowRef((value) => !value)}
            className="px-2.5 py-0.5 rounded bg-slate-700 text-white border border-slate-600 hover:bg-slate-600"
          >
            Reference
          </button>
          {showRef && (
            <div className="absolute top-[110%] right-0 w-80 rounded-lg border border-slate-700 bg-slate-800/95 shadow-xl p-3 z-50">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">Reference</div>
                <button
                  onClick={() => setShowRef(false)}
                  className="text-xl leading-none text-slate-300 hover:text-white"
                >
                  ×
                </button>
              </div>
              <div className="text-[12px] space-y-2">
                <div>
                  Place <span className="font-semibold">1 card next to each wheel</span>, then
                  <span className="font-semibold"> press the Resolve button</span>. Where the
                  <span className="font-semibold"> token stops</span> decides the winning rule, and the player who matches it gets
                  <span className="font-semibold"> 1 win</span>. First to <span className="font-semibold">{winGoal}</span> wins takes the match.
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>💥 Strongest — higher value wins</li>
                  <li>🦊 Weakest — lower value wins</li>
                  <li>🗃️ Reserve — compare the two cards left in hand</li>
                  <li>🎯 Closest — value closest to target wins</li>
                  <li>⚑ Initiative — initiative holder wins</li>
                  <li><span className="font-semibold">0 Start</span> — no one wins</li>
                </ul>
              </div>
            </div>
          )}
          {phase === "choose" && (
            <div className="flex flex-col items-end gap-1">
              <button
                disabled={resolveButtonDisabled}
                onClick={handleRevealClick}
                className="px-2.5 py-0.5 rounded bg-amber-400 text-slate-900 font-semibold disabled:opacity-50"
              >
                {resolveButtonLabel}
              </button>
              {controllerIsMultiplayer && resolveStatusText && (
                <span className="text-[11px] italic text-amber-200 text-right leading-tight">
                  {resolveStatusText}
                </span>
              )}
            </div>
          )}
          {isActivationPhase && (
            <div className="flex flex-col items-end gap-1 text-right max-w-xs sm:max-w-sm">
              <div className="text-[11px] uppercase tracking-wide text-emerald-200/80">Activation Phase</div>
              <div className="text-sm text-emerald-100/90">{activationStatusText}</div>
              {pendingSwapCardId ? (
                <div className="text-[11px] text-sky-200/80">
                  Swap primed: the next activation will exchange values with your swap card.
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => passActivation(localLegacySide)}
                  disabled={!isLocalActivationTurn || localHasPassed}
                  className="rounded bg-emerald-500 px-3 py-1 text-[12px] font-semibold text-slate-900 disabled:opacity-50"
                >
                  {localHasPassed ? "Passed" : "Pass"}
                </button>
                {remoteHasPassed && !localHasPassed ? (
                  <span className="text-[11px] text-emerald-100/70">
                    {namesByLegacy[remoteLegacySide]} has passed.
                  </span>
                ) : null}
              </div>
              {activationRecentText ? (
                <div className="w-full rounded border border-emerald-400/30 bg-emerald-950/40 p-2 text-left text-[11px] text-emerald-100/80">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-200/60">Last action</div>
                  <p className="mt-1 leading-snug">{activationRecentText}</p>
                </div>
              ) : null}
            </div>
          )}
          {phase === "roundEnd" && (
            <div className="flex flex-col items-end gap-1">
              <button
                disabled={advanceButtonDisabled}
                onClick={handleNextClick}
                className="px-2.5 py-0.5 rounded bg-emerald-500 text-slate-900 font-semibold disabled:opacity-50"
              >
                {advanceButtonLabel}
              </button>
              {controllerIsMultiplayer && advanceStatusText && (
                <span className="text-[11px] italic text-emerald-200 text-right leading-tight">
                  {advanceStatusText}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="relative z-10">
        <HUDPanels />
      </div>

      {gauntletPhaseUI}
      <div className="relative z-0" style={{ paddingBottom: handClearance }}>
        <MatchBoard
          theme={THEME}
          active={active}
          assign={assign}
          namesByLegacy={namesByLegacy}
          wheelSize={wheelSize}
          lockedWheelSize={lockedWheelSize}
          selectedCardId={selectedCardId}
          onSelectCard={setSelectedCardId}
          localLegacySide={localLegacySide}
          phase={phase}
          startPointerDrag={startPointerDrag}
          fighters={{ player, enemy }}
          dragCardId={dragCardId}
          onDragCardChange={setDragCardId}
          dragOverWheel={dragOverWheel}
          onDragOverWheelChange={setDragOverWheel}
          assignToWheel={assignToWheelLocal}
          wheelHUD={wheelHUD}
          hudColors={HUD_COLORS}
          wheelSections={wheelSections}
          wheelRefs={wheelRefs}
          activationAdjustments={activationAdjustments}
          activationSwapPairs={activationSwapPairs}
          activationAvailable={activationAvailable}
          activationInitial={activationInitial}
          activationPasses={activationPasses}
          activationTurn={activationTurn}
          pendingSwapCardId={pendingSwapCardId}
          onActivateCard={(cardId) => activateCurrent(localLegacySide, cardId)}
        />
      </div>

      <HandDock
        localFighter={localLegacySide === "player" ? player : enemy}
        selectedCardId={selectedCardId}
        onSelectCard={setSelectedCardId}
        localLegacySide={localLegacySide}
        assign={assign}
        onAssignToWheel={assignToWheelLocal}
        onDragCardChange={setDragCardId}
        startPointerDrag={startPointerDrag}
        isPointerDragging={isPointerDragging}
        pointerDragCard={pointerDragCard}
        pointerPosition={pointerPosition}
        onMeasure={setHandClearance}
      />

      <TouchDragLayer
        dragCard={pointerDragCard}
        isDragging={isPointerDragging}
        pointerPosition={pointerPosition}
      />

      {phase === "ended" && (
        <>
          {victoryCollapsed ? (
            <button
              onClick={() => setVictoryCollapsed(false)}
              className={`fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border px-4 py-2 text-sm font-semibold shadow-lg transition hover:-translate-y-[1px] focus:outline-none focus:ring-2 focus:ring-emerald-400/60 ${
                localWon
                  ? "border-emerald-500/40 bg-emerald-900/70 text-emerald-100"
                  : "border-slate-700 bg-slate-900/80 text-slate-100"
              }`}
            >
              <span className="rounded-full bg-slate-950/40 px-2 py-0.5 text-xs uppercase tracking-wide">
                {localWon ? "Victory" : "Defeat"}
              </span>
              <span className="text-xs opacity-80">Tap to reopen results</span>
              {localWon && matchSummary?.expGained ? (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-100">
                  +{matchSummary.expGained} XP
                </span>
              ) : null}
            </button>
          ) : null}

          {!victoryCollapsed && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm px-3">
              <div className="relative w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900/95 p-6 text-center shadow-2xl space-y-4">
                <button
                  onClick={() => setVictoryCollapsed(true)}
                  className="group absolute top-2 right-2 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-800/80 text-slate-200 transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
                  aria-label="Minimize results"
                  title="Minimize"
                >
                  <div className="flex flex-col items-end text-right leading-none">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/80 transition group-hover:text-emerald-100">
                      Hide
                    </span>
                    <svg
                      aria-hidden
                      focusable="false"
                      className="mt-1 h-5 w-5 text-emerald-200 transition group-hover:text-emerald-100"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M4 10a1 1 0 0 1 1-1h6.586L9.293 6.707a1 1 0 1 1 1.414-1.414l4.5 4.5a1 1 0 0 1 0 1.414l-4.5 4.5a1 1 0 0 1-1.414-1.414L11.586 11H5a1 1 0 0 1-1-1Z" />
                    </svg>
                  </div>
                  <span className="text-lg font-semibold leading-none text-slate-200 transition group-hover:text-white">
                    –
                  </span>
                </button>

                <div className={`text-3xl font-bold ${localWon ? "text-emerald-300" : "text-rose-300"}`}>
                  {localWon ? "Victory" : "Defeat"}
                </div>

                <div className="text-sm text-slate-200">
                  {localWon
                    ? `You reached ${winGoal} wins.`
                    : `${matchWinner ? namesByLegacy[matchWinner] : remoteName} reached ${winGoal} wins.`}
                </div>

                <div className="rounded-md border border-slate-700 bg-slate-800/80 px-4 py-3 text-sm text-slate-100">
                  <div className="font-semibold tracking-wide uppercase text-xs text-slate-400">Final Score</div>
                  <div className="mt-2 flex items-center justify-center gap-3 text-base font-semibold">
                    <span className="text-emerald-300">{localName}</span>
                    <span className="px-2 py-0.5 rounded bg-slate-900/60 text-slate-200 tabular-nums">{localWinsCount}</span>
                    <span className="text-slate-500">—</span>
                    <span className="px-2 py-0.5 rounded bg-slate-900/60 text-slate-200 tabular-nums">{remoteWinsCount}</span>
                    <span className="text-rose-300">{remoteName}</span>
                  </div>
                </div>

                {localWon && matchSummary?.didWin && xpDisplay && (
                  <div className="rounded-md border border-emerald-500/40 bg-emerald-900/15 px-4 py-3 text-sm text-emerald-50">
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-emerald-200/80">
                      <span>Level {xpDisplay.level}</span>
                      <span>
                        {xpDisplay.exp} / {xpDisplay.expToNext} XP
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-emerald-950/50">
                      <div
                        className="h-2 rounded-full bg-emerald-400 transition-[width] duration-500"
                        style={{ width: `${xpProgressPercent}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-emerald-100/90">
                      <span>+{matchSummary.expGained} XP</span>
                      <span>Win streak: {matchSummary.streak}</span>
                    </div>
                    {levelUpFlash && (
                      <div className="mt-2 text-base font-semibold uppercase tracking-wide text-amber-200">
                        Level up!
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <button
                    disabled={controllerIsMultiplayer && rematchVotes[localLegacySide]}
                    onClick={handleRematchClick}
                    className="w-full rounded bg-emerald-500 px-4 py-2 font-semibold text-slate-900 disabled:opacity-50"
                  >
                    {rematchButtonLabel}
                  </button>
                  {controllerIsMultiplayer && rematchStatusText && (
                    <span className="text-[11px] italic text-amber-200 leading-tight">
                      {rematchStatusText}
                    </span>
                  )}
                  {onExit && (
                    <button
                      onClick={handleExitClick}
                      className="w-full rounded border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                    >
                      Exit to Main Menu
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
