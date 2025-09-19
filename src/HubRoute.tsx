import { useEffect, useState } from "react";
import RogueWheelHub from "../ui/RogueWheelHub";
import { expRequiredForLevel } from "./player/leveling";
import type { Profile } from "./player/profileStore";

type Props = {
  onStart: () => void;
  onMultiplayer: () => void;
  onProfile: () => void;
};

type ProfilePreview = Pick<Profile, "displayName" | "level" | "exp">;

export default function HubRoute({ onStart, onMultiplayer, onProfile }: Props) {
  const [profile, setProfile] = useState<ProfilePreview | null>(null);

  useEffect(() => {
    let cancelled = false;

    import("./player/profileStore")
      .then(({ getProfileBundle }) => {
        if (cancelled) return;
        const { profile } = getProfileBundle();
        if (!profile) {
          setProfile(null);
          return;
        }
        setProfile({
          displayName: profile.displayName,
          level: profile.level,
          exp: profile.exp,
        });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to load profile store", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const warmBundles = async () => {
      try {
        await Promise.all([
          import("./game/modes/classic/ClassicMatch"),
          import("./game/modes/gauntlet/GauntletMatch"),
        ]);
      } catch (error) {
        console.error("Failed to preload game modes", error);
      }
    };

    void warmBundles();
  }, []);

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
