import React from "react";
import RogueWheelHub from "../ui/RogueWheelHub";
import { getProfileBundle } from "./player/profileStore";

type Props = {
  onStart: () => void;
  onMultiplayer: () => void;
  onProfile: () => void;
};

export default function HubRoute({ onStart, onMultiplayer, onProfile }: Props) {
  const { profile } = getProfileBundle();
  const displayName = profile?.displayName ?? "Adventurer";

  return (
    <RogueWheelHub
      hasSave={false}
      onNew={onStart}
      onContinue={onStart}
      onMultiplayer={onMultiplayer}
      onQuit={() => console.log("Quit clicked")}
      profileName={displayName}
      version="v0.1.0"
      onProfile={onProfile}
    />
  );
}
