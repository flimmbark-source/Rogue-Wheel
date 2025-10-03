import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  getProfileBundle,
  expRequiredForLevel,
  type ProfileBundle,
  updateProfileDisplayName,
  getOnboardingState,
  type OnboardingState,
  setTutorialEnabled,
  setGrimoireSymbols,
} from "./player/profileStore";
import LoadingScreen from "./components/LoadingScreen";
import { ARCANA_EMOJI } from "./game/arcana";
import { GRIMOIRE_SYMBOL_ORDER, MAX_GRIMOIRE_SYMBOLS, symbolsTotal, GRIMOIRE_SPELL_REQUIREMENTS } from "./game/grimoire";
import type { Arcana } from "./game/types";
import { getSpellDefinitions } from "./game/spells";

export default function ProfilePage() {
  // Initialize immediately so we can render without waiting for an effect
  const [bundle, setBundle] = useState<ProfileBundle | null>(() => {
    try { return getProfileBundle(); } catch { return null; }
  });
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState<string>(() =>
    bundle?.profile.displayName ?? "Local Player"
  );
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const isTutorialDisabled = useCallback(
    (state: OnboardingState) =>
      state.stage >= 3 && state.dismissed.includes("firstRunCoach"),
    [],
  );
  const [tutorialEnabled, setTutorialEnabledState] = useState<boolean>(() => {
    try {
      const onboarding = getOnboardingState();
      return !(
        onboarding.stage >= 3 && onboarding.dismissed.includes("firstRunCoach")
      );
    } catch {
      return true;
    }
  });

  // Refresh once on mount (covers first-run seed or any changes)
  useEffect(() => {
    try {
      const b = getProfileBundle();
      setBundle(b);
      const onboarding = getOnboardingState();
      setTutorialEnabledState(!isTutorialDisabled(onboarding));
    } catch (e) {
      console.error("getProfileBundle failed:", e);
    }
  }, [isTutorialDisabled]);

  useEffect(() => {
    setNameInput(bundle?.profile.displayName ?? "Local Player");
  }, [bundle?.profile.displayName]);

  useEffect(() => {
    if (isEditingName) {
      const id = requestAnimationFrame(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [isEditingName]);

  const commitNameChange = useCallback(() => {
    const raw = nameInput;
    try {
      const updatedProfile = updateProfileDisplayName(raw);
      if (updatedProfile) {
        const refreshed = getProfileBundle();
        setBundle(refreshed);
        setNameInput(refreshed.profile.displayName);
      }
    } catch (error) {
      console.error("updateProfileDisplayName failed:", error);
    }
    setIsEditingName(false);
  }, [nameInput]);

  const cancelNameEdit = useCallback(() => {
    setNameInput(bundle?.profile.displayName ?? "Local Player");
    setIsEditingName(false);
  }, [bundle?.profile.displayName]);

  const handleTutorialChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const enabled = event.target.value === "enabled";
      try {
        const updated = setTutorialEnabled(enabled);
        setTutorialEnabledState(!isTutorialDisabled(updated));
      } catch (error) {
        console.error("setTutorialEnabled failed:", error);
        setTutorialEnabledState(enabled);
      }
    },
    [isTutorialDisabled],
  );

  if (!bundle) {
    return (
      <LoadingScreen>
        <div>Loading profile…</div>
        <button
          className="inline-flex items-center justify-center rounded bg-white/10 px-3 py-1 text-xs font-medium text-white/80 ring-1 ring-white/20 transition hover:bg-white/15 hover:text-white"
          onClick={() => {
            try {
              localStorage.removeItem("rw:single:state");
            } catch {}
            location.reload();
          }}
        >
          Reset profile
        </button>
      </LoadingScreen>
    );
  }

  const { profile } = bundle;

  const grimoireSymbols = bundle.grimoire.symbols;
  const grimoireTotal = symbolsTotal(grimoireSymbols);
  const remainingSlots = Math.max(0, MAX_GRIMOIRE_SYMBOLS - grimoireTotal);
  const grimoireSpells = useMemo(
    () => getSpellDefinitions(bundle.grimoire.spellIds),
    [bundle.grimoire.spellIds],
  );

  const handleSymbolAdjust = useCallback(
    (arcana: Arcana, delta: number) => {
      const current = bundle.grimoire.symbols;
      if (delta > 0 && grimoireTotal >= MAX_GRIMOIRE_SYMBOLS) return;
      if (delta < 0 && (current[arcana] ?? 0) <= 0) return;
      const next = { ...current, [arcana]: Math.max(0, (current[arcana] ?? 0) + delta) };
      const updated = setGrimoireSymbols(next);
      setBundle((prev) => (prev ? { ...prev, grimoire: updated } : prev));
    },
    [bundle, grimoireTotal],
  );

  const expToNext = expRequiredForLevel(profile.level);
  const expPercent = expToNext > 0 ? Math.min(1, profile.exp / expToNext) : 0;

  return (
    <div className="p-4">
      <section className="rounded-xl p-3 border border-white/20 bg-black/25 max-w-2xl mx-auto">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Profile</h2>
          <div className="text-right">
            {isEditingName ? (
              <input
                ref={nameInputRef}
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                onBlur={commitNameChange}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitNameChange();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelNameEdit();
                  }
                }}
                maxLength={24}
                className="w-40 rounded border border-emerald-400 bg-slate-900/60 px-2 py-1 text-sm text-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
              />
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingName(true)}
                className="w-full min-w-[9rem] rounded border border-transparent px-3 py-1 text-sm text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 focus:border-emerald-300 focus:outline-none"
              >
                <div className="truncate font-semibold">{profile?.displayName ?? "Local Player"}</div>
                <div className="text-xs font-normal text-emerald-200/70">Tap to edit</div>
              </button>
            )}
          </div>
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
        <div className="mt-3 flex flex-col gap-2 rounded-lg bg-white/5 p-3 ring-1 ring-white/10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium text-white">Tutorial</div>
            <div className="text-xs text-white/60">
              Choose whether to see the guided tutorial in future runs.
            </div>
          </div>
          <select
            className="w-full rounded border border-white/20 bg-slate-900/60 px-2 py-1 text-sm text-white shadow-inner transition focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 sm:w-40"
            value={tutorialEnabled ? "enabled" : "disabled"}
            onChange={handleTutorialChange}
          >
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>

        <div className="mt-4 rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-white">Grimoire mode</div>
              <div className="text-xs text-white/60">
                Adjust the symbols in your deck to learn spells. Your grimoire refreshes at the start of each round based on your hand.
              </div>
            </div>
            <div className="text-xs font-semibold text-emerald-200/80">
              {remainingSlots} symbol{remainingSlots === 1 ? "" : "s"} available
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-5">
            {GRIMOIRE_SYMBOL_ORDER.map((arcana) => {
              const count = grimoireSymbols[arcana] ?? 0;
              const canDecrease = count > 0;
              const canIncrease = remainingSlots > 0;
              return (
                <div key={arcana} className="rounded-xl border border-white/10 bg-slate-900/70 p-3 shadow-inner">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl" aria-hidden>{ARCANA_EMOJI[arcana]}</span>
                    <span className="text-sm font-semibold text-white">×{count}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleSymbolAdjust(arcana, -1)}
                      disabled={!canDecrease}
                      className="flex-1 rounded-lg border border-white/20 px-2 py-1 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSymbolAdjust(arcana, 1)}
                      disabled={!canIncrease}
                      className="flex-1 rounded-lg border border-emerald-300/60 bg-emerald-400/20 px-2 py-1 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4">
            <div className="text-sm font-medium text-white">Spells</div>
            <div className="text-xs text-white/60">
              Spells are available when your hand contains the required symbols. Descriptions are shown below.
            </div>
            {grimoireSpells.length === 0 ? (
              <div className="mt-2 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white/60">
                No spells unlocked. Increase your symbols to learn new spells.
              </div>
            ) : (
              <ul className="mt-2 space-y-2">
                {grimoireSpells.map((spell) => {
                  const requirement = GRIMOIRE_SPELL_REQUIREMENTS[spell.id as keyof typeof GRIMOIRE_SPELL_REQUIREMENTS];
                  const requirementEntries = requirement
                    ? GRIMOIRE_SYMBOL_ORDER.filter((arcana) => (requirement?.[arcana] ?? 0) > 0).map((arcana) => [arcana, requirement?.[arcana] ?? 0] as [Arcana, number])
                    : [];
                  return (
                    <li key={spell.id} className="rounded-xl border border-white/10 bg-slate-900/80 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-center gap-2 text-sm font-semibold text-white">
                          {spell.icon ? <span aria-hidden>{spell.icon}</span> : null}
                          <span>{spell.name}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1 text-xs text-amber-200/90">
                          {requirementEntries.length === 0 ? (
                            <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/70">No requirement</span>
                          ) : (
                            requirementEntries.map(([arc, amount]) => (
                              <span
                                key={arc}
                                className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5"
                              >
                                <span aria-hidden>{ARCANA_EMOJI[arc]}</span>
                                <span>×{amount}</span>
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                      <div className="mt-2 text-xs leading-relaxed text-white/70">{spell.description}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
