import React, { useState } from "react";
import App from "./App";
import RogueWheelHub from "../ui/RogueWheelHub";

export default function AppShell() {
  const [showGame, setShowGame] = useState(false);

  if (showGame) {
    return <App />;
  }

  return (
    <RogueWheelHub
      onPlay={() => setShowGame(true)}
      onContinue={() => setShowGame(true)}
      onNewRun={() => setShowGame(true)}
      continueAvailable={true}
    />
  );
}
