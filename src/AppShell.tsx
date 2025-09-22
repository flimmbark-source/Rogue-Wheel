// src/AppShell.tsx
import React, { useState } from "react";
import type { Realtime } from "ably";
import App from "./App";
import HubRoute from "./HubRoute";
import MultiplayerRoute from "./MultiplayerRoute";
import type { MatchModeId, Players, Side } from "./game/types";
import ProfilePage from "./ProfilePage";

type MPStartPayload = Parameters<
  NonNullable<React.ComponentProps<typeof MultiplayerRoute>["onStart"]>
>[0];

type View =
  | { key: "hub" }
  | { key: "mp" }
  | { key: "profile" }
  | { key: "game"; mode: "solo" | "mp"; mpPayload?: MPStartPayload };

export default function AppShell() {
  const [view, setView] = useState<View>({ key: "hub" });
  const [mpPayload, setMpPayload] = useState<MPStartPayload | null>(null);

  if (view.key === "hub") {
    return (
      <HubRoute
        onStart={() => setView({ key: "game", mode: "solo" })}
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
          setMpPayload(payload);
          setView({ key: "game", mode: "mp", mpPayload: payload });
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

  // ---- view.key === "game" ----
  // (unchanged)
  let seed: number;
  let players: Players;
  let localSide: Side;
  let localPlayerId: string;
  let extraProps: {
    roomCode?: string;
    hostId?: string;
    targetWins?: number;
    modeId?: MatchModeId;
    timerSeconds?: number | null;
  } = {};

  if (view.mode === "mp" && (view.mpPayload ?? mpPayload)) {
    const mp = (view.mpPayload ?? mpPayload)!;
    seed = mp.seed;
    players = mp.players;
    localSide = mp.localSide;
    localPlayerId = mp.players[localSide].id;
    extraProps = {
      roomCode: mp.roomCode,
      hostId: mp.hostId,
      targetWins: mp.targetWins,
      modeId: mp.modeId,
      timerSeconds: mp.timerSeconds,
    };
  } else {
    seed = Math.floor(Math.random() * 2 ** 31);
    players = {
      left:  { id: "local",  name: "Player",     color: "#22c55e" },
      right: { id: "ai:nem", name: "Nemesis", color: "#f97316" },
    };
    localSide = "left";
    localPlayerId = "local";
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
      {...extraProps}
    />
  );
}
