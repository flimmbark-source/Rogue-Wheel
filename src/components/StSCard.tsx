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
}) {
  const dims = size === "lg" ? { w: 120, h: 160 } : size === "md" ? { w: 92, h: 128 } : { w: 72, h: 96 };
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
      <div className="absolute inset-0 rounded-xl border bg-gradient-to-br from-slate-600 to-slate-800 border-slate-400"></div>
      <div className="absolute inset-px rounded-[10px] bg-slate-900/85 backdrop-blur-[1px] border border-slate-700/70" />
      <div className="absolute inset-0 flex items-center justify-center">
        {isSplit(card) ? (
          <div className="text-xl font-extrabold text-white/90 leading-none text-center">
            <div>{fmtNum(card.leftValue!)}<span className="opacity-60">|</span>{fmtNum(card.rightValue!)}</div>
          </div>
        ) : (
          <div className="text-3xl font-extrabold text-white/90">{fmtNum(card.number as number)}</div>
        )}
      </div>
    </button>
  );
});
