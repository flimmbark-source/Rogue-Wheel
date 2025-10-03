// src/components/StSCard.tsx
import React, { memo, useMemo } from "react";
import { Card, TagId } from "../game/types";
import { fmtNum, isSplit } from "../game/values";

type ArcanaSymbol = "serpent" | "dagger" | "flame" | "eye";

const TAG_SYMBOL_MAP: Partial<Record<TagId, ArcanaSymbol>> = {
  oddshift: "serpent",
  parityflip: "dagger",
  echoreserve: "eye",
};

const SYMBOL_ORDER: ArcanaSymbol[] = ["serpent", "dagger", "flame", "eye"];

function symbolForCard(card: Card): ArcanaSymbol {
  const tagged = card.tags?.find((tag) => TAG_SYMBOL_MAP[tag]);
  if (tagged) return TAG_SYMBOL_MAP[tagged]!;

  const baseValue = isSplit(card)
    ? (card.leftValue ?? 0) + (card.rightValue ?? 0)
    : card.number ?? 0;

  const idx = Math.abs(baseValue) % SYMBOL_ORDER.length;
  return SYMBOL_ORDER[idx];
}

function ArcanaGlyph({ symbol }: { symbol: ArcanaSymbol }) {
  switch (symbol) {
    case "serpent":
      return (
        <svg viewBox="0 0 32 32" aria-hidden className="h-6 w-6 text-emerald-300">
          <path
            d="M8 20c0 4 3.5 6 8 6s8-2 8-6c0-3-2.2-4.5-5.2-5.4C15.3 13.5 14 12 14 10c0-2.4 2.3-4 5-4 2.1 0 3.9.9 5 2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="24" cy="8" r="2" fill="currentColor" />
        </svg>
      );
    case "dagger":
      return (
        <svg viewBox="0 0 32 32" aria-hidden className="h-6 w-6 text-sky-200">
          <path
            d="M16 4l-3 7 3 14 3-14-3-7z"
            fill="currentColor"
          />
          <rect x="13" y="23" width="6" height="5" rx="1.5" className="fill-slate-200" />
          <path d="M12 11h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "flame":
      return (
        <svg viewBox="0 0 32 32" aria-hidden className="h-6 w-6 text-orange-300">
          <path
            d="M18 4c0 4-4 5-4 9 0 2 1.4 3.6 1 6-.4 2.6-2.5 4-4 4-2.7 0-5-2.4-5-6 0-5 3.6-7.7 7.2-10.4C15.9 4.8 17 3 17 2c1.2 1.1 1 2.6 1 2z"
            fill="currentColor"
          />
          <path
            d="M21 10c4.6 3.1 6 6.6 6 10 0 4.4-3.3 8-8.5 8-3.3 0-6.5-2.4-6.5-6 0-2.7 1.9-4.4 4.5-5 1.7-.4 3.5-1.4 4.5-3z"
            fill="currentColor"
            opacity="0.65"
          />
        </svg>
      );
    case "eye":
    default:
      return (
        <svg viewBox="0 0 32 32" aria-hidden className="h-6 w-6 text-violet-200">
          <path
            d="M4 16s4.5-8 12-8 12 8 12 8-4.5 8-12 8-12-8-12-8z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="16" r="4" fill="currentColor" />
          <circle cx="16" cy="16" r="2" className="fill-slate-900" />
        </svg>
      );
  }
}

export default memo(function StSCard({
  card,
  disabled,
  size = "sm",
  selected,
  onPick,
  draggable,
  onDragStart,
  onDragEnd,
  onPointerDown,
  className,
  spellTargetable,
}: {
  card: Card;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  selected?: boolean;
  onPick?: () => void;
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLButtonElement>;
  onDragEnd?: React.DragEventHandler<HTMLButtonElement>;
  onPointerDown?: React.PointerEventHandler<HTMLButtonElement>;
  className?: string;
  spellTargetable?: boolean;
}) {
  const dims = size === "lg" ? { w: 120, h: 160 } : size === "md" ? { w: 92, h: 128 } : { w: 72, h: 96 };
  const symbol = useMemo(() => symbolForCard(card), [card]);

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onPick?.(); }}
      disabled={disabled}
      className={`relative select-none ${disabled ? 'opacity-60' : 'hover:scale-[1.02]'} transition will-change-transform ${selected ? 'ring-2 ring-amber-400' : ''} ${className ?? ''}`.trim()}
      style={{ width: dims.w, height: dims.h }}
      aria-label={`Card`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={onPointerDown}
      data-spell-targetable={spellTargetable ? "true" : undefined}
    >
      <div className="absolute inset-0 rounded-xl border bg-gradient-to-br from-slate-600 to-slate-800 border-slate-400"></div>
      <div className="absolute inset-px rounded-[10px] bg-slate-900/85 backdrop-blur-[1px] border border-slate-700/70" />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {isSplit(card) ? (
          <div className="text-xl font-extrabold text-white/90 leading-none text-center">
            <div>{fmtNum(card.leftValue!)}<span className="opacity-60">|</span>{fmtNum(card.rightValue!)}</div>
          </div>
        ) : (
          <div className="text-3xl font-extrabold text-white/90">{fmtNum(card.number as number)}</div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
        <ArcanaGlyph symbol={symbol} />
      </div>
    </button>
  );
});
