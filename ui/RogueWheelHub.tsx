import React, { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Swords, Settings as SettingsIcon, Power, BookOpen } from "lucide-react";

/**
 * Rogue Wheel — Cinematic Hub (Fantasy Skin)
 * Fully self-contained, fixed JSX, and with simple runtime tests.
 *
 * Features
 * - Vertical game-like menu with keyboard/gamepad-style nav (↑/↓, Enter, Esc)
 * - Fantasy palette (amethyst/indigo + gold accents)
 * - Background parallax + vignette for readability
 * - In-menu panels: How to Play & Options (overlay dialogs)
 * - Profile chip sits on the same row as the tagline, under the title
 */

export default function HubShell(props) {
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
  } = props || {};

  // Menu model (pure function so we can test it)
  const items = useMemo(
    () => buildMenuItems({ hasSave, onContinue, onNew, onHowTo: handleOpenHowTo, onSettings: handleOpenOptions, onQuit }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasSave, onContinue, onNew, onQuit]
  );

  const [selected, setSelected] = useState(0);
  const [showHowTo, setShowHowTo] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  function handleOpenHowTo() {
    if (typeof onHowTo === "function") onHowTo();
    setShowHowTo(true);
  }
  function handleOpenOptions() {
    if (typeof onSettings === "function") onSettings();
    setShowOptions(true);
  }

  // Keyboard navigation (gamey)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelected((i) => wrapIndex(i + 1, items.length)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSelected((i) => wrapIndex(i - 1, items.length)); }
      else if (e.key === "Enter") { e.preventDefault(); items[selected]?.onClick?.(); }
      else if (e.key === "Escape") { setShowHowTo(false); setShowOptions(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected]);

  // Parallax background
  const parallaxRef = useRef(null);
  useEffect(() => {
    const el = parallaxRef.current; if (!el) return;
    const onMove = (e) => {
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

      {/* Title + tagline + profile */}
      <div className="px-6 pt-10 md:px-10 max-w-xl">
        <h1 className="text-4xl font-extrabold tracking-wider drop-shadow-[0_4px_0_rgba(0,0,0,0.55)] md:text-6xl">{logoText}</h1>
        <div className="mt-2 flex items-center justify-start gap-4">
          <p className="text-purple-100/90 md:text-lg"><b>Spin</b>, <b>draft</b>, triumph.</p>
          <div className="rounded bg-black/35 px-3 py-1.5 text-sm ring-1 ring-amber-300/25">Profile: Adventurer</div>
        </div>
      </div>

      {/* Vertical Menu */}
      <nav aria-label="Main menu" className="mt-6 px-6 md:mt-10 md:px-10">
        <ul className="max-w-md">
          {items.map((it, i) => (
            <li key={it.key} className="mb-3">
              <button
                onMouseEnter={() => setSelected(i)}
                onClick={it.onClick}
                className={[
                  "relative flex w-full items-center justify-between rounded-xl px-5 py-3",
                  "text-left font-semibold tracking-wide transition outline-none",
                  i === selected
                    ? "bg-gradient-to-r from-amber-300 to-amber-500 text-indigo-950 shadow-[0_6px_18px_rgba(255,191,71,0.35)] ring-2 ring-amber-300"
                    : "bg-gradient-to-r from-black/40 to-black/20 ring-1 ring-amber-300/25 hover:from-black/30 hover:to-black/10",
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
function Overlay({ title, onClose, children }) {
  return (
    <div role="dialog" aria-modal className="fixed inset-0 z-40 grid place-items-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-[92vw] max-w-2xl rounded-2xl bg-indigo-950/90 p-4 ring-1 ring-amber-300/25 backdrop-blur md:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-wide">{title}</h2>
          <button onClick={onClose} className="rounded bg-white/10 px-3 py-1 text-sm hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-amber-300">Close</button>
        </div>
        <div className="max-h-[70vh] overflow-auto pr-1 text-sm leading-6 text-white/90">{children}</div>
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
        <li><b>Commit:</b> Select and place down <b>3</b> of your cards, <b>1</b> beside each wheel. The remaining <b>2</b> go to your <b>Reserve</b>.</li>
        <li><b>Spin:</b> The token on each wheel moves equal to the <b>sum of the cards placed beside it</b>.</li>
        <li><b>Resolve:</b> The landing section of each wheel determines the winner for that wheel:
          <ul className="mt-1 list-disc pl-5">
            <li><b>Largest Number</b> – higher committed number wins.</li>
            <li><b>Biggest Reserve</b> – higher total of reserve cards wins.</li>
            <li><b>Smallest Card</b> – lower committed number wins.</li>
            <li><b>Initiative</b> – initiative holder wins ties here.</li>
          </ul>
        </li>
        <li><b>Advance:</b> Winners are counted, then a new round begins.</li>
      </ol>

      <div className="grid gap-3 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
        <div className="font-semibold">Tips</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Spread your strength: Playing your strongest cards isnt always the right choice.</li>
          <li>Use your Reserve to build advantage for <i>Biggest Reserve</i>.</li>
          <li>Track <b>initiative</b>: It breaks ties on sections.</li>
        </ul>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
          <div className="font-semibold">Controls</div>
          <ul className="mt-1 list-disc pl-5">
            <li>Menu: ↑/↓ to select, Enter to confirm, Esc to close panels</li>
            <li>Mouse/touch: Tap and hold to select a card, then tap on a space to place it.</li>
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
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); console.log("apply", { music, sfx, screenShake, reducedMotion, colorblind }); }}>
      <Field label="Music Volume">
        <input type="range" min={0} max={1} step={0.01} value={music} onChange={(e) => setMusic(parseFloat(e.target.value))} className="w-full" />
      </Field>
      <Field label="SFX Volume">
        <input type="range" min={0} max={1} step={0.01} value={sfx} onChange={(e) => setSfx(parseFloat(e.target.value))} className="w-full" />
      </Field>
      <Toggle label="Screen Shake" value={screenShake} onChange={setScreenShake} />
      <Toggle label="Reduce Motion" value={reducedMotion} onChange={setReducedMotion} />
      <Field label="Colorblind Mode">
        <select value={colorblind} onChange={(e) => setColorblind(e.target.value)} className="w-full rounded bg-black/40 p-2 ring-1 ring-white/15">
          <option value="off">Off</option>
          <option value="protanopia">Protanopia</option>
          <option value="deuteranopia">Deuteranopia</option>
          <option value="tritanopia">Tritanopia</option>
        </select>
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="rounded-xl bg-white/10 px-3 py-1.5 ring-1 ring-white/15 hover:bg-white/15">Cancel</button>
        <button type="submit" className="rounded-xl bg-amber-400 px-3 py-1.5 font-semibold text-indigo-950 ring-1 ring-amber-300 hover:brightness-95">Apply</button>
      </div>
    </form>
  );
}

function Field({ label, children }) {
  return (
    <label className="grid gap-1">
      <span className="text-sm text-white/80">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, value, onChange }) {
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

// ----- Pure helpers (for sanity tests) -----
function buildMenuItems({ hasSave, onContinue, onNew, onHowTo, onSettings, onQuit }) {
  return [
    hasSave ? { key: "continue", label: "Continue", onClick: () => onContinue && onContinue(), icon: <RefreshCw className="h-4 w-4" /> } : null,
    { key: "new", label: hasSave ? "New Run" : "Play", onClick: () => onNew && onNew(), icon: <Swords className="h-4 w-4" /> },
    { key: "howto", label: "How to Play", onClick: () => onHowTo && onHowTo(), icon: <BookOpen className="h-4 w-4" /> },
    { key: "settings", label: "Options", onClick: () => onSettings && onSettings(), icon: <SettingsIcon className="h-4 w-4" /> },
    { key: "quit", label: "Quit", onClick: () => onQuit && onQuit(), icon: <Power className="h-4 w-4" /> },
  ].filter(Boolean);
}

function wrapIndex(n, len) {
  if (len <= 0) return 0;
  return (n % len + len) % len;
}

// ----- Runtime tests (console) -----
(function __runtime_tests__() {
  try {
    // Test wrapIndex
    console.assert(wrapIndex(0, 5) === 0, "wrapIndex base");
    console.assert(wrapIndex(5, 5) === 0, "wrapIndex wraps forward");
    console.assert(wrapIndex(-1, 5) === 4, "wrapIndex wraps backward");

    // Test buildMenuItems labels when hasSave toggles
    const itemsNoSave = buildMenuItems({ hasSave: false });
    console.assert(itemsNoSave[0].label === "Play", "First item should be Play when no save");

    const itemsWithSave = buildMenuItems({ hasSave: true });
    console.assert(itemsWithSave[0].label === "Continue", "First item should be Continue when save exists");

    // Additional sanity: menu contains How to Play and Options
    const labels = itemsNoSave.map((i) => i.label);
    console.assert(labels.includes("How to Play"), "Menu includes How to Play");
    console.assert(labels.includes("Options"), "Menu includes Options");
  } catch (e) {
    console.warn("Runtime tests failed:", e);
  }
})();
