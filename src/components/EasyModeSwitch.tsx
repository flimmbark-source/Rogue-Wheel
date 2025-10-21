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
        "group inline-flex items-center gap-3 rounded-full border border-transparent px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide transition",
        disabled
          ? "cursor-not-allowed text-slate-500"
          : "text-slate-300 hover:border-emerald-400/60 hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40",
        className,
      ].join(" ")}
    >
      <span className="select-none">Easy Mode</span>
      <span
        className={[
          "relative inline-flex h-6 w-12 items-center rounded-full border transition-colors",
          checked
            ? "border-emerald-400 bg-emerald-400/20"
            : "border-slate-600 bg-slate-800",
          disabled ? "opacity-60" : "",
        ].join(" ")}
      >
        <span
          className={[
            "absolute left-1 h-4 w-4 rounded-full transition-transform",
            checked ? "translate-x-5 bg-emerald-300" : "translate-x-0 bg-slate-400",
          ].join(" ")}
        />
      </span>
    </button>
  );
}
