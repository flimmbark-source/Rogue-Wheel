import React from "react";

type SpellButtonConfig = {
  key: string;
  label: string;
  help: string;
  disabled: boolean;
  onClick: () => void;
};

type SpellButtonsProps = {
  mana: number;
  canAct: boolean;
  timeTwistDisabled: boolean;
  timeTwistUsed: boolean;
  onFireball: () => void;
  onIceShard: () => void;
  onMirrorImage: () => void;
  onArcaneShift: () => void;
  onHex: () => void;
  onTimeTwist: () => void;
};

const SpellButtons: React.FC<SpellButtonsProps> = ({
  mana,
  canAct,
  timeTwistDisabled,
  timeTwistUsed,
  onFireball,
  onIceShard,
  onMirrorImage,
  onArcaneShift,
  onHex,
  onTimeTwist,
}) => {
  const spellButtons: SpellButtonConfig[] = [
    {
      key: "fireball",
      label: "Fireball (spend X mana)",
      onClick: onFireball,
      disabled: !canAct || mana < 1,
      help: "Spend mana to reduce an enemy lane by X (+1 with Spell Echo).",
    },
    {
      key: "ice-shard",
      label: "Ice Shard (-1 mana)",
      onClick: onIceShard,
      disabled: !canAct || mana < 1,
      help: "Freeze an enemy lane; its value can no longer change this round.",
    },
    {
      key: "mirror-image",
      label: "Mirror Image (-1 mana)",
      onClick: onMirrorImage,
      disabled: !canAct || mana < 1,
      help: "Copy the opposing card on a lane you committed to.",
    },
    {
      key: "arcane-shift",
      label: "Arcane Shift (-1 mana)",
      onClick: onArcaneShift,
      disabled: !canAct || mana < 1,
      help: "Move a wheel’s pointer by ±1 slice (±2 with Planar Swap).",
    },
    {
      key: "hex",
      label: "Hex (-1 mana)",
      onClick: onHex,
      disabled: !canAct || mana < 1,
      help: "Reduce the opponent’s reserve sum by 2 (3 with Recall Mastery).",
    },
    {
      key: "time-twist",
      label: timeTwistUsed ? "Time Twist (used)" : "Time Twist (-1 mana)",
      onClick: onTimeTwist,
      disabled: timeTwistDisabled,
      help: "Swap initiative for the rest of the round.",
    },
  ];

  return (
    <div className="space-y-2">
      {spellButtons.map((spell) => (
        <div key={spell.key} className="flex flex-col gap-0.5">
          <button
            onClick={spell.onClick}
            disabled={spell.disabled}
            className="rounded bg-amber-400/90 px-2 py-1 font-semibold text-slate-900 transition disabled:opacity-40"
          >
            {spell.label}
          </button>
          <span className="text-[11px] text-slate-300">{spell.help}</span>
        </div>
      ))}
    </div>
  );
};

export default SpellButtons;
