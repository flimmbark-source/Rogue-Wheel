import { useEffect, useMemo, useRef, useState } from "react";
import StSCard from "./components/StSCard";
import {
  getProfileBundle,
  createDeck,
  setActiveDeck,
  renameDeck,
  deleteDeck,
  swapDeckCards,
  unlockSorcererPerk,
  expRequiredForLevel,
  claimChallengeReward,
  type ProfileBundle,
  type Challenge,
  type ChallengeReward,
  type CoopObjective,
  type LeaderboardEntry,
  type UnlockState,
  type CurrencyId,
} from "./player/profileStore";

import type { Card, SorcererPerk } from "./game/types";
import { SORCERER_PERKS } from "./game/types";

/** Map a string cardId → a preview Card shape for StSCard. */
function cardFromId(cardId: string, _opts?: { preview?: boolean }): Card {
  // Support a few simple id formats: basic_#, neg_#, num_#
  const mBasic = /^basic_(\d+)$/.exec(cardId);
  const mNeg   = /^neg_(-?\d+)$/.exec(cardId);
  const mNum   = /^num_(-?\d+)$/.exec(cardId);

  const value =
    mBasic ? Number(mBasic[1])
  : mNeg   ? Number(mNeg[1])
  : mNum   ? Number(mNum[1])
  : 0;

  const name =
    mBasic ? `Basic ${value}`
  : mNeg   ? `Negative ${value}`
  : mNum   ? `Number ${value}`
  : "Card";

  // Minimal Card shape that StSCard can render
  return {
    id: `preview_${cardId}`,
    name,
    number: value,
    kind: "normal",
    tags: [],
  } as Card;
}

/** Currency labels + helpers for challenges/objectives UI. */
const CURRENCY_LABELS: Record<CurrencyId, string> = {
  gold: "Gold",
  sigils: "Sigils",
};

function rewardSummary(reward: ChallengeReward): string {
  switch (reward.type) {
    case "currency":
      return `${reward.amount} ${CURRENCY_LABELS[reward.currency]}`;
    case "inventory":
      return reward.items.map((item) => `${item.qty}× ${item.cardId}`).join(", ");
    case "cosmetic":
      return reward.name ?? reward.cosmeticId;
    default:
      return "Reward";
  }
}

function challengeProgress(challenge: Challenge): number {
  if (challenge.target <= 0) return 0;
  return Math.min(1, challenge.progress / challenge.target);
}

