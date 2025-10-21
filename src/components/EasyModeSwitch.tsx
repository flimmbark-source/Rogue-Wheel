import React from "react";

type EasyModeSwitchProps = {
  checked: boolean;
  onToggle: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
};

export default function EasyModeSwitch({
  checked,
  onToggle,
  disabled = false,
  className = "",
}: EasyModeSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Toggle easy mode"
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          onToggle(!checked);
        }
      }}
      className={[
        "group inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide transition",
        disabled ? "cursor-not-allowed text-slate-500" : "text-slate-300 hover:text-slate-100",
        className,
      ].join(" ")}
    >
      <span>Easy Mode</span>
      <span
        className={[
          "relative inline-flex h-5 w-10 items-center rounded-full border transition",
          checked
            ? "bg-emerald-400/20 border-emerald-400"
            : "border-slate-600 bg-slate-800",
          disabled ? "opacity-60" : "",
        ].join(" ")}
      >
        <span
          className={[
            "absolute left-1 h-3.5 w-3.5 rounded-full transition-transform",
            checked ? "translate-x-5 bg-emerald-300" : "translate-x-0 bg-slate-400",
          ].join(" ")}
        />
      </span>
    </button>
  );
}
