// src/components/StSCard.tsx
import React, { memo } from "react";
import { Card } from "../game/types";
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
  const dims =
    size === "lg"
      ? { w: 120, h: 160 }
      : size === "md"
      ? { w: 92, h: 128 }
      : { w: 72, h: 96 };

  // ----- Link descriptor badges (from Experimental) -----
  // ----- Title / value / hint -----
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

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onPick?.();
      }}
      disabled={disabled}
      className={`relative select-none ${
        disabled ? "opacity-60" : "hover:scale-[1.02]"
      } transition will-change-transform ${selected ? "ring-2 ring-amber-400" : ""}`}
      style={{ width: dims.w, height: dims.h }}
      aria-label={`Card`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={onPointerDown}
    >
      {/* Frame layers with face-down styling support */}
      <div
        className={`absolute inset-0 rounded-xl border ${
          faceDown
            ? "bg-slate-800 border-slate-500/70"
            : "bg-gradient-to-br from-slate-600 to-slate-800 border-slate-400"
        }`}
      />
      <div
        className={`absolute inset-px rounded-[10px] ${
          faceDown
            ? "bg-slate-800/90 border border-slate-700/50"
            : "bg-slate-900/85 backdrop-blur-[1px] border border-slate-700/70"
        }`}
      />

      {/* Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center">
        {/* Main value */}
        <div className="flex flex-1 items-center justify-center">{renderValue()}</div>

        {/* Hint */}
      </div>
    </button>
  );
});
