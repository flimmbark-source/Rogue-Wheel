// src/AppShell.tsx
import React, { useCallback, useEffect, useState } from "react";
import App from "./App";
import HubRoute from "./HubRoute";
import MultiplayerRoute from "./MultiplayerRoute";
import type { Players, Side } from "./game/types";
import ProfilePage from "./ProfilePage";
import SoloModeRoute from "./SoloModeRoute";

type MPStartPayload = Parameters<
  NonNullable<React.ComponentProps<typeof MultiplayerRoute>["onStart"]>
>[0];

type View =
  | { key: "hub" }
  | { key: "soloMenu" }
  | { key: "mp" }
  | { key: "profile" }
  | { key: "game"; mode: "classic" | "gauntlet" }
  | { key: "game"; mode: "mp"; mpPayload?: MPStartPayload };

export default function AppShell() {
  const [view, setView] = useState<View>({ key: "hub" });
  const [mpPayload, setMpPayload] = useState<MPStartPayload | null>(null);

  const goToHub = useCallback(() => setView({ key: "hub" }), [setView]);
  const goToSoloMenu = useCallback(() => setView({ key: "soloMenu" }), [setView]);
  const goToMultiplayer = useCallback(() => setView({ key: "mp" }), [setView]);
  const goToProfile = useCallback(() => setView({ key: "profile" }), [setView]);
  const startClassic = useCallback(() => setView({ key: "game", mode: "classic" }), [setView]);
  const startGauntlet = useCallback(() => setView({ key: "game", mode: "gauntlet" }), [setView]);

  useEffect(() => {
    const handleNewRun = () => goToSoloMenu();

    window.addEventListener("rw:new-run", handleNewRun);
    return () => {
      window.removeEventListener("rw:new-run", handleNewRun);
    };
  }, [goToSoloMenu]);

  if (view.key === "hub") {
    return (
      <HubRoute
        onStart={goToSoloMenu}
        onMultiplayer={goToMultiplayer}
        onProfile={goToProfile}
      />
    );
  }

  if (view.key === "soloMenu") {
    return (
      <SoloModeRoute
        onBack={goToHub}
        onSelectClassic={startClassic}
        onSelectGauntlet={startGauntlet}
      />
    );
  }

  if (view.key === "mp") {
    return (
      <MultiplayerRoute
        onBack={goToHub}
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
          <button className="underline text-sm" onClick={goToHub}>
            ← Back to Main Menu
          </button>
        </div>
        <ProfilePage />
      </div>
    );
  }

  // ---- view.key === "game" ----
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
  }

  const exitToMenu = () => {
    goToHub();
    setMpPayload(null);
  };

  return (
    <App
      mode={view.mode === "gauntlet" ? "gauntlet" : "classic"}
      localSide={localSide}
      localPlayerId={localPlayerId}
      players={players}
      seed={seed}
      onExit={exitToMenu}
      {...extraProps}
    />
  );
}
