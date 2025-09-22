import { useEffect, useMemo, useRef, useState } from "react";
import StSCard from "./components/StSCard";
import {
  getProfileBundle,
  createDeck,
  setActiveDeck,
  renameDeck,
  deleteDeck,
  swapDeckCards,
  expRequiredForLevel,
  claimChallengeReward,
  type ProfileBundle,
  type Challenge,
  type ChallengeReward,
} from "./player/profileStore";
import type { Card } from "./game/types";

/** Map our string cardId → runtime Card for StSCard preview. */
function cardFromId(cardId: string): Card {
  const mBasic = /^basic_(\d+)$/.exec(cardId);
  const mNeg = /^neg_(-?\d+)$/.exec(cardId);
  const mNum = /^num_(-?\d+)$/.exec(cardId);
  const num = mBasic ? +mBasic[1] : mNeg ? +mNeg[1] : mNum ? +mNum[1] : 0;
  return { id: `preview_${cardId}`, name: `${num}`, type: "normal", number: num, tags: [] };
}

/** Scales its child to fit the available width while preserving aspect. */
function FitCard({
  baseWidth = 110,          // assumed natural width of StSCard "md"
  children,
}: { baseWidth?: number; children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      // Avoid zero and clamp
      const s = Math.max(0.4, Math.min(2, w / baseWidth));
      setScale(s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [baseWidth]);

  return (
    <div ref={wrapRef} className="relative w-full h-full grid place-items-center overflow-visible">
      <div
        className="origin-center"
        style={{ transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

function rewardLabel(reward: ChallengeReward): string {
  if (reward.type === "currency") return `${reward.amount} ${reward.currency}`;
  if (reward.type === "inventory") {
    return reward.items.map((item) => `${item.qty}× ${item.cardId}`).join(", ");
  }
  return reward.name ?? reward.cosmeticId;
}

const challengePercent = (challenge: Challenge) =>
  challenge.target > 0 ? Math.min(1, challenge.progress / challenge.target) : 0;

export default function ProfilePage() {
  // Initialize immediately so we can render without waiting for an effect
  const [bundle, setBundle] = useState<ProfileBundle | null>(() => {
    try { return getProfileBundle(); } catch { return null; }
  });

  const refresh = () => {
    try {
      setBundle(getProfileBundle());
    } catch (e) {
      console.error("getProfileBundle failed:", e);
    }
  };

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

  const { profile, inventory, decks, active, challenges, sharedStats, coopObjectives, leaderboard } = bundle;

  const expToNext = expRequiredForLevel(profile.level);
  const expPercent = expToNext > 0 ? Math.min(1, profile.exp / expToNext) : 0;

  const currencyEntries = useMemo(
    () => Object.entries(profile.currencies ?? {} as Record<string, number>),
    [profile.currencies]
  );
  const unlockedWheels = useMemo(
    () =>
      Object.entries(profile.unlocks?.wheels ?? {})
        .filter(([, unlocked]) => Boolean(unlocked))
        .map(([id]) => id),
    [profile.unlocks]
  );
  const cosmetics = profile.cosmetics ?? [];

  // Expand active deck into 10 visible slots (duplicates expanded)
  const deckSlots: (string | null)[] = useMemo(() => {
    if (!active) return Array(10).fill(null);
    const list: string[] = [];
    for (const e of active.cards) for (let i = 0; i < e.qty; i++) list.push(e.cardId);
    return [...list, ...Array(Math.max(0, 10 - list.length)).fill(null)].slice(0, 10);
  }, [active]);

  // How many copies of a card currently used in deck?
  const usedInDeck = (cardId: string) => active?.cards.find(c => c.cardId === cardId)?.qty ?? 0;
  // Inventory shows AVAILABLE = owned - usedInDeck
  const invAvailable = (cardId: string) => {
    const owned = inventory.find(i => i.cardId === cardId)?.qty ?? 0;
    return Math.max(0, owned - usedInDeck(cardId));
  };

  // DnD payload helpers
  type DragPayload = { from: "inv" | "deck"; cardId: string };
  const setDrag = (e: React.DragEvent, payload: DragPayload) => {
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };
  const getDrag = (e: React.DragEvent): DragPayload | null => {
    try { return JSON.parse(e.dataTransfer.getData("application/json")); } catch { return null; }
  };

  // Mutations via profileStore
  const addToDeck = async (cardId: string, qty = 1) => {
    if (!active) return;
    if (invAvailable(cardId) <= 0) return;
    try { await swapDeckCards(active.id, [], [{ cardId, qty }]); refresh(); }
    catch (err: any) { alert(err?.message ?? "Could not add to deck"); }
  };
  const removeFromDeck = async (cardId: string, qty = 1) => {
    if (!active) return;
    try { await swapDeckCards(active.id, [{ cardId, qty }], []); refresh(); }
    catch (err: any) { alert(err?.message ?? "Could not remove from deck"); }
  };

  const handleClaim = (id: string) => {
    try {
      const result = claimChallengeReward(id);
      if (!result) return;
      refresh();
    } catch (err: any) {
      alert(err?.message ?? "Unable to claim reward");
    }
  };

  return (
    <div className="p-4 grid gap-4 md:grid-cols-2">
      {/* LEFT: Decks + Active Deck */}
      <section className="rounded-xl p-3 border border-white/20 bg-black/25">
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

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-black/30 p-3 ring-1 ring-white/10">
            <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Currencies</div>
            <ul className="mt-2 space-y-1 text-sm">
              {currencyEntries.length ? (
                currencyEntries.map(([id, amount]) => (
                  <li key={id} className="flex items-center justify-between capitalize">
                    <span>{id}</span>
                    <span>{amount}</span>
                  </li>
                ))
              ) : (
                <li className="text-xs text-white/60">No currency yet.</li>
              )}
            </ul>
          </div>
          <div className="rounded-lg bg-black/30 p-3 ring-1 ring-white/10">
            <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Unlocked Wheels</div>
            <div className="mt-2 flex flex-wrap gap-1 text-xs">
              {unlockedWheels.length ? (
                unlockedWheels.map((id) => (
                  <span key={id} className="px-2 py-1 rounded-full bg-white/10 capitalize">
                    {id}
                  </span>
                ))
              ) : (
                <span className="text-white/60">Bandit</span>
              )}
            </div>
            {cosmetics.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Cosmetics</div>
                <div className="mt-2 flex flex-wrap gap-1 text-xs">
                  {cosmetics.map((id) => (
                    <span key={id} className="px-2 py-1 rounded-full bg-indigo-500/20 text-indigo-100/90">
                      {id}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mt-3">
          <h3 className="text-lg">Decks</h3>
          <button
            onClick={() => { createDeck(); refresh(); }}
            className="text-sm px-2 py-1 rounded border border-white/25 hover:bg-white/10"
          >
            + New
          </button>
        </div>

        <ul className="mt-2 space-y-1">
          {decks.map((d) => (
            <li key={d.id} className={`flex items-center justify-between rounded overflow-hidden ring-1 ring-white/15 ${d.isActive ? "bg-indigo-900/40" : "bg-black/30"}`}>
              <div className="flex items-center gap-2 px-2 py-1">
                <button className="text-xs underline" onClick={() => { setActiveDeck(d.id); refresh(); }}>
                  {d.isActive ? "Active" : "Set active"}
                </button>
                <input
                  className="bg-transparent border-b border-white/25 text-sm outline-none"
                  defaultValue={d.name}
                  onBlur={(e) => { renameDeck(d.id, e.target.value || "Deck"); refresh(); }}
                />
              </div>
              <button className="text-xs text-red-300 px-2 py-1 hover:bg-white/10"
                onClick={() => { deleteDeck(d.id); refresh(); }}>
                delete
              </button>
            </li>
          ))}
        </ul>

        <h3 className="text-lg mt-4">Active Deck</h3>

        {/* Deck grid = drop target (add from inv / remove by dropping back) */}
        <div
          className="mt-2 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 p-2 rounded-xl ring-1 ring-white/15 bg-black/30"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const data = getDrag(e);
            if (!data) return;
            if (data.from === "inv") addToDeck(data.cardId, 1);
            if (data.from === "deck") removeFromDeck(data.cardId, 1);
          }}
        >
          {deckSlots.map((cardId, i) => (
            <div
              key={i}
              className="relative aspect-[3/4] rounded-xl ring-1 ring-white/10 bg-white/5 p-1 grid place-items-center"
            >
              {cardId ? (
                <FitCard>
                  <StSCard
                    card={cardFromId(cardId)}
                    size="md"
                    draggable
                    onDragStart={(e) => setDrag(e, { from: "deck", cardId })}
                    onPick={() => removeFromDeck(cardId, 1)}
                  />
                </FitCard>
              ) : (
                <span className="text-white/30 text-xs">empty</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* RIGHT: Inventory */}
      <section className="rounded-xl p-3 border border-white/20 bg-black/25">
        <div className="flex items-center justify-between">
          <h3 className="text-lg">Inventory</h3>
          <div className="text-xs opacity-70">Drag to deck • Click to add</div>
        </div>

        {/* Inventory grid = drop target for deck cards (to remove) */}
        <div
          className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-3"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const data = getDrag(e);
            if (data?.from === "deck") removeFromDeck(data.cardId, 1);
          }}
        >
          {inventory.map((i) => {
            const avail = invAvailable(i.cardId);
            return (
              <div key={i.cardId} className="relative grid place-items-center">
                <div className="aspect-[3/4] w-full max-w-[180px] p-1 rounded-lg ring-1 ring-white/10 bg-white/5 grid place-items-center">
                  <FitCard>
                    <StSCard
                      card={cardFromId(i.cardId)}
                      size="md"
                      disabled={avail <= 0}
                      draggable
                      onDragStart={(e) => setDrag(e, { from: "inv", cardId: i.cardId })}
                      onPick={() => avail > 0 && addToDeck(i.cardId, 1)}
                    />
                  </FitCard>
                </div>
                <span className="absolute top-1 left-1 text-[11px] px-1.5 py-0.5 rounded bg-black/60 ring-1 ring-white/20">
                  x{avail}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="md:col-span-2 rounded-xl p-3 border border-white/20 bg-black/25">
        <h3 className="text-lg">Challenges</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <h4 className="text-sm font-semibold text-white/80">Daily</h4>
            <div className="mt-2 space-y-3">
              {challenges.daily.length ? (
                challenges.daily.map((challenge) => {
                  const pct = challengePercent(challenge);
                  return (
                    <div key={challenge.id} className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold">{challenge.title}</div>
                          <div className="text-xs text-white/70 mt-1">{challenge.description}</div>
                        </div>
                        <div className="text-xs text-white/60 whitespace-nowrap">
                          {challenge.progress} / {challenge.target}
                        </div>
                      </div>
                      <div className="mt-2 h-2 w-full rounded-full bg-white/10">
                        <div
                          className="h-2 rounded-full bg-emerald-400"
                          style={{ width: `${Math.min(100, pct * 100)}%` }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-white/70">
                        <span>Reward: {rewardLabel(challenge.reward)}</span>
                        <button
                          className={`px-2 py-1 rounded border ${challenge.claimedAt
                            ? "border-white/10 text-white/40"
                            : challenge.completedAt
                            ? "border-emerald-400 text-emerald-200 hover:bg-emerald-500/20"
                            : "border-white/15 text-white/50"}`}
                          onClick={() => handleClaim(challenge.id)}
                          disabled={!challenge.completedAt || !!challenge.claimedAt}
                        >
                          {challenge.claimedAt ? "Claimed" : challenge.completedAt ? "Claim" : "In progress"}
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-white/60">No daily challenges available.</p>
              )}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white/80">Weekly</h4>
            <div className="mt-2 space-y-3">
              {challenges.weekly.length ? (
                challenges.weekly.map((challenge) => {
                  const pct = challengePercent(challenge);
                  return (
                    <div key={challenge.id} className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold">{challenge.title}</div>
                          <div className="text-xs text-white/70 mt-1">{challenge.description}</div>
                        </div>
                        <div className="text-xs text-white/60 whitespace-nowrap">
                          {challenge.progress} / {challenge.target}
                        </div>
                      </div>
                      <div className="mt-2 h-2 w-full rounded-full bg-white/10">
                        <div
                          className="h-2 rounded-full bg-sky-400"
                          style={{ width: `${Math.min(100, pct * 100)}%` }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-white/70">
                        <span>Reward: {rewardLabel(challenge.reward)}</span>
                        <button
                          className={`px-2 py-1 rounded border ${challenge.claimedAt
                            ? "border-white/10 text-white/40"
                            : challenge.completedAt
                            ? "border-sky-400 text-sky-100 hover:bg-sky-500/20"
                            : "border-white/15 text-white/50"}`}
                          onClick={() => handleClaim(challenge.id)}
                          disabled={!challenge.completedAt || !!challenge.claimedAt}
                        >
                          {challenge.claimedAt ? "Claimed" : challenge.completedAt ? "Claim" : "In progress"}
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-white/60">No weekly challenges available.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="md:col-span-2 rounded-xl p-3 border border-white/20 bg-black/25">
        <h3 className="text-lg">Shared Progress</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-4 text-sm">
          <div className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
            <div className="text-xs uppercase text-white/60">Co-op Wins</div>
            <div className="text-lg font-semibold">{sharedStats.coopWins}</div>
          </div>
          <div className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
            <div className="text-xs uppercase text-white/60">Co-op Losses</div>
            <div className="text-lg font-semibold">{sharedStats.coopLosses}</div>
          </div>
          <div className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
            <div className="text-xs uppercase text-white/60">Objectives</div>
            <div className="text-lg font-semibold">{sharedStats.objectivesCompleted}</div>
          </div>
          <div className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
            <div className="text-xs uppercase text-white/60">Rating</div>
            <div className="text-lg font-semibold">{sharedStats.leaderboardRating}</div>
          </div>
        </div>

        <div className="mt-4">
          <h4 className="text-sm font-semibold text-white/80">Cooperative Objectives</h4>
          <div className="mt-2 space-y-2">
            {coopObjectives.length ? (
              coopObjectives.map((objective) => {
                const pct = objective.target > 0 ? Math.min(1, objective.progress / objective.target) : 0;
                return (
                  <div key={objective.id} className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
                    <div className="flex items-center justify-between text-sm">
                      <div className="font-medium text-white/90">{objective.description}</div>
                      <div className="text-xs text-white/60">
                        {objective.progress} / {objective.target}
                      </div>
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-white/10">
                      <div
                        className="h-2 rounded-full bg-fuchsia-400"
                        style={{ width: `${Math.min(100, pct * 100)}%` }}
                      />
                    </div>
                    {objective.reward && (
                      <div className="mt-2 text-xs text-white/70">
                        Reward: {rewardLabel(objective.reward)}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-white/60">No cooperative objectives active.</p>
            )}
          </div>
        </div>
      </section>

      <section className="md:col-span-2 rounded-xl p-3 border border-white/20 bg-black/25">
        <h3 className="text-lg">Leaderboard Snapshot</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs uppercase text-white/50">
              <tr>
                <th className="text-left py-1 pr-4">#</th>
                <th className="text-left py-1 pr-4">Player</th>
                <th className="text-left py-1 pr-4">Rating</th>
                <th className="text-left py-1">Wins</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.slice(0, 5).map((entry, idx) => (
                <tr key={entry.playerId} className="border-t border-white/10">
                  <td className="py-1 pr-4">{idx + 1}</td>
                  <td className="py-1 pr-4">{entry.name}</td>
                  <td className="py-1 pr-4">{entry.rating}</td>
                  <td className="py-1">{entry.victories}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
