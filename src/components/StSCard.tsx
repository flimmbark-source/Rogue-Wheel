// src/components/StSCard.tsx
import React, { memo, useMemo } from "react";
import type { Arcana, Card } from "../game/types";
import { getArcanaIcon, getCardArcana } from "../game/arcana";
import { fmtNum, isSplit } from "../game/values";

const ARCANA_COLOR_CLASS: Record<Arcana, string> = {
  fire: "text-orange-300",
  blade: "text-sky-200",
  eye: "text-violet-200",
  moon: "text-slate-200",
  serpent: "text-emerald-300",
};

function ArcanaGlyph({ arcana }: { arcana: Arcana }) {
  const icon = getArcanaIcon(arcana);
  const color = ARCANA_COLOR_CLASS[arcana] ?? "text-slate-200";
  return (
    <span aria-hidden className={`text-1x2 leading-none ${color}`}>
      {icon}
    </span>
  );
}

type StSCardProps = {
  card: Card;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  selected?: boolean;
  onPick?: () => void;
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLDivElement | HTMLButtonElement>;
  onDragEnd?: React.DragEventHandler<HTMLDivElement | HTMLButtonElement>;
  onPointerDown?: React.PointerEventHandler<HTMLDivElement | HTMLButtonElement>;
  className?: string;
  spellTargetable?: boolean;
  as?: "button" | "div";
};

function StSCardBase({
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
  as = "button",
}: StSCardProps) {
  const dims = size === "lg" ? { w: 120, h: 160 } : size === "md" ? { w: 92, h: 128 } : { w: 72, h: 96 };
  const arcana = useMemo(() => getCardArcana(card), [card]);

  const rootClassName = `relative select-none ${
    disabled ? "opacity-60" : "hover:scale-[1.02]"
  } transition will-change-transform ${selected ? "ring-2 ring-amber-400" : ""} ${className ?? ""}`.trim();

  const content = (
    <>
      <div className="absolute inset-0 rounded-xl border bg-gradient-to-br from-slate-600 to-slate-800 border-slate-400"></div>
      <div className="absolute inset-px rounded-[10px] bg-slate-900/85 backdrop-blur-[1px] border border-slate-700/70" />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {isSplit(card) ? (
          <div className="mt-1 text-xl font-extrabold text-white/90 leading-none text-center">
            <div>
              {fmtNum(card.leftValue!)}
              <span className="opacity-60">|</span>
              {fmtNum(card.rightValue!)}
            </div>
          </div>
        ) : (
          <div className="mt+10 text-3xl font-extrabold text-white/90">{fmtNum(card.number as number)}</div>
        )}
        <div className="pointer-events-none mt-1 flex items-center justify-center card-arcana">
          <ArcanaGlyph arcana={arcana} />
        </div>
      </div>
    </>
  );

  if (as === "div") {
    return (
      <div
        className={rootClassName}
        style={{ width: dims.w, height: dims.h }}
        draggable={draggable}
        onDragStart={onDragStart as React.DragEventHandler<HTMLDivElement>}
        onDragEnd={onDragEnd as React.DragEventHandler<HTMLDivElement>}
        onPointerDown={onPointerDown as React.PointerEventHandler<HTMLDivElement>}
        data-spell-targetable={spellTargetable ? "true" : undefined}
        role="presentation"
      >
        {content}
      </div>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onPick?.(); }}
      disabled={disabled}
      className={rootClassName}
      style={{ width: dims.w, height: dims.h }}
      aria-label={`Card`}
      draggable={draggable}
      onDragStart={onDragStart as React.DragEventHandler<HTMLButtonElement>}
      onDragEnd={onDragEnd as React.DragEventHandler<HTMLButtonElement>}
      onPointerDown={onPointerDown as React.PointerEventHandler<HTMLButtonElement>}
      data-spell-targetable={spellTargetable ? "true" : undefined}
      type="button"
    >
      {content}
    </button>
  );
}

export default memo(StSCardBase);
