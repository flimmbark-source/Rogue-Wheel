// src/components/StSCard.tsx
import React, { memo } from "react";
import { Card, type TagId } from "../game/types";
import { fmtNum, isSplit } from "../game/values";

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
  faceDown = false,
  showHint = true,
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
  faceDown?: boolean;
  showHint?: boolean;
}) {
  const dims = size === "lg" ? { w: 120, h: 160 } : size === "md" ? { w: 92, h: 128 } : { w: 72, h: 96 };

  const TAG_INFO: Record<TagId, { icon: string; label: string; tone: string }> = {
    oddshift: { icon: "↷", label: "Oddshift", tone: "bg-amber-500/80" },
    parityflip: { icon: "±", label: "Parity Flip", tone: "bg-sky-500/80" },
    echoreserve: { icon: "⟳", label: "Echo Reserve", tone: "bg-emerald-500/80" },
    swap: { icon: "⇄", label: "Swap", tone: "bg-violet-500/80" },
    steal: { icon: "⇆", label: "Steal", tone: "bg-rose-500/80" },
    decoy: { icon: "?", label: "Decoy", tone: "bg-slate-500/80" },
    reveal: { icon: "👁", label: "Reveal", tone: "bg-orange-400/80" },
  };

  const tagBadges = !faceDown
    ? card.tags.map((tag) => {
        const data = TAG_INFO[tag];
        if (!data) return null;
        return (
          <span
            key={tag}
            className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded text-[10px] font-semibold text-black/85 shadow ${data.tone}`}
            title={data.label}
          >
            {data.icon}
          </span>
        );
      })
    : null;

  const cardTitle = faceDown ? "Hidden" : card.name;
  const metaDisplay = card.meta?.decoy?.display;
  const renderValue = () => {
    if (faceDown) {
      return <span className="text-3xl font-extrabold text-white/80">{metaDisplay ?? "?"}</span>;
    }

    if (isSplit(card)) {
      return (
        <div className="text-xl font-extrabold text-white/90 leading-none text-center">
          <div>
            {fmtNum(card.leftValue!)}
            <span className="opacity-60">|</span>
            {fmtNum(card.rightValue!)}
          </div>
        </div>
      );
    }

    if (typeof card.number === "number") {
      return <div className="text-3xl font-extrabold text-white/90">{fmtNum(card.number)}</div>;
    }

    if (metaDisplay) {
      return <div className="text-3xl font-extrabold text-white/90">{metaDisplay}</div>;
    }

    return <div className="text-3xl font-extrabold text-white/90">—</div>;
  };

  const hintText = !faceDown && showHint && card.hint ? (
    <div className="absolute bottom-1.5 left-1.5 right-1.5 text-[10px] font-medium leading-tight text-white/85 opacity-85">
      {card.hint}
    </div>
  ) : null;

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onPick?.(); }}
      disabled={disabled}
      className={`relative select-none ${disabled ? 'opacity-60' : 'hover:scale-[1.02]'} transition will-change-transform ${selected ? 'ring-2 ring-amber-400' : ''}`}
      style={{ width: dims.w, height: dims.h }}
      aria-label={`Card`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={onPointerDown}
    >
      <div className={`absolute inset-0 rounded-xl border ${faceDown ? 'bg-slate-800 border-slate-500/70' : 'bg-gradient-to-br from-slate-600 to-slate-800 border-slate-400'}`}></div>
      <div className={`absolute inset-px rounded-[10px] ${faceDown ? 'bg-slate-800/90 border border-slate-700/50' : 'bg-slate-900/85 backdrop-blur-[1px] border border-slate-700/70'}`} />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2 text-center">
        <div className="absolute top-1 left-1 right-1 flex flex-wrap items-center justify-center gap-1">
          {tagBadges}
        </div>
        <div className="absolute top-1 left-1 text-[10px] font-semibold uppercase tracking-wide text-white/70">
          {cardTitle}
        </div>
        <div className="mt-2 flex flex-1 items-center justify-center">{renderValue()}</div>
        {hintText}
      </div>
    </button>
  );
});
