import React from "react";
import RogueWheelHub from "../ui/RogueWheelHub";
import { getProfileBundle, expRequiredForLevel } from "./player/profileStore";

type Props = {
  onStart: () => void;
  onMultiplayer: () => void;
  onProfile: () => void;
};

export default function HubRoute({ onStart, onMultiplayer, onProfile }: Props) {
  const { profile } = getProfileBundle();
  const displayName = profile?.displayName ?? "Adventurer";
  const level = profile?.level ?? 1;
  const expToNext = expRequiredForLevel(level);
  const exp = Math.min(profile?.exp ?? 0, expToNext);

  return (
    <RogueWheelHub
      hasSave={false}
      onNew={onStart}
      onContinue={onStart}
      onMultiplayer={onMultiplayer}
      onQuit={() => console.log("Quit clicked")}
      profileName={displayName}
      profileLevel={level}
      profileExp={exp}
      profileExpToNext={expToNext}
      version="v0.1.0"
      onProfile={onProfile}
    />
  );
}
