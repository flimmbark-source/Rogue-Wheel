import React, { useEffect, useState } from "react";
import RogueWheelHub from "../ui/RogueWheelHub";
import { getProfileBundle } from "./local/decks";

export default function HubRoute({
  onStart,
  onMultiplayer,
  onProfile,
}: {
  onStart: () => void;
  onMultiplayer: () => void;
  onProfile: () => void;
}) {
  const [profileName, setProfileName] = useState("Adventurer");
  const [hasSave, setHasSave] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const bundle = getProfileBundle();
      setProfileName(bundle.profile.displayName);
      setHasSave(bundle.decks.some((deck) => deck.cards.length > 0));
    } catch (err) {
      console.warn("HubRoute: unable to load profile", err);
    }
  }, []);

  return (
    <RogueWheelHub
      hasSave={hasSave}
      onNew={onStart}
      onContinue={onStart}
      onMultiplayer={onMultiplayer}
      onProfile={onProfile}
      onQuit={() => console.log("Quit clicked")}
      profileName={profileName}
      version="v0.1.0"
    />
  );
}

