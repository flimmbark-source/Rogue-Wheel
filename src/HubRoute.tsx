import React from "react";
import RogueWheelHub from "../ui/RogueWheelHub";

export default function HubRoute({
  onStart,
  onMultiplayer,
}: {
  onStart: () => void;
  onMultiplayer: () => void;
}) {
  return (
    <RogueWheelHub
      hasSave={false}
      onNew={onStart}
      onContinue={onStart}
      onMultiplayer={onMultiplayer}   // ← wire it here
      onQuit={() => console.log("Quit clicked")}
      profileName="Adventurer"
      version="v0.1.0"
    />
  );
}

