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
  type ProfileBundle,
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
  baseWidth = 160,          // assumed natural width of StSCard "md"
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

  const { profile, inventory, decks, active } = bundle;

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
    </div>
  );
}
