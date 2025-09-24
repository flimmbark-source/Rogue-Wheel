import { useEffect, useState } from "react";
import {
  getProfileBundle,
  expRequiredForLevel,
  type ProfileBundle,
} from "./player/profileStore";

export default function ProfilePage() {
  // Initialize immediately so we can render without waiting for an effect
  const [bundle, setBundle] = useState<ProfileBundle | null>(() => {
    try { return getProfileBundle(); } catch { return null; }
  });

  // Refresh once on mount (covers first-run seed or any changes)
  useEffect(() => {
    try {
      const b = getProfileBundle();
      setBundle(b);
    } catch (e) {
      console.error("getProfileBundle failed:", e);
    }
  }, []);

  if (!bundle) {
    return (
      <div className="p-4">
        Loading profile…
        <button
          className="ml-3 underline text-xs"
          onClick={() => { try { localStorage.removeItem("rw:single:state"); } catch {}; location.reload(); }}
        >
          reset
        </button>
      </div>
    );
  }

  const { profile } = bundle;

  const expToNext = expRequiredForLevel(profile.level);
  const expPercent = expToNext > 0 ? Math.min(1, profile.exp / expToNext) : 0;

  return (
    <div className="p-4">
      <section className="rounded-xl p-3 border border-white/20 bg-black/25 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Profile</h2>
          <div className="text-sm opacity-80">{profile?.displayName ?? "Local Player"}</div>
        </div>

        <div className="mt-3 rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
          <div className="flex items-center justify-between text-sm font-medium">
            <span>Level {profile.level}</span>
            <span>
              {profile.exp} / {expToNext} XP
            </span>
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-white/10">
            <div
              className="h-2 rounded-full bg-amber-300 transition-[width] duration-500"
              style={{ width: `${Math.min(100, expPercent * 100)}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-white/60">Current streak: {profile.winStreak}</div>
        </div>
      </section>
    </div>
  );
}
