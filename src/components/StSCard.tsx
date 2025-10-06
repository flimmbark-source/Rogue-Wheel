// src/components/StSCard.tsx
import React, { memo, useMemo } from "react";
import type { Arcana, Card } from "../game/types";
import { getArcanaIcon, getCardArcana } from "../game/arcana";
import { fmtNum, isSplit } from "../game/values";
import {
  SKILL_ABILITY_CARD_TINTS,
  SKILL_ABILITY_COLORS,
  SKILL_ABILITY_COLOR_HEX,
  determineSkillAbility,
  type SkillAbility,
} from "../game/skills";

type SkillCardTint = (typeof SKILL_ABILITY_CARD_TINTS)[keyof typeof SKILL_ABILITY_CARD_TINTS];

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
  const { skillNumberClass, skillNumberHex, skillAbility, skillTint } = useMemo<{
    skillNumberClass: string | null;
    skillNumberHex: string | null;
    skillAbility: SkillAbility | null;
    skillTint: SkillCardTint | null;
  }>(() => {
    if (!showSkillColor) {
      return { skillNumberClass: null, skillNumberHex: null, skillAbility: null, skillTint: null };
    }
    const ability = determineSkillAbility(card);
    if (!ability) {
      return { skillNumberClass: null, skillNumberHex: null, skillAbility: null, skillTint: null };
    }
    return {
      skillNumberClass: SKILL_ABILITY_COLORS[ability],
      skillNumberHex: SKILL_ABILITY_COLOR_HEX[ability],
      skillAbility: ability,
      skillTint: SKILL_ABILITY_CARD_TINTS[ability],
    };
  }, [card, showSkillColor]);

  return (
    <button
      {...buttonProps}
      onClick={(e) => {
        e.stopPropagation();
        onPick?.();
        onClick?.(e);
      }}
      disabled={disabled}
      className={[
        "relative select-none transition will-change-transform",
        disabled ? "opacity-60" : "hover:scale-[1.02]",
        selected ? "ring-2 ring-amber-400" : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ...(style ?? {}), width: dims.w, height: dims.h }}
      aria-label={ariaLabel ?? `Card`}
      aria-pressed={ariaPressed}
      data-spell-targetable={spellTargetable ? "true" : undefined}
      data-skill-ability={skillAbility ?? undefined}
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
      <div
        className={`absolute inset-0 rounded-xl border ${
          skillTint ? "" : "bg-gradient-to-br from-slate-600 to-slate-800 border-slate-400"
        }`}
        style={
          skillTint
            ? {
                backgroundImage: `linear-gradient(135deg, ${skillTint.backgroundFrom}, ${skillTint.backgroundTo})`,
                borderColor: skillTint.border,
                boxShadow: skillTint.glow,
              }
            : undefined
        }
        data-skill-layer="outer"
      ></div>
      <div
        className={`absolute inset-px rounded-[10px] border backdrop-blur-[1px] ${
          skillTint ? "" : "bg-slate-900/85 border-slate-700/70"
        }`}
        style={
          skillTint
            ? {
                background: "rgba(3, 7, 18, 0.76)",
                borderColor: skillTint.innerBorder,
              }
            : undefined
        }
        data-skill-layer="inner"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {isSplit(card) ? (
          <div className="mt-1 text-xl font-extrabold text-white/90 leading-none text-center">
            <div>{fmtNum(card.leftValue!)}<span className="opacity-60">|</span>{fmtNum(card.rightValue!)}</div>
          </div>
        ) : (
          <div
            className={`mt+10 text-3xl font-extrabold ${skillNumberClass ?? "text-white/90"}`}
            data-skill-color={skillNumberClass ? "true" : undefined}
            data-skill-ability={skillAbility ?? undefined}
            style={skillNumberHex ? { color: skillNumberHex } : undefined}
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
