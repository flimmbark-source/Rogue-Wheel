import React, { useEffect, useMemo, useRef, useState, ReactNode } from "react";

const ICONS = {
  refresh: "↻",
  swords: "⚔️",
  settings: "⚙️",
  power: "⏻",
  book: "📖",
};

// === Tavern/Fantasy skin tokens ===
const THEME = {
  btnStart: "#F5C063",     // parchment/brass highlight
  btnEnd:   "#E8A936",     // deeper amber
  btnEdge:  "#5A3C16",     // wood edge / bevel
  faceTint: "rgba(255,255,255,0.12)",
  textDark: "#1a1020",
  dockBg:   "rgba(17, 12, 24, 0.55)",
  dockRing: "rgba(255, 200, 120, 0.25)",
};

/**
 * Rogue Wheel — Cinematic Hub (Fantasy Skin)
 * - Vertical menu: Continue (if save), Play/New Run, How to Play, Options, Quit
 * - Title with right-aligned Profile pill (clickable if onProfile provided)
 */

export type HubShellProps = {
  backgroundUrl?: string;
  logoText?: string;
  hasSave?: boolean;
  onContinue?: () => void;
  onNew?: () => void;
  onMultiplayer?: () => void;
  onHowTo?: () => void;
  onSettings?: () => void;
  onQuit?: () => void;
  version?: string;
  profileName?: string;
  onProfile?: () => void;
  profileLevel?: number;
  profileExp?: number;
  profileExpToNext?: number;
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
    logoText = "Rotogo Snap",
    hasSave = false,
    onContinue,
    onNew,
    onMultiplayer,
    onHowTo,
    onSettings,
    onQuit,
    version = "v0.1.0",
    profileName = "Adventurer",
    onProfile, // ← NEW
    profileLevel = 1,
    profileExp = 0,
    profileExpToNext = 200,
  } = props;

  const profileProgress = profileExpToNext > 0 ? Math.min(1, profileExp / profileExpToNext) : 0;

  const profileBadge = (
    <div className="flex items-center gap-4">
      <div className="text-left">
        <div className="text-[11px] uppercase tracking-wide text-amber-200/70">Profile</div>
        <div className="text-sm font-semibold text-amber-50">{profileName}</div>
        <div className="mt-1 h-1.5 w-32 rounded-full bg-black/45">
          <div
            className="h-1.5 rounded-full bg-amber-300 transition-[width] duration-500"
            style={{ width: `${Math.min(100, profileProgress * 100)}%` }}
          />
        </div>
        <div className="mt-0.5 text-[11px] text-amber-100/80">
          {profileExp}/{profileExpToNext} XP
        </div>
      </div>
      <div className="text-right">
        <div className="text-[11px] uppercase tracking-wide text-amber-200/70">Level</div>
        <div className="text-2xl font-bold text-amber-200 leading-none">{profileLevel}</div>
      </div>
    </div>
  );

  // Fallbacks so buttons still do something if handlers aren’t wired
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

  const items = useMemo<MenuItem[]>(
    () => [
      hasSave
        ? { key: "continue", label: "Continue", onClick: safeOnContinue, icon: <span className="h-4 w-4 flex items-center justify-center">{ICONS.refresh}</span> }
        : null,
      { key: "new", label: hasSave ? "New Run" : "Singleplayer", onClick: safeOnNew, icon: <span className="h-4 w-4 flex items-center justify-center">{ICONS.swords}</span> },
      { key: "mp", label: "Multiplayer", onClick: onMultiplayer, icon: <span className="h-4 w-4 flex items-center justify-center">🧑‍🤝‍🧑</span> },
      { key: "howto", label: "How to Play", onClick: () => { onHowTo?.(); setShowHowTo(true); }, icon: <span className="h-4 w-4 flex items-center justify-center">{ICONS.book}</span> },
      //{ key: "settings", label: "Options", onClick: () => { onSettings?.(); setShowOptions(true); }, icon: <span className="h-4 w-4 flex items-center justify-center">{ICONS.settings}</span> },
      { key: "quit", label: "Quit", onClick: onQuit, icon: <span className="h-4 w-4 flex items-center justify-center">{ICONS.power}</span> },
    ].filter(Boolean) as MenuItem[],
    [hasSave, safeOnContinue, safeOnNew, onMultiplayer, onHowTo, onSettings, onQuit]
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

  // Parallax background — respects reduced motion & pointer type
  const parallaxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = parallaxRef.current; if (!el) return;
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const isFine = window.matchMedia?.("(pointer: fine)")?.matches;
    if (prefersReduced || !isFine) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const { innerWidth: w, innerHeight: h } = window;
        const x = (e.clientX / w - 0.5) * 2;
        const y = (e.clientY / h - 0.5) * 2;
        el.style.transform = `translate3d(${x * 6}px, ${y * 6}px, 0)`;
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => { window.removeEventListener("mousemove", onMove); cancelAnimationFrame(raf); };
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

      {/* Title + tagline + profile (Profile pill is clickable if onProfile provided) */}
      <div className="px-6 pt-10 md:px-10 max-w-xl">
        <h1 className="text-4xl font-extrabold tracking-wider drop-shadow-[0_4px_0_rgba(0,0,0,0.55)] md:text-6xl">
          {logoText}
        </h1>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-purple-100/90 md:text-lg"><b>Spin</b>, <b>draft</b>, triumph.</p>
          {onProfile ? (
            <button
              type="button"
              onClick={onProfile}
              className="rounded bg-black/35 px-3 py-1.5 text-sm ring-1 ring-amber-300/25 hover:bg-black/45 focus:outline-none focus:ring-2 focus:ring-amber-300"
              aria-label="Open Profile"
            >
              {profileBadge}
            </button>
          ) : (
            <div className="rounded bg-black/35 px-3 py-1.5 text-sm ring-1 ring-amber-300/25">
              {profileBadge}
            </div>
          )}
        </div>

        {/* Context-relevant "mascot" row: your tokens as characters */}
        <MascotRow />
      </div>

      {/* MAIN COLUMN: push menu to bottom on mobile for thumb reach */}
      <div className="flex min-h-[55vh] flex-col">
        <div className="grow" />

        {/* Vertical Menu (chunky/gamey) */}
        <nav aria-label="Main menu" className="px-6 md:px-10">
          <ul className="mx-auto w-full max-w-md">
            {items.map((it, i) => (
              <li key={it.key} className="mb-3">
                <ChunkyBtn
                  active={i === selected}
                  disabled={!it.onClick}
                  onClick={() => it.onClick?.()}
                  left={it.icon}
                >
                  {it.label}
                </ChunkyBtn>
              </li>
            ))}
          </ul>
        </nav>

        {/* Bottom Dock (Codex / Profile / Forge) */}
        <BottomDock
          onHowTo={() => { onHowTo?.(); setShowHowTo(true); }}
          onProfile={onProfile}
          onSettings={() => { onSettings?.(); setShowOptions(true); }}
        />

        {/* Version */}
        <footer className="pointer-events-none mt-2 flex items-end justify-end px-6 pb-[max(12px,env(safe-area-inset-bottom))] text-sm opacity-85 md:px-10">
          <div className="pointer-events-auto rounded bg-black/35 px-3 py-1.5 ring-1 ring-amber-300/25">{version}</div>
        </footer>
      </div>

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

/* ===================== UI PARTS ===================== */

function ChunkyBtn({
  active,
  disabled,
  left,
  children,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  left?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
}) {
  const base =
    "relative w-full select-none rounded-[18px] px-5 py-3.5 text-left font-semibold tracking-wide outline-none transition";
  const state = disabled
    ? "opacity-60 cursor-not-allowed"
    : "cursor-pointer active:translate-y-[1px] focus-visible:ring-2 focus-visible:ring-amber-300";
  const on = active
    ? `text-[${THEME.textDark}] shadow-[0_6px_16px_rgba(245,192,99,0.32)]`
    : "text-white ring-1 ring-amber-300/25 hover:brightness-110";

  return (
    <button
      role="button"
      aria-disabled={disabled}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={`${base} ${state} ${on}`}
      style={{
        background: active
          ? `linear-gradient(180deg, ${THEME.btnStart}, ${THEME.btnEnd})`
          : "linear-gradient(180deg, rgba(0,0,0,0.38), rgba(0,0,0,0.22))",
        boxShadow: `inset 0 2px 0 ${THEME.faceTint}, 0 0 0 1px ${THEME.btnEdge}20`,
        border: `1px solid ${active ? THEME.btnEdge + "66" : "transparent"}`,
      }}
    >
      <span className="flex items-center justify-between">
        <span className="flex items-center gap-3">
          <span className="-ml-1 mr-1 text-amber-300">{active ? "❯" : "•"}</span>
          {left}
          {children}
        </span>
        <span aria-hidden className="opacity-80">›</span>
      </span>
    </button>
  );
}

// Tiny character row using your palette (initiative, player, enemy)
function MascotRow() {
  const bubbles = [
    { c: "#F0C94A" }, // initiative/gold
    { c: "#84cc16" }, // player lime
    { c: "#d946ef" }, // enemy fuchsia
  ];
  return (
    <div className="mt-3 flex items-end gap-2">
      {bubbles.map((b, i) => (
        <div
          key={i}
          className="h-12 w-12 rounded-full shadow-lg"
          style={{
            background: `radial-gradient(circle at 30% 30%, #ffffff99, transparent 55%), ${b.c}`,
            boxShadow: `0 8px 18px ${b.c}30, inset 0 2px 0 #ffffff40`,
          }}
        >
          {/* subtle "eyes" slit to imply character */}
          <div className="relative h-full w-full">
            <div className="absolute left-1/2 top-[42%] h-[2px] w-5 -translate-x-1/2 rounded bg-black/35" />
          </div>
        </div>
      ))}
    </div>
  );
}

function BottomDock({
  onHowTo,
  onProfile,
  onSettings,
  shopBadge = 0,
}: {
  onHowTo?: () => void;
  onProfile?: () => void;
  onSettings?: () => void;
  shopBadge?: number;
}) {
  const Item = ({
    label,
    icon,
    onClick,
    badge,
  }: { label: string; icon: ReactNode; onClick?: () => void; badge?: number; }) => (
    <button
      onClick={onClick}
      className="relative grid w-20 place-items-center gap-1 rounded-2xl px-2 py-2 text-xs font-semibold text-white/90 ring-1"
      style={{ background: THEME.dockBg, borderColor: THEME.dockRing }}
    >
      <div className="relative grid h-12 w-12 place-items-center rounded-2xl bg-white/5 ring-1 ring-white/10">
        {icon}
        {!!badge && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-indigo-950 ring-1 ring-amber-300">
            {badge}
          </span>
        )}
      </div>
      <span>{label}</span>
    </button>
  );

  return (
    <div className="sticky bottom-0 z-20 mt-4 flex w-full justify-center pb-[max(12px,env(safe-area-inset-bottom))]">
      <div
        className="flex items-center gap-3 rounded-3xl px-3 py-2 ring-1"
        style={{ background: THEME.dockBg, borderColor: THEME.dockRing }}
      >
        <Item label="Codex"   onClick={onHowTo}   icon={<span className="text-xl">{ICONS.book}</span>} />
        <Item label="Profile" onClick={onProfile} icon={<span className="text-xl">🛡️</span>} />
        <Item label="Forge"   onClick={onSettings} icon={<span className="text-xl">{ICONS.settings}</span>} badge={shopBadge} />
      </div>
    </div>
  );
}

/* ===================== OVERLAYS ===================== */

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = "dlg-" + title.replace(/\s+/g, "-").toLowerCase();
  return (
    <div role="dialog" aria-modal aria-labelledby={titleId} className="fixed inset-0 z-40 grid place-items-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-[92vw] max-w-2xl rounded-2xl bg-indigo-950/90 p-4 ring-1 ring-amber-300/25 backdrop-blur md:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 id={titleId} className="text-xl font-bold tracking-wide">{title}</h2>
          <button
            onClick={onClose}
            className="rounded bg-white/10 px-3 py-1 text-sm hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            Close
          </button>
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
