// src/AppShell.tsx
import React, { useState } from "react";
import App from "./App";
import HubRoute from "./HubRoute";
import MultiplayerRoute from "./MultiplayerRoute";

type View =
  | { key: "hub" }
  | { key: "mp" }
  | { key: "game"; mode: "solo" | "mp"; mpPayload?: any };

export default function AppShell() {
  const [view, setView] = useState<View>({ key: "hub" });
  const [mpPayload, setMpPayload] = useState<any>(null);

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
          setMpPayload(payload);               // keep for your game
          setView({ key: "game", mode: "mp", mpPayload: payload });
        }}
      />
    );
  }

  // view.key === "game"
  return (
    <App
      // TODO: once your <App> accepts props, thread mpPayload/mode in:
      // mode={view.mode}
      // mp={mpPayload}
    />
  );
}