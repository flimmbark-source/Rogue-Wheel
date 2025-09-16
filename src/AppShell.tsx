// src/AppShell.tsx
import React, { useState } from "react";
import type { Realtime } from "ably";
import App from "./App";
import HubRoute from "./HubRoute";
import MultiplayerRoute from "./MultiplayerRoute";
import type { Players, Side } from "./game/types";

// Shape emitted by MultiplayerRoute.onStart
type MPStartPayload = {
  roomCode: string;
  seed: number;
  hostId: string;
  players: Players;   // { left: {id,name,color}, right: {…} }
  localSide: Side;    // side for THIS client
  channelName: string;
  channel: ReturnType<Realtime["channels"]["get"]>;
  clientId: string;
  ably: Realtime;
};

type View =
  | { key: "hub" }
  | { key: "mp" }
  | { key: "game"; mode: "solo" | "mp"; mpPayload?: MPStartPayload };

export default function AppShell() {
  const [view, setView] = useState<View>({ key: "hub" });
  const [mpPayload, setMpPayload] = useState<MPStartPayload | null>(null);

  if (view.key === "hub") {
    return (
      <HubRoute
        onStart={() => setView({ key: "game", mode: "solo" })}
        onMultiplayer={() => setView({ key: "mp" })}
      />
    );
  }

  if (view.key === "mp") {
    return (
      <MultiplayerRoute
        onBack={() => setView({ key: "hub" })}
        onStart={(payload) => {
          setMpPayload(payload); // keep for reference/analytics if needed
          setView({ key: "game", mode: "mp", mpPayload: payload });
        }}
      />
    );
  }

  // ---- view.key === "game" ----
  // Build the config the App needs, depending on mode.
  let seed: number;
  let players: Players;
  let localSide: Side;
  let localPlayerId: string;
  let extraProps: {
    roomCode?: string;
    hostId?: string;
  } = {};

  if (view.mode === "mp" && (view.mpPayload ?? mpPayload)) {
    // Multiplayer path (use payload from route)
    const mp = (view.mpPayload ?? mpPayload)!;
    seed = mp.seed;
    players = mp.players;
    localSide = mp.localSide;
    localPlayerId = mp.players[localSide].id;
    extraProps = {
      roomCode: mp.roomCode,
      hostId: mp.hostId,
    };
  } else {
    // Solo path (fabricate right-side AI)
    seed = Math.floor(Math.random() * 2 ** 31);
    players = {
      left:  { id: "local",  name: "You",     color: "#22c55e" }, // green
      right: { id: "ai:nem", name: "Nemesis", color: "#f97316" }, // orange
    };
    localSide = "left";
    localPlayerId = "local";
  }

  return (
    <App
      // NEW props your <App /> should accept
      localSide={localSide}
      localPlayerId={localPlayerId}
      players={players}
      seed={seed}
      {...extraProps}
      // Optionally add:
      // onExit={() => setView({ key: "hub" })}
      // mode={view.mode}
    />
  );
}
