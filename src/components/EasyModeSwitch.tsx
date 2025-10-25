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
      aria-label="Toggle balanced slices mode"
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          onToggle(!checked);
        }
      }}
      className={[
        "group inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-[10px] font-semibold transition sm:gap-3 sm:px-4 sm:py-1.5 sm:text-[11px] sm:font-medium sm:uppercase sm:tracking-wide",
        disabled
          ? "cursor-not-allowed text-slate-500"
          : "text-slate-300 hover:border-emerald-400/60 hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40",
        className,
      ].join(" ")}
    >
      <span className="select-none leading-none">Balanced Slices</span>
      <span
        className={[
          "inline-flex h-4 w-[2.25rem] items-center rounded-full border px-0.5 transition-all sm:h-6 sm:w-12 sm:px-1",
          checked
            ? "justify-end border-emerald-400 bg-emerald-400/20"
            : "justify-start border-slate-600 bg-slate-800",
          disabled ? "opacity-60" : "",
        ].join(" ")}
      >
        <span
          className={[
            "h-3.5 w-3.5 rounded-full transition-all sm:h-4 sm:w-4",
            checked ? "bg-emerald-300" : "bg-slate-400",
          ].join(" ")}
        />
      </span>
    </button>
  );
}