function challengeExpiresLabel(expiresAt: number): string {
  const now = Date.now();
  const diff = Math.max(0, expiresAt - now);
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours < 1) {
    const minutes = Math.max(1, Math.floor(diff / (60 * 1000)));
    return `${minutes}m left`;
  }
  if (hours < 24) {
    return `${hours}h left`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d left`;
}

function isChallengeClaimable(challenge: Challenge): boolean {
  return !!challenge.completedAt && !challenge.claimedAt;
}

function formatObjectiveProgress(objective: CoopObjective): number {
  if (objective.target <= 0) return 0;
  return Math.min(1, objective.progress / objective.target);
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

const PERK_INFO: Record<SorcererPerk, { title: string; description: string }> = {
  arcaneOverflow: {
    title: "Arcane Overflow",
    description: "Start each battle with +1 mana.",
  },
  spellEcho: {
    title: "Spell Echo",
    description: "Predictive casts grant +3 reserve instead of +2.",
  },
  planarSwap: {
    title: "Planar Swap",
    description: "VC swaps cost 1 less mana (minimum 1).",
  },
  recallMastery: {
    title: "Recall Mastery",
    description: "Reserve recalls are free and pull up to two cards when possible.",
  },
};

export default function ProfilePage() {
  // Initialize immediately so we can render without waiting for an effect
  const [bundle, setBundle] = useState<ProfileBundle | null>(() => {
    try { return getProfileBundle(); } catch { return null; }
  });
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    try {
      setBundle(getProfileBundle());
    } catch (e) {
      console.error("getProfileBundle failed:", e);
    }
  };

  const handleClaim = (id: string) => {
    try {
      setClaimingId(id);
      const claimed = claimChallengeReward(id);
      if (!claimed) {
        setError("Challenge not ready to claim.");
      } else {
        setError(null);
      }
    } catch (e) {
      console.error("claimChallengeReward failed:", e);
      setError("Failed to claim reward.");
    } finally {
      setClaimingId(null);
      refresh();
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

  const {
    profile,
    inventory,
    decks,
    active,
    challenges,
    sharedStats,
    coopObjectives,
    leaderboard,
  } = bundle;
  const unlockedPerks = profile.sorcererPerks ?? [];

  const expToNext = expRequiredForLevel(profile.level);
  const expPercent = expToNext > 0 ? Math.min(1, profile.exp / expToNext) : 0;

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

  const renderChallenge = (challenge: Challenge) => {
    const percent = Math.round(challengeProgress(challenge) * 100);
    const claimable = isChallengeClaimable(challenge);
    return (
      <div key={challenge.id} className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-white/90">{challenge.title}</div>
            <div className="text-xs text-white/70">{challenge.description}</div>
          </div>
          <div className="text-xs text-white/50">{challengeExpiresLabel(challenge.expiresAt)}</div>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-white/10">
          <div
            className={`h-2 rounded-full ${claimable ? "bg-emerald-400" : "bg-amber-300"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-white/70">
          <span>
            {challenge.progress} / {challenge.target}
          </span>
          <span>Reward: {rewardSummary(challenge.reward)}</span>
        </div>
        <button
          className={`mt-2 w-full rounded-md px-2 py-1 text-sm font-medium transition-colors ${
            claimable
              ? "bg-emerald-500 text-slate-900 hover:bg-emerald-400"
              : challenge.claimedAt
              ? "bg-white/10 text-white/50"
              : "bg-white/10 text-white/60"
          }`}
          disabled={!claimable || claimingId === challenge.id}
          onClick={() => handleClaim(challenge.id)}
        >
          {challenge.claimedAt
            ? "Claimed"
            : claimable
            ? claimingId === challenge.id
              ? "Claiming..."
              : "Claim Reward"
            : "In Progress"}
        </button>
      </div>
    );
  };

  const renderObjective = (objective: CoopObjective) => {
    const percent = Math.round(formatObjectiveProgress(objective) * 100);
    return (
      <div key={objective.id} className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-white/90">{objective.description}</div>
          <div className="text-xs text-white/50">{challengeExpiresLabel(objective.expiresAt)}</div>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-white/10">
          <div className="h-2 rounded-full bg-sky-300" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-white/70">
          <span>
            {objective.progress} / {objective.target}
          </span>
          {objective.reward && <span>Reward: {rewardSummary(objective.reward)}</span>}
        </div>
        {objective.completedAt && (
          <div className="mt-2 text-xs font-semibold text-emerald-300">
            {objective.claimedAt ? "Reward delivered" : "Completed"}
          </div>
        )}
      </div>
    );
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

        {/* Currencies & unlocks */}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {(Object.keys(profile.currencies) as CurrencyId[]).map((currency) => (
            <span
              key={currency}
              className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white/80"
            >
              {CURRENCY_LABELS[currency]}: {profile.currencies[currency]}
            </span>
          ))}
        </div>

        <div className="mt-3 grid gap-3 text-xs">
          <div>
            <div className="font-semibold uppercase tracking-wide text-white/70">Wheel Unlocks</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(profile.unlocks.wheels) as Array<keyof UnlockState["wheels"]>).map((arch) => {
                const unlocked = profile.unlocks.wheels[arch];
                return (
                  <span
                    key={arch}
                    className={`rounded-full px-3 py-1 font-semibold ${
                      unlocked ? "bg-emerald-500/20 text-emerald-200" : "bg-white/10 text-white/50"
                    }`}
                  >
                    {unlocked ? "✓" : "✕"} {arch}
                  </span>
                );
              })}
            </div>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-wide text-white/70">Modes</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(profile.unlocks.modes) as Array<keyof UnlockState["modes"]>).map((mode) => {
                const unlocked = profile.unlocks.modes[mode];
                const label = mode === "coop" ? "Co-op" : "Leaderboard";
                return (
                  <span
                    key={mode}
                    className={`rounded-full px-3 py-1 font-semibold ${
                      unlocked ? "bg-emerald-500/20 text-emerald-200" : "bg-white/10 text-white/50"
                    }`}
                  >
                    {unlocked ? "✓" : "✕"} {label}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sorcerer Perks */}
        <h3 className="text-lg mt-4">Sorcerer Perks</h3>
        <div className="mt-2 space-y-2">
          {SORCERER_PERKS.map((perk) => {
            const info = PERK_INFO[perk as SorcererPerk];
            const unlocked = unlockedPerks.includes(perk as SorcererPerk);
            return (
              <div
                key={perk}
                className="flex items-start justify-between gap-3 rounded-lg border border-white/20 bg-black/30 px-3 py-2"
              >
                <div>
                  <div className="font-semibold text-sm">{info.title}</div>
                  <div className="text-xs opacity-80 max-w-xs">{info.description}</div>
                </div>
                <button
                  onClick={() => {
                    if (unlocked) return;
                    unlockSorcererPerk(perk as SorcererPerk);
                    refresh();
                  }}
                  disabled={unlocked}
                  className={`text-xs px-2 py-1 rounded border transition ${
                    unlocked
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 cursor-default'
                      : 'border-amber-400/60 bg-amber-400/80 text-slate-900 hover:bg-amber-300'
                  }`}
                >
                  {unlocked ? 'Unlocked' : 'Unlock'}
                </button>
              </div>
            );
          })}
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
                    card={cardFromId(cardId, { preview: true })}
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

      {/* RIGHT column: inventory + live systems */}
      <div className="grid gap-4">
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
                        card={cardFromId(i.cardId, { preview: true })}
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

        <section className="rounded-xl p-3 border border-white/20 bg-black/25">
          <div className="flex items-center justify-between">
            <h3 className="text-lg">Challenges</h3>
            <span className="text-xs opacity-70">Daily & weekly goals</span>
          </div>
          {error && <div className="mt-2 text-xs text-rose-300">{error}</div>}
          <div className="mt-3 grid gap-4">
            <div>
              <h4 className="text-sm font-semibold text-white/80">Daily</h4>
              <div className="mt-2 grid gap-2">
                {challenges.daily.length === 0 ? (
                  <div className="text-xs text-white/60">No daily challenges available.</div>
                ) : (
                  challenges.daily.map(renderChallenge)
                )}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white/80">Weekly</h4>
              <div className="mt-2 grid gap-2">
                {challenges.weekly.length === 0 ? (
                  <div className="text-xs text-white/60">No weekly challenges available.</div>
                ) : (
                  challenges.weekly.map(renderChallenge)
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl p-3 border border-white/20 bg-black/25">
          <div className="flex items-center justify-between">
            <h3 className="text-lg">Cooperative Objectives</h3>
            <span className="text-xs opacity-70">Progress persists across sessions</span>
          </div>
          <div className="mt-2 grid gap-2">
            {coopObjectives.length === 0 ? (
              <div className="text-xs text-white/60">No active objectives.</div>
            ) : (
              coopObjectives.map(renderObjective)
            )}
          </div>
        </section>

        <section className="rounded-xl p-3 border border-white/20 bg-black/25">
          <div className="flex items-center justify-between">
            <h3 className="text-lg">Shared Progress</h3>
            <span className="text-xs opacity-70">Multiplayer snapshot</span>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-white/70">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-white/5 p-2">
                <div className="text-sm font-semibold text-white/80">Co-op Wins</div>
                <div className="mt-1 text-lg font-bold text-emerald-300">{sharedStats.coopWins}</div>
              </div>
              <div className="rounded-lg bg-white/5 p-2">
                <div className="text-sm font-semibold text-white/80">Co-op Losses</div>
                <div className="mt-1 text-lg font-bold text-rose-300">{sharedStats.coopLosses}</div>
              </div>
              <div className="rounded-lg bg-white/5 p-2">
                <div className="text-sm font-semibold text-white/80">Objectives Completed</div>
                <div className="mt-1 text-lg font-bold text-amber-200">{sharedStats.objectivesCompleted}</div>
              </div>
              <div className="rounded-lg bg-white/5 p-2">
                <div className="text-sm font-semibold text-white/80">Leaderboard Rating</div>
                <div className="mt-1 text-lg font-bold text-sky-200">{sharedStats.leaderboardRating}</div>
              </div>
            </div>

            <div className="mt-3">
              <h4 className="text-sm font-semibold text-white/80">Leaderboard</h4>
              <div className="mt-2 overflow-hidden rounded-lg ring-1 ring-white/10">
                <table className="min-w-full text-left text-xs text-white/80">
                  <thead className="bg-white/10 text-[11px] uppercase tracking-wide">
                    <tr>
                      <th className="px-2 py-1">Player</th>
                      <th className="px-2 py-1 text-right">Rating</th>
                      <th className="px-2 py-1 text-right">Victories</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.slice(0, 5).map((entry: LeaderboardEntry) => (
                      <tr key={entry.playerId} className="odd:bg-white/5">
                        <td className="px-2 py-1">{entry.name}</td>
                        <td className="px-2 py-1 text-right font-semibold">{entry.rating}</td>
                        <td className="px-2 py-1 text-right">{entry.victories}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
