import { useEffect, useState } from "react";
import {
  getProfileBundle,
  createDeck,
  setActiveDeck,
  renameDeck,
  deleteDeck,
  swapDeckCards,
} from "../../local/decks";
import type { Deck } from "../../types/profile";

type ProfileBundle = ReturnType<typeof getProfileBundle>;

const FALLBACK_BUNDLE: ProfileBundle = {
  profile: { id: "", displayName: "Local Player", mmr: 0, createdAt: Date.now() },
  inventory: [],
  decks: [],
  active: undefined,
};

export default function ProfilePage({ onBack }: { onBack?: () => void }) {
  const [bundle, setBundle] = useState<ProfileBundle>(() => {
    if (typeof window === "undefined") return FALLBACK_BUNDLE;
    return getProfileBundle();
  });

  const refresh = () => {
    if (typeof window === "undefined") return;
    setBundle(getProfileBundle());
  };

  const run = (fn: () => void) => {
    try {
      fn();
      refresh();
    } catch (err) {
      console.error(err);
      if (typeof window !== "undefined" && "alert" in window) {
        window.alert((err as Error).message);
      }
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { profile, inventory, decks, active } = bundle;

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold">{profile.displayName}</h2>
          <p className="text-sm opacity-75">MMR {profile.mmr}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs opacity-60">ID: {profile.id || "local"}</span>
          {onBack && (
            <button className="rounded border border-slate-700 px-3 py-1 text-sm" onClick={onBack}>
              Back to Hub
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-slate-700 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg">Decks</h3>
            <button
              className="rounded border px-2 py-1 text-sm"
              onClick={() =>
                run(() => {
                  createDeck();
                })
              }
            >
              + New
            </button>
          </div>

          <ul className="mt-2 space-y-1">
            {decks.map((d: Deck) => (
              <li
                key={d.id}
                className={`flex items-center justify-between rounded px-2 py-1 ${d.isActive ? "bg-slate-800" : "bg-slate-900"}`}
              >
                <div className="flex items-center gap-2">
                  <button
                    className="text-xs underline"
                    onClick={() =>
                      run(() => {
                        setActiveDeck(d.id);
                      })
                    }
                  >
                    {d.isActive ? "Active" : "Set active"}
                  </button>
                  <input
                    className="border-b border-slate-600 bg-transparent text-sm focus:outline-none"
                    defaultValue={d.name}
                    onBlur={(e) =>
                      run(() => {
                        renameDeck(d.id, e.target.value || "Deck");
                      })
                    }
                  />
                </div>
                <button
                  className="text-xs text-red-400"
                  onClick={() =>
                    run(() => {
                      deleteDeck(d.id);
                    })
                  }
                >
                  delete
                </button>
              </li>
            ))}
          </ul>

          <h3 className="mt-4 text-lg">Active Deck</h3>
          {!active ? (
            <p className="text-sm opacity-80">No deck.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {active.cards.map((c) => (
                <li
                  key={c.cardId}
                  className="flex items-center justify-between rounded border border-slate-700 px-2 py-1"
                >
                  <span>{c.cardId}</span>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded border px-2 py-0.5 text-xs"
                      onClick={() =>
                        run(() => {
                          swapDeckCards(active.id, [{ cardId: c.cardId, qty: 1 }], []);
                        })
                      }
                    >
                      −
                    </button>
                    <span>x{c.qty}</span>
                    <button
                      className="rounded border px-2 py-0.5 text-xs"
                      onClick={() =>
                        run(() => {
                          swapDeckCards(active.id, [], [{ cardId: c.cardId, qty: 1 }]);
                        })
                      }
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-700 p-3">
          <h3 className="text-lg">Inventory</h3>
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {inventory.map((i) => (
              <li
                key={i.cardId}
                className="flex items-center justify-between rounded border border-slate-700 px-2 py-1"
              >
                <span>{i.cardId}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs opacity-80">x{i.qty}</span>
                  {active && (
                    <button
                      className="rounded border px-2 py-0.5 text-xs"
                      onClick={() =>
                        run(() => {
                          swapDeckCards(active.id, [], [{ cardId: i.cardId, qty: 1 }]);
                        })
                      }
                    >
                      Add
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
