import React from "react";
import RogueWheelHub from "../ui/RogueWheelHub";

export default function HubRoute({ onStart }: { onStart: () => void }) {
  return (
    <RogueWheelHub
      hasSave={false}
      onNew={onStart}
      onContinue={onStart}
      onQuit={() => console.log("Quit clicked")}
      profileName="Adventurer"
      version="v0.1.0"
    />
  );
}
