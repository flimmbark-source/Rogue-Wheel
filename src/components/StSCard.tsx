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

type Kind = "normal" | "negative" | "split";

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
  /** Optional: override computed kind (great for quick testing) */
  forceKind,
  /** Optional: show a tiny badge with the computed kind */
  debugKind = false,
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
  forceKind?: Kind;
  debugKind?: boolean;
}) {
  // ---------- Dimensions ----------
  const dims =
    size === "lg"
      ? { w: 120, h: 160 }
      : size === "md"
      ? { w: 92, h: 128 }
      : { w: 72, h: 96 };

  const showHeader = variant === "default" && showName;
  const showFooter = variant === "default";

  // Robust play value parsing (handles number|string|{value})
  const rawPV = getCardPlayValue(card) as unknown;
  const playVal =
    typeof rawPV === "number"
      ? rawPV
      : typeof rawPV === "string"
      ? parseFloat(rawPV)
      : rawPV && typeof rawPV === "object" && "value" in (rawPV as any)
      ? Number((rawPV as any).value)
      : 0;

  // Multi-signal negative detection
  const id = String((card as any).id ?? "");
  const kindOrType = String((card as any).kind ?? (card as any).type ?? "");
  const idSaysNegative = /^neg[_-]/i.test(id);
  const kindSaysNegative = /negative|curse/i.test(kindOrType);
  const computedNegative = !isSplit(card) && Number.isFinite(playVal) && playVal < 0;

  // If you have a forceKind prop, it wins; otherwise compute from split/negative/normal
  let cardKind: Kind =
    typeof forceKind !== "undefined"
      ? forceKind
      : isSplit(card)
      ? "split"
      : idSaysNegative || kindSaysNegative || computedNegative
      ? "negative"
      : "normal";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onPick?.();
      }}
      disabled={disabled}
      className={`relative select-none rounded-xl overflow-hidden
        ${disabled ? "opacity-60" : "hover:scale-[1.02]"}
        transition will-change-transform
        ${selected ? "ring-2 ring-amber-400" : ""}
      `}
      style={{ width: dims.w, height: dims.h }}
      aria-label={`Card ${card?.name ?? ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={onPointerDown}
      data-card-kind={cardKind}
      data-play-val={playVal}
      data-card-id={id}
    >
      {/* Optional debug badge */}
      {debugKind && (
        <div
          className={[
            "pointer-events-none absolute right-1 top-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px]",
            "font-semibold uppercase text-white/80",
          ].join(" ")}
        >
          {cardKind}
        </div>
      )}

      {/* Content layer */}
      <div
        className={`absolute inset-0 flex flex-col p-2 ${
          variant === "minimal"
            ? "items-center justify-center gap-1.5"
            : "justify-between"
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
                  <div className="text-xl font-extrabold">
                    {fmtNum(face.value)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-3xl font-extrabold text-white/90">
              {fmtNum(playVal)}
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
                  (face.activation ?? []).map(
                    (ability) =>
                      `${face.label ?? (face.id === "left" ? "Left" : "Right")}: ${
                        ability.summary
                      }`,
                  ),
                ),
              ].filter(Boolean);
              if (!summaries.length) return null;
              const unique = Array.from(new Set(summaries));
              return (
                <div className="text-slate-200/80">{unique.join(" • ")}</div>
              );
            })()}
          </div>
        )}
      </div>

    </button>
  );
});
