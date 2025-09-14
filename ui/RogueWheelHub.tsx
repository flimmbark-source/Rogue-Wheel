import React, { useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { RefreshCw, Swords, Settings as SettingsIcon, Power, BookOpen } from "lucide-react";

/**
 * Rogue Wheel — Cinematic Hub (Fantasy Skin)
 * Clean merge of typed API + latest logic & your requested UX changes.
 */

export type HubShellProps = {
  backgroundUrl?: string;
  logoText?: string;
  hasSave?: boolean;
  onContinue?: () => void;
  onNew?: () => void;
  onHowTo?: () => void;
  onSettings?: () => void;
  onQuit?: () => void;
  version?: string;
  profileName?: string;
};

export interface MenuItem {
  key: string;
  label: string;
  onClick: (() => void) | undefined;
  icon: ReactNode;
}

export default function RogueWheelHub(props: HubShellProps) {
  const {
    backgroundUrl = "/fantasy-hero.jpg",
    logoText = "Rogue Wheel",
    hasSave = false,
    onContinue,
    onNew,
    onHowTo,
    onSettings,
    onQuit,
    version = "v0.1.0",
    profileName = "Adventurer",
  } = props;

  // ---- Safe fallbacks so buttons still work if handlers aren't wired ----
  const safeOnNew = onNew ?? (() => {
    try { window.dispatchEvent(new CustomEvent("rw:new-run")); } catch {}
    console.warn("RogueWheelHub: onNew not provided. Dispatched `rw:new-run`.");
  });
  const safeOnContinue = onContinue ?? (() => {
    try { window.dispatchEvent(new CustomEvent("rw:continue")); } catch {}
    console.warn("RogueWheelHub: onContinue not provided. Dispatched `rw:continue`.");
  });

  const [selected, setSelected] = useState(0);
  const [showHowTo, setShowHowTo] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  function handleOpenHowTo() {
    onHowTo?.();
    setShowHowTo(true);
  }
  function handleOpenOptions() {
    onSettings?.();
    setShowOptions(true);
  }

  // Menu model (no Daily Challenge, no Draft Practice, no Credits)
  const items = useMemo<MenuItem[]>(
    () => [
      hasSave
        ? { key: "continue", label: "Continue", onClick: safeOnContinue, icon: <RefreshCw className="h-4 w-4" /> }
        : null,
      { key: "new", label: hasSave ? "New Run" : "Play", onClick: safeOnNew, icon: <Swords className="h-4 w-4" /> },
      { key: "howto", label: "How to Play", onClick: handleOpenHowTo, icon: <BookOpen className="h-4 w-4" /> },
      { key: "settings", label: "Options", onClick: handleOpenOptions, icon: <SettingsIcon className="h-4 w-4" /> },
      { key: "quit", label: "Quit", onClick: onQuit, icon: <Power className="h-4 w-4" /> },
    ].filter(Boolean) as MenuItem[],
    [hasSave, safeOnContinue, safeOnNew, onQuit]
  );

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelected((i) => wrapIndex(i + 1, items.length)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSelected((i) => wrapIndex(i - 1, items.length)); }
      else if (e.key === "Enter") { e.preventDefault(); items[selected]?.onClick?.(); }
      else if (e.key === "Escape") { setShowHowTo(false); setShowOptions(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected]);

  // Parallax background
  const parallaxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = parallaxRef.current; if (!el) return;
    const onMove = (e: MouseEvent) => {
      const { innerWidth: w, innerHeight: h } = window;
      const x = (e.clientX / w - 0.5) * 2; // -1..1
      const y = (e.clientY / h - 0.5) * 2;
      el.style.transform = `translate3d(${x * 6}px, ${y * 6}px, 0)`;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden text-white">
      {/* Background */}
      <div className="absolute inset-0 -z-10">
        <div
          ref={parallaxRef}
          className="absolute inset-0 will-change-transform"
          style={{ backgroundImage: `url('${backgroundUrl}')`, backgroundSize: "cover", backgroundPosition: "center" }}
        />
        <div className="absolute inset-0 bg-purple-900/40 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-b from-purple-950/70 via-indigo-950/25 to-indigo-950/80" />
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_180px_60px_rgba(10,8,25,0.9)]" />
      </div>

      {/* Title + tagline + profile (profile right-aligned under title) */}
      <div className="px-6 pt-10 md:px-10 max-w-xl">
        <h1 className="text-4xl font-extrabold tracking-wider drop-shadow-[0_4px_0_rgba(0,0,0,0.55)] md:text-6xl">
          {logoText}
        </h1>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-purple-100/90 md:text-lg"><b>Spin</b>, <b>draft</b>, triumph.</p>
          <div className="rounded bg-black/35 px-3 py-1.5 text-sm ring-1 ring-amber-300/25">
            Profile: {profileName}
          </div>
        </div>
      </div>

      {/* Vertical Menu */}
      <nav aria-label="Main menu" className="mt-6 px-6 md:mt-10 md:px-10">
        <ul className="max-w-md">
          {items.map((it, i) => (
            <li key={it.key} className="mb-3">
              <button
                role="button"
                aria-disabled={!it.onClick}
                disabled={!it.onClick}
                onMouseEnter={() => setSelected(i)}
                onClick={() => it.onClick && it.onClick()}
                className={[
                  "relative flex w-full items-center justify-between rounded-xl px-5 py-3",
                  "text-left font-semibold tracking-wide outline-none",
                  !it.onClick
                    ? "cursor-not-allowed opacity-60 bg-gradient-to-r from-black/40 to-black/20 ring-1 ring-amber-300/20"
                    : i === selected
                      ? "cursor-pointer bg-gradient-to-r from-amber-300 to-amber-500 text-indigo-950 shadow-[0_6px_18px_rgba(255,191,71,0.35)] ring-2 ring-amber-300"
                      : "cursor-pointer bg-gradient-to-r from-black/40 to-black/20 ring-1 ring-amber-300/25 hover:from-black/30 hover:to-black/10",
                ].join(" ")}
              >
                <span className="flex items-center gap-3 opacity-95">
                  <span className="-ml-1 mr-1 text-amber-300">{i === selected ? "❯" : "•"}</span>
                  {it.icon}{it.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <footer className="pointer-events-none absolute bottom-0 left-0 right-0 flex flex-wrap items-end justify-end gap-2 px-6 pb-4 text-sm opacity-85 md:px-10">
        <div className="pointer-events-auto rounded bg-black/35 px-3 py-1.5 ring-1 ring-amber-300/25">{version}</div>
      </footer>

      {/* Panels */}
      {showHowTo && (
        <Overlay title="How to Play" onClose={() => setShowHowTo(false)}>
          <HowToContent />
        </Overlay>
      )}
      {showOptions && (
        <Overlay title="Options" onClose={() => setShowOptions(false)}>
          <OptionsContent />
        </Overlay>
      )}
    </div>
  );
}

// ----- Overlay & Panel Content -----
function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal className="fixed inset-0 z-40 grid place-items-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-[92vw] max-w-2xl rounded-2xl bg-indigo-950/90 p-4 ring-1 ring-amber-300/25 backdrop-blur md:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-wide">{title}</h2>
          <button
            onClick={onClose}
            className="rounded bg-white/10 px-3 py-1 text-sm hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            Close
          </button>
        </div>
        <div className="max-h=[70vh] overflow-auto pr-1 text-sm leading-6 text-white/90">{children}</div>
      </div>
    </div>
  );
}

function HowToContent() {
  return (
    <div className="space-y-4">
      <p><b>Goal:</b> Win rounds by earning victories on the three wheels.</p>
      <ol className="list-decimal pl-5 space-y-2">
        <li><b>Draft:</b> Each round everyone draws <b>5 cards</b>.</li>
        <li><b>Commit:</b> Place <b>3</b> cards — <b>1</b> beside each wheel. The remaining <b>2</b> go to your <b>Reserve</b>.</li>
        <li><b>Spin:</b> Each wheel’s token moves equal to the <b>sum of the two cards beside it</b> (you + enemy).</li>
        <li><b>Resolve:</b> The landing section decides the winner:
          <ul className="mt-1 list-disc pl-5">
            <li><b>Largest Number</b> — higher committed number wins.</li>
            <li><b>Biggest Reserve</b> — higher total of reserve cards wins.</li>
            <li><b>Smallest Card</b> — lower committed number wins.</li>
            <li><b>Initiative</b> — initiative holder wins ties here.</li>
          </ul>
        </li>
        <li><b>Advance:</b> Winners are counted; start a new round.</li>
      </ol>

      <div className="grid gap-3 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
        <div className="font-semibold">Tips</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Spread your strength — playing your highest cards isn’t always best.</li>
          <li>Use your Reserve to build an advantage for <i>Biggest Reserve</i>.</li>
          <li>Track <b>initiative</b>; it can flip outcomes on tie-heavy sections.</li>
        </ul>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
          <div className="font-semibold">Controls</div>
          <ul className="mt-1 list-disc pl-5">
            <li>Menu: ↑/↓ to select, Enter to confirm, Esc to close panels</li>
            <li>Mouse/touch: Tap a card, then tap a wheel slot to place it.</li>
          </ul>
        </div>
        <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
          <div className="font-semibold">Win Target</div>
          <p>First to win the majority of rounds.</p>
        </div>
      </div>
    </div>
  );
}

function OptionsContent() {
  const [music, setMusic] = useState(0.6);
  const [sfx, setSfx] = useState(0.8);
  const [screenShake, setScreenShake] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [colorblind, setColorblind] = useState("off");

  return (
    <form
      className="grid gap-4"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        console.log("apply", { music, sfx, screenShake, reducedMotion, colorblind });
      }}
    >
      <Field label="Music Volume">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={music}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMusic(parseFloat(e.target.value))}
          className="w-full"
        />
      </Field>
      <Field label="SFX Volume">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={sfx}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSfx(parseFloat(e.target.value))}
          className="w-full"
        />
      </Field>
      <Toggle label="Screen Shake" value={screenShake} onChange={setScreenShake} />
      <Toggle label="Reduce Motion" value={reducedMotion} onChange={setReducedMotion} />
      <Field label="Colorblind Mode">
        <select
          value={colorblind}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setColorblind(e.target.value)}
          className="w-full rounded bg-black/40 p-2 ring-1 ring-white/15"
        >
          <option value="off">Off</option>
          <option value="protanopia">Protanopia</option>
          <option value="deuteranopia">Deuteranopia</option>
          <option value="tritanopia">Tritanopia</option>
        </select>
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="rounded-xl bg-white/10 px-3 py-1.5 ring-1 ring-white/15 hover:bg-white/15">
          Cancel
        </button>
        <button type="submit" className="rounded-xl bg-amber-400 px-3 py-1.5 font-semibold text-indigo-950 ring-1 ring-amber-300 hover:brightness-95">
          Apply
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-sm text-white/80">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (val: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-white/80">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={["relative h-6 w-11 rounded-full transition", value ? "bg-amber-400" : "bg-white/20"].join(" ")}
      >
        <span className={["absolute top-0.5 h-5 w-5 rounded-full bg-white transition", value ? "left-5" : "left-0.5"].join(" ")} />
      </button>
    </label>
  );
}

// Helpers
export function wrapIndex(n: number, len: number): number {
  if (len <= 0) return 0;
  return ((n % len) + len) % len;
}

// Tiny runtime asserts (console)
(function __runtime_tests__() {
  try {
    console.assert(wrapIndex(0, 5) === 0, "wrapIndex base");
    console.assert(wrapIndex(5, 5) === 0, "wrapIndex wraps forward");
    console.assert(wrapIndex(-1, 5) === 4, "wrapIndex wraps backward");
  } catch (e) {
    console.warn("Runtime tests failed:", e);
  }
})();
