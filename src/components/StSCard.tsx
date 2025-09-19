// src/components/StSCard.tsx
import React, { memo } from "react";
import { Card } from "../game/types";
import {
  fmtNum,
  getCardPlayValue,
  getCardReserveValue,
  getSplitFaces,
  isSplit,
} from "../game/values";

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
  showReserve = true,
  variant = "default",
  showName = true,

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
  showReserve?: boolean;
  variant?: "default" | "minimal";
  showName?: boolean;

}) {
  const dims =
    size === "lg"
      ? { w: 120, h: 160 }
      : size === "md"
      ? { w: 92, h: 128 }
      : { w: 72, h: 96 };
  const showHeader = variant === "default" && showName;
  const showFooter = variant === "default";
  const isNegativeCard = !isSplit(card) && getCardPlayValue(card) < 0;
  const frameGradient = isNegativeCard
    ? "from-rose-700 to-rose-900 border-rose-500/70"
    : "from-slate-600 to-slate-800 border-slate-400";
  const innerPanel = isNegativeCard
    ? "bg-gradient-to-br from-rose-950/90 to-rose-900/70 border border-rose-700/70"
    : "bg-slate-900/85 border border-slate-700/70";
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onPick?.(); }}
      disabled={disabled}
      className={`relative select-none rounded-xl overflow-hidden ${
        disabled ? "opacity-60" : "hover:scale-[1.02]"
      } transition will-change-transform ${selected ? "ring-2 ring-amber-400" : ""}`}
      style={{ width: dims.w, height: dims.h }}
      aria-label={`Card`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={onPointerDown}
    >
      <div
        className={`absolute inset-0 rounded-xl border bg-gradient-to-br ${frameGradient}`}
      ></div>
      <div
        className={`absolute inset-[3px] rounded-[12px] backdrop-blur-[1px] ${innerPanel}`}
      />
      <div
        className={`absolute inset-0 flex flex-col p-2 ${
          variant === "minimal" ? "items-center justify-center gap-1.5" : "justify-between"
        }`}
      >
        {showHeader && (
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-200">
            {card.name}
          </div>
        )}
        <div className="flex-1 flex items-center justify-center text-center">
          {isSplit(card) ? (
            <div className="grid grid-cols-2 gap-x-2 text-center text-white/90">
              {getSplitFaces(card).map((face) => (
                <div key={face.id} className="leading-tight">
                  <div className="text-[10px] uppercase text-slate-300">
                    {face.label ?? (face.id === "left" ? "Left" : "Right")}
                  </div>
                  <div className="text-xl font-extrabold">{fmtNum(face.value)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-3xl font-extrabold text-white/90">
              {fmtNum(getCardPlayValue(card))}
            </div>
          )}
        </div>
        {showFooter && (
          <div className="space-y-1 text-[11px] leading-tight text-slate-200/90">
            {showReserve && (
              <div className="font-semibold">
                Reserve {fmtNum(getCardReserveValue(card))}
              </div>
            )}
            {card.reserve?.summary && (
              <div className="text-slate-200/80">{card.reserve.summary}</div>
            )}
            {(() => {
              const summaries = [
                ...(card.activation ?? []).map((ability) => ability.summary),
                ...getSplitFaces(card).flatMap((face) =>
                  (face.activation ?? []).map((ability) => `${face.label ?? (face.id === "left" ? "Left" : "Right")}: ${ability.summary}`),
                ),
              ].filter(Boolean);
              if (!summaries.length) return null;
              const unique = Array.from(new Set(summaries));
              return <div className="text-slate-200/80">{unique.join(" • ")}</div>;
            })()}
          </div>
        )}
      </div>
    </button>
  );
});
