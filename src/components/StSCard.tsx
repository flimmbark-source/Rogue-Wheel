// src/components/StSCard.tsx
import React, { memo } from "react";
import { Card } from "../game/types";
import {
  fmtNum,
  getCardBehavior,
  getCardPlayValue,
  getCardReserveValue,
  getSplitFaces,
  isSplit,
} from "../game/values";
import cardFrameUrl from "../../assets/card-frame.png";
import negativeCardFrameUrl from "../../assets/negative-card-frame.png";

type Kind = "normal" | "negative" | "split";

export type CardAdjustmentStatusTone = "info" | "positive" | "warning";

export type CardAdjustmentDescriptor = {
  value?: number;
  status?: {
    label: string;
    tone?: CardAdjustmentStatusTone;
  };
};

export function getCardEffectSummary(
  card: Card,
  { includeReserve = true }: { includeReserve?: boolean } = {},
): string | null {
  const segments: string[] = [];

  if (card.effectSummary) {
    segments.push(card.effectSummary);
  }

  const reserveSummary = card.reserve?.summary;
  if (includeReserve && reserveSummary) {
    segments.push(reserveSummary);
  }

  const activationSummaries = [
    ...(card.activation ?? []).map((ability) => ability.summary),
    ...getSplitFaces(card).flatMap((face) =>
      (face.activation ?? []).map((ability) => {
        const label = face.label ?? (face.id === "left" ? "Left" : "Right");
        return ability.summary ? `${label}: ${ability.summary}` : null;
      }),
    ),
  ].filter((summary): summary is string => Boolean(summary));

  segments.push(...activationSummaries);

  const uniqueSegments = Array.from(
    new Set(
      segments
        .map((segment) => segment?.trim())
        .filter((segment): segment is string => Boolean(segment)),
    ),
  );

  if (uniqueSegments.length === 0) return null;

  return uniqueSegments.join(" • ");
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
  showReserve = true,
  variant = "default",
  showName = true,
  /** Optional: override computed kind (great for quick testing) */
  forceKind,
  /** Optional: show a tiny badge with the computed kind */
  debugKind = false,
  ariaDescribedBy,

  /** Optional: show a condensed reserve/ability hint when in minimal mode */
  showAbilityHint = false,
  adjustment,
  title,
  ariaLabel,
  ariaPressed,
  frameAppearance = "default",


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
  ariaDescribedBy?: string;
  showAbilityHint?: boolean;
  adjustment?: CardAdjustmentDescriptor;
  title?: string;
  ariaLabel?: string;
  ariaPressed?: boolean;
  frameAppearance?: "default" | "hand";


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
/* ==== MERGE-RESOLVED: card kind + rarity palettes with full-surface backgrounds ==== */

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

// Rarity palette only applies to "normal" cards
type Rarity = NonNullable<Card["rarity"]> | "common";
const rarity: Rarity = (card.rarity as Rarity) ?? "common";

// Background (button surface) + frame (border-only) per rarity
const rarityPalette: Record<Rarity, { background: string; frame: string }> = {
  common: {
    background:
      "bg-gradient-to-br from-slate-900/85 to-slate-800/70 border border-slate-700/70",
    frame: "border-slate-400",
  },
  uncommon: {
    background:
      "bg-gradient-to-br from-emerald-950/90 to-emerald-900/70 border border-emerald-700/70",
    frame: "border-emerald-300/80",
  },
  rare: {
    background:
      "bg-gradient-to-br from-sky-950/90 to-sky-900/70 border border-sky-700/70",
    frame: "border-sky-300/80",
  },
  legendary: {
    background:
      "bg-gradient-to-br from-amber-950/90 to-amber-900/70 border border-amber-700/70",
    frame: "border-amber-300/80",
  },
};

// Kind overrides: negative/split ignore rarity; normal uses rarity palette
const backgroundsByKind: Record<Kind, string> = {
  normal: rarityPalette[rarity].background,
  negative:
    "bg-gradient-to-br from-red-800/90 to-red-600/70 border border-red-700/70",
  split:
    "bg-gradient-to-br from-indigo-950/90 to-indigo-900/70 border border-indigo-700/70",
};

const framesByKind: Record<Kind, string> = {
  normal: rarityPalette[rarity].frame,
  negative: "border-rose-500/70",
  split: "border-indigo-500/70",
};

const cardBackground = backgroundsByKind[cardKind];
const frameBorder = framesByKind[cardKind];

const behavior = getCardBehavior(card);
const behaviorIcon =
  behavior === "split" ? "✂️" : behavior === "boost" ? "⚡" : behavior === "swap" ? "🔄" : null;

const displayValue =
  typeof adjustment?.value === "number" ? adjustment.value : playVal;

const statusToneClass: Record<CardAdjustmentStatusTone, string> = {
  info: "bg-slate-900/70 text-slate-100",
  positive: "bg-emerald-500/30 text-emerald-100",
  warning: "bg-amber-500/40 text-amber-950",
};
const statusTone: CardAdjustmentStatusTone = adjustment?.status?.tone ?? "info";

/* ==== END MERGE-RESOLVED ==== */

  const reserveValue = getCardReserveValue(card);
  const activationSummaries = [
    ...(card.activation ?? []).map((ability) => ability.summary),
    ...getSplitFaces(card).flatMap((face) =>
      (face.activation ?? []).map((ability) =>
        `${face.label ?? (face.id === "left" ? "Left" : "Right")}: ${ability.summary}`,
      ),
    ),
  ].filter(Boolean);
  const uniqueActivationSummaries = Array.from(new Set(activationSummaries));

  const abilityHintParts: string[] = [];
  if (card.reserve?.summary) {
    abilityHintParts.push(card.reserve.summary);
  }
  if (uniqueActivationSummaries.length) {
    abilityHintParts.push(...uniqueActivationSummaries);
  }

  const abilityHintText = abilityHintParts.join(" • ");
  const shouldShowAbilityHint =
    variant === "minimal" && showAbilityHint && abilityHintText.length > 0;

  const computedAriaLabel =
    typeof ariaLabel === "string"
      ? ariaLabel
      : `Card ${card?.name ?? ""}${(() => {
          const summary = getCardEffectSummary(card);
          return summary ? `, ${summary}` : "";
        })()}`;

  const useWoodFrame = frameAppearance === "hand";
  const buttonBackgroundClass = useWoodFrame ? "bg-transparent" : cardBackground;
  const buttonStyle: React.CSSProperties = {
    width: dims.w,
    height: dims.h,
    ...(useWoodFrame
      ? {
          backgroundImage: `url(${cardKind === "negative" ? negativeCardFrameUrl : cardFrameUrl})`,
          backgroundSize: "cover",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
        }
      : {}),
  };

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
        ${buttonBackgroundClass}
      `}
      style={buttonStyle}
      style={{ width: dims.w, height: dims.h }}
      aria-label={computedAriaLabel}
      aria-describedby={ariaDescribedBy}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={onPointerDown}
      data-card-kind={cardKind}
      data-play-val={playVal}
      data-card-id={id}
      title={title}
      aria-pressed={ariaPressed}
    >
      {!useWoodFrame && (
        <div
          className={`pointer-events-none absolute inset-0 rounded-xl border ${frameBorder} bg-transparent`}
        />
      )}

      {(adjustment?.status || debugKind) && (
        <div className="pointer-events-none absolute right-1 top-1 flex flex-col items-end gap-1">
          {adjustment?.status && (
            <div
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusToneClass[statusTone]}`}
            >
              {adjustment.status.label}
            </div>
          )}
          {debugKind && (
            <div className="rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/80">
              {cardKind}
            </div>
          )}
        </div>
      )}

      {behaviorIcon && (
        <div className="pointer-events-none absolute left-1 top-1 text-lg leading-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.65)]">
          {behaviorIcon}
        </div>
      )}

      {/* Content layer */}
      <div
        className={`absolute inset-0 flex flex-col p-2 ${
          variant === "minimal"
            ? `items-center justify-center gap-1.5 ${
                shouldShowAbilityHint ? "pb-5" : ""
              }`
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
              {fmtNum(displayValue)}
            </div>
          )}
        </div>

        {showFooter && (
          <div className="space-y-1 text-[11px] leading-tight text-slate-200/90">
            {card.reserve?.summary && (
              <div className="text-slate-200/80">{card.reserve.summary}</div>
            )}
            {(() => {
              const effectSummary = getCardEffectSummary(card, { includeReserve: false });
              if (!effectSummary) return null;
              return <div className="text-slate-200/80">{effectSummary}</div>;
            })()}
          </div>
        )}
      </div>

      {shouldShowAbilityHint && (
        <div className="pointer-events-none absolute inset-x-1 bottom-1 flex justify-center">
          <div className="max-w-full rounded bg-black/65 px-1.5 py-0.5 text-center text-[9px] font-medium leading-snug text-slate-100/90 shadow-[0_0_6px_rgba(0,0,0,0.35)]">
            <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
              {abilityHintText}
            </span>
          </div>
        </div>
      )}

      {/* --- Tailwind safelist helper ---
         If your Tailwind build is purging dynamic classes, this ensures they're generated.
         For best practice, move this once to a top-level component instead of per card. */}
      <span
        aria-hidden
        className="hidden
          bg-gradient-to-br
          from-rose-950/90 to-rose-900/70 border-rose-700/70 border-rose-500/70
          from-indigo-950/90 to-indigo-900/70 border-indigo-700/70 border-indigo-500/70
          from-amber-900/90 to-yellow-900/70 border-amber-700/70 border-amber-500/70
          from-slate-900/85 to-slate-800/70 border-slate-700/70 border-slate-400
          from-sky-950/90 to-sky-900/70 border-sky-700/70 border-sky-300/80
          from-emerald-950/90 to-emerald-900/70 border-emerald-700/70 border-emerald-300/80
        "
      />
    </button>
  );
});
