// src/components/StSCard.tsx
import React, { memo, useMemo } from "react";
import type { Arcana, Card } from "../game/types";
import { getArcanaIcon, getCardArcana } from "../game/arcana";
import { fmtNum, isSplit } from "../game/values";
import { getSkillAbilityColorClass } from "../game/skills";

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
  className?: string;
  spellTargetable?: boolean;
  spellAffected?: boolean;
  ariaLabel?: string;
  ariaPressed?: React.AriaAttributes["aria-pressed"];
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  showSkillColor?: boolean;
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "children" | "className" | "disabled" | "aria-label" | "aria-pressed"
>;

export default memo(function StSCard({
  card,
  disabled,
  size = "sm",
  selected,
  onPick,
  className,
  spellTargetable,
  spellAffected,
  ariaLabel,
  ariaPressed,
  onClick,
  showSkillColor = false,
  style,
  ...buttonProps
}: StSCardProps) {
  const dims = size === "lg" ? { w: 120, h: 160 } : size === "md" ? { w: 92, h: 128 } : { w: 72, h: 96 };
  const arcana = useMemo(() => getCardArcana(card), [card]);
  const skillNumberColor = useMemo(
    () => (showSkillColor ? getSkillAbilityColorClass(card) : null),
    [card, showSkillColor],
  );

  return (
    <button
      {...buttonProps}
      onClick={(e) => {
        e.stopPropagation();
        onPick?.();
        onClick?.(e);
      }}
      disabled={disabled}
      className={`relative select-none ${disabled ? 'opacity-60' : 'hover:scale-[1.02]'} transition will-change-transform ${selected ? 'ring-2 ring-amber-400' : ''} ${className ?? ''}`.trim()}
      style={{ ...(style ?? {}), width: dims.w, height: dims.h }}
      aria-label={ariaLabel ?? `Card`}
      aria-pressed={ariaPressed}
      data-spell-targetable={spellTargetable ? "true" : undefined}
    >
      {spellAffected ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[12px] ring-2 ring-amber-300/70 animate-pulse"
            style={{ boxShadow: "0 0 14px rgba(251,191,36,0.45)", zIndex: 3 }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-1 right-1 text-lg animate-pulse"
            style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)", zIndex: 4 }}
          >
            ✨
          </div>
        </>
      ) : null}
      <div className="absolute inset-0 rounded-xl border bg-gradient-to-br from-slate-600 to-slate-800 border-slate-400"></div>
      <div className="absolute inset-px rounded-[10px] bg-slate-900/85 backdrop-blur-[1px] border border-slate-700/70" />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {isSplit(card) ? (
          <div className="mt-1 text-xl font-extrabold text-white/90 leading-none text-center">
            <div>{fmtNum(card.leftValue!)}<span className="opacity-60">|</span>{fmtNum(card.rightValue!)}</div>
          </div>
        ) : (
          <div
            className={`mt+10 text-3xl font-extrabold ${skillNumberColor ?? "text-white/90"}`}
          >
            {fmtNum(card.number as number)}
          </div>
        )}
        <div className="pointer-events-none mt-1 flex items-center justify-center card-arcana">
          <ArcanaGlyph arcana={arcana} />
        </div>
      </div>
    </button>
  );
});
