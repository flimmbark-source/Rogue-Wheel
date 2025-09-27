// src/AppShell.tsx
import React, { useState } from "react";
import App from "./App";
import HubRoute from "./HubRoute";
import MultiplayerRoute from "./MultiplayerRoute";
import { TARGET_WINS, type Players, type Side } from "./game/types";
import ProfilePage from "./ProfilePage";
import ModeSelect from "./ModeSelect";
import { DEFAULT_GAME_MODE, normalizeGameMode, type GameMode } from "./gameModes";

type MPStartPayload = Parameters<
  NonNullable<React.ComponentProps<typeof MultiplayerRoute>["onStart"]>
>[0];

type GameView = { key: "game"; mode: "solo" | "mp"; mpPayload?: MPStartPayload };

type View =
  | { key: "hub" }
  | { key: "mp" }
  | { key: "profile" }
  | { key: "modeSelect"; from: "hub" | "mp"; next: GameView }
  | GameView;

export default function AppShell() {
  const [view, setView] = useState<View>({ key: "hub" });
  const [mpPayload, setMpPayload] = useState<MPStartPayload | null>(null);
  const [gameMode, setGameMode] = useState<GameMode>(() => [...DEFAULT_GAME_MODE]);
  const [soloTargetWins, setSoloTargetWins] = useState<number>(TARGET_WINS);

  if (view.key === "hub") {
    return (
      <HubRoute
        onStart={() =>
          setView({ key: "modeSelect", from: "hub", next: { key: "game", mode: "solo" } })
        }
        onMultiplayer={() => setView({ key: "mp" })}
        onProfile={() => setView({ key: "profile" })}
      />
    );
  }

  if (view.key === "mp") {
    return (
      <MultiplayerRoute
        onBack={() => setView({ key: "hub" })}
        onStart={(payload) => {
          const normalizedMode = normalizeGameMode(payload.gameMode);
          const nextPayload = { ...payload, gameMode: normalizedMode };
          setGameMode(normalizedMode);
          setMpPayload(nextPayload);
          setView({ key: "game", mode: "mp", mpPayload: nextPayload });
        }}
      />
    );
  }

  if (view.key === "profile") {
    return (
      <div className="min-h-dvh flex flex-col">
        <div className="p-2">
          <button className="underline text-sm" onClick={() => setView({ key: "hub" })}>
            ← Back to Main Menu
          </button>
        </div>
        <ProfilePage />
      </div>
    );
  }

  if (view.key === "modeSelect") {
    const isMp = view.from === "mp";
    const confirmLabel = view.next.mode === "mp" ? "Launch Match" : "Start Run";
    const backLabel = isMp ? "← Back to Lobby" : "← Back to Main Menu";
    const initialTargetWins = view.next.mode === "mp"
      ? view.next.mpPayload?.targetWins ?? mpPayload?.targetWins ?? TARGET_WINS
      : soloTargetWins;

    return (
      <ModeSelect
        initialMode={gameMode}
        initialTargetWins={initialTargetWins}
        showTargetWinsInput={view.next.mode === "solo"}
        backLabel={backLabel}
        confirmLabel={confirmLabel}
        onBack={() => {
          setView({ key: view.from });
          setMpPayload(null);
        }}
        onConfirm={(mode, winsGoal) => {
          setGameMode(normalizeGameMode(mode));

          if (view.next.mode === "mp") {
            const payload = view.next.mpPayload ?? mpPayload;
            if (!payload) {
              setView({ key: "mp" });
              return;
            }
            const nextPayload = {
              ...payload,
              targetWins: winsGoal,
              gameMode: normalizeGameMode(mode),
            };
            setMpPayload(nextPayload);
            setView({ key: "game", mode: "mp", mpPayload: nextPayload });
            return;
          }

          setSoloTargetWins(winsGoal);
          setView({ key: "game", mode: "solo" });
        }}
      />
    );
  }

  // ---- view.key === "game" ----
  // (unchanged)
  let seed: number;
  let players: Players;
  let localSide: Side;
  let localPlayerId: string;
  let extraProps: { roomCode?: string; hostId?: string; targetWins?: number } = {};

  if (view.mode === "mp" && (view.mpPayload ?? mpPayload)) {
    const mp = (view.mpPayload ?? mpPayload)!;
    seed = mp.seed;
    players = mp.players;
    localSide = mp.localSide;
    localPlayerId = mp.players[localSide].id;
    extraProps = { roomCode: mp.roomCode, hostId: mp.hostId, targetWins: mp.targetWins };
  } else {
    seed = Math.floor(Math.random() * 2 ** 31);
    players = {
      left:  { id: "local",  name: "Player",     color: "#22c55e" },
      right: { id: "ai:nem", name: "Nemesis", color: "#f97316" },
    };
    localSide = "left";
    localPlayerId = "local";
    extraProps = { targetWins: soloTargetWins };
  }

  const exitToMenu = () => {
    setView({ key: "hub" });
    setMpPayload(null);
  };

  return (
    <App
      localSide={localSide}
      localPlayerId={localPlayerId}
      players={players}
      seed={seed}
      onExit={exitToMenu}
      gameMode={gameMode}
      {...extraProps}
    />
  );
}
