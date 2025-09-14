import React, { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  PlayCircle,
  Swords,
  Trophy,
  BookOpen,
  Sparkles,
  Settings,
  User,
  RefreshCw,
  Star,
  Wand2,
  Info,
  Power,
} from "./icons";

/**
 * Rogue Wheel — Main Hub Start Menu
 *
 * • Responsive three-column layout (Profile • Core • Meta)
 * • Big primary Play CTA, secondary modes, footer utilities
 * • Subtle animations, accessible focus states, keyboard friendly
 * • Works even if the logo image fails (fallback emblem)
 * • TailwindCSS styling; Framer Motion for entrance/hover
 *
 * Wire this into your router/state by passing the on* handlers below.
 */

export type HubProps = {
  logoSrc?: string; // optional brand image; put in /public or import as module
  playerName?: string;
  level?: number;
  xp?: number; // 0..1 for bar fill
  continueAvailable?: boolean;
  onPlay?: () => void;
  onContinue?: () => void;
  onNewRun?: () => void;
  onChallenge?: () => void;
  onDraftPractice?: () => void;
  onSettings?: () => void;
  onCredits?: () => void;
  onQuit?: () => void;
};

export default function RogueWheelHub({
  logoSrc = "/rogue-wheel-logo.png", // put your image in /public or pass prop
  playerName = "Adventurer",
  level = 3,
  xp = 0.42,
  continueAvailable = false,
  onPlay,
  onContinue,
  onNewRun,
  onChallenge,
  onDraftPractice,
  onSettings,
  onCredits,
  onQuit,
}: HubProps) {
  const [logoError, setLogoError] = useState(false);

  // Decorative floating sparkles positions (stable between renders)
  const sparkleSeeds = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        key: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        d: 6 + Math.random() * 10,
        delay: Math.random() * 4,
      })),
    []
  );

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-gradient-to-b from-indigo-700 via-indigo-800 to-indigo-900 text-slate-100">
      {/* Parallax background ornaments */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-25">
        {sparkleSeeds.map((s) => (
          <motion.div
            key={s.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: [0, 1, 0], y: [0, -10, 0] }}
            transition={{ duration: s.d, repeat: Infinity, delay: s.delay }}
            className="absolute"
            style={{ left: `${s.x}%`, top: `${s.y}%` }}
          >
            <Sparkles className="h-4 w-4" />
          </motion.div>
        ))}
      </div>

      {/* CONTENT */}
      <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-10 pt-10 md:gap-10 md:px-6 md:pt-12">
        {/* BRANDING */}
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <div className="mb-3 flex items-center gap-3">
            {logoSrc && !logoError ? (
              <img
                src={logoSrc}
                alt="Rogue Wheel logo"
                className="h-14 w-auto drop-shadow"
                onError={() => setLogoError(true)}
                loading="eager"
              />
            ) : (
              <motion.div
                initial={{ rotate: -6, scale: 0.9, opacity: 0 }}
                animate={{ rotate: 0, scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 80, damping: 12 }}
                className="grid h-14 w-14 place-items-center rounded-full bg-indigo-500/40 ring-1 ring-white/40"
              >
                <Wand2 className="h-7 w-7" />
              </motion.div>
            )}
            <motion.h1
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 100, damping: 12 }}
              className="text-2xl font-extrabold tracking-wide md:text-3xl"
            >
              Rogue Wheel
            </motion.h1>
          </div>
          <p className="text-indigo-100/90">
            Lighthearted fantasy. <span className="font-semibold">Spin</span>, <span className="font-semibold">draft</span>, triumph.
          </p>
        </div>

        {/* GRID: Profile • Core • Meta */}
        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-3">
          {/* PROFILE */}
          <motion.section
            initial={{ x: -12, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 120, damping: 16, delay: 0.05 }}
            className="rounded-2xl bg-indigo-950/30 p-4 shadow-xl ring-1 ring-white/10 backdrop-blur-sm"
          >
            <header className="mb-3 flex items-center gap-2">
              <User className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Profile</h2>
            </header>
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-indigo-600/50 ring-1 ring-white/30">
                <Star className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm/5 opacity-90">{playerName}</div>
                <div className="text-xs opacity-80">Level {level}</div>
                <div aria-label="experience" className="mt-1 h-2 w-40 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-gradient-to-r from-amber-300 to-amber-500"
                    style={{ width: `${Math.min(Math.max(xp, 0), 1) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs">
              <StatCard label="Wins" value="12" />
              <StatCard label="Best Streak" value="4" />
              <StatCard label="Cards" value="36" />
            </div>
          </motion.section>

          {/* CORE MENU */}
          <motion.section
            initial={{ scale: 0.98, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 120, damping: 14, delay: 0.1 }}
            className="rounded-2xl bg-indigo-950/40 p-4 shadow-2xl ring-1 ring-white/10 backdrop-blur-sm md:p-6"
          >
            <div className="mx-auto flex max-w-md flex-col gap-3">
              <HubButton
                large
                icon={<PlayCircle className="h-6 w-6" />}
                label="Play"
                kbd="Enter"
                onClick={onPlay}
              />
              <HubButton
                icon={<RefreshCw className="h-5 w-5" />}
                label="Continue"
                disabled={!continueAvailable}
                onClick={onContinue}
              />
              <HubButton icon={<Swords className="h-5 w-5" />} label="New Run" onClick={onNewRun} />
              <HubButton icon={<Trophy className="h-5 w-5" />} label="Daily Challenge" onClick={onChallenge} />
              <HubButton icon={<BookOpen className="h-5 w-5" />} label="Draft Practice" onClick={onDraftPractice} />
            </div>
          </motion.section>

          {/* META */}
          <motion.section
            initial={{ x: 12, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 120, damping: 16, delay: 0.15 }}
            className="rounded-2xl bg-indigo-950/30 p-4 shadow-xl ring-1 ring-white/10 backdrop-blur-sm"
          >
            <header className="mb-3 flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Meta & Progress</h2>
            </header>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
                <span>Achievements</span>
                <span className="text-amber-300">7/32</span>
              </li>
              <li className="flex items-center justify-between rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
                <span>Lore Codex</span>
                <span className="opacity-80">12 entries</span>
              </li>
              <li className="flex items-center justify-between rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
                <span>Card Album</span>
                <span className="opacity-80">36/120</span>
              </li>
            </ul>
          </motion.section>
        </div>

        {/* FOOTER */}
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-center gap-3 pt-2 text-sm opacity-95">
          <FooterButton icon={<Settings className="h-4 w-4" />} label="Settings" onClick={onSettings} />
          <FooterButton icon={<Info className="h-4 w-4" />} label="Credits" onClick={onCredits} />
          <FooterButton icon={<Power className="h-4 w-4" />} label="Quit" onClick={onQuit} />
          <span className="select-none opacity-60">v0.1.0</span>
        </div>
      </div>
    </div>
  );
}

function HubButton({
  label,
  icon,
  onClick,
  disabled,
  large,
  kbd,
}: {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  large?: boolean;
  kbd?: string;
}) {
  return (
    <motion.button
      whileHover={!disabled ? { scale: 1.02 } : undefined}
      whileTap={!disabled ? { scale: 0.98 } : undefined}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={[
        "group relative flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300",
        large ? "py-4 text-lg" : "text-base",
        disabled
          ? "cursor-not-allowed border-white/10 bg-white/5 text-white/40"
          : "border-amber-400/20 bg-gradient-to-b from-amber-300/10 to-amber-400/10 hover:from-amber-300/20 hover:to-amber-400/20",
      ].join(" ")}
    >
      <span className="pointer-events-none absolute -left-2 -top-2 hidden rounded-full bg-amber-400/20 p-1 group-hover:block" />
      <div className="flex items-center gap-3">
        {icon}
        <span className="font-semibold tracking-wide">{label}</span>
      </div>
      {kbd && <span className="rounded bg-white/10 px-2 py-0.5 text-xs tracking-wider opacity-80">{kbd}</span>}
    </motion.button>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-2 ring-1 ring-white/10">
      <div className="text-xs opacity-75">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

function FooterButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 shadow-sm ring-1 ring-white/10 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
