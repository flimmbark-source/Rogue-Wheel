import React from "react";

type EasyModeSwitchProps = {
  checked: boolean;
  onToggle: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
  stackedLabel?: boolean;
};

export default function EasyModeSwitch({
  checked,
  onToggle,
  disabled = false,
  className = "",
  label = "Balanced Slices",
  stackedLabel = false,
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
        "group inline-flex rounded-full border border-transparent text-[10px] font-semibold transition sm:text-[11px] sm:font-medium sm:uppercase sm:tracking-wide",
        stackedLabel
          ? "flex-col items-start gap-1 px-3 py-2 text-left sm:gap-1.5 sm:px-4"
          : "items-center gap-1.5 px-2.5 py-1 sm:gap-3 sm:px-4 sm:py-1.5",
        disabled
          ? "cursor-not-allowed text-slate-500"
          : "text-slate-300 hover:border-emerald-400/60 hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40",
        className,
      ].join(" ")}
    >
      <span
        className={[
          "select-none leading-none",
          stackedLabel ? "text-left" : "",
        ].join(" ")}
      >
        {label}
      </span>
      <span
        className={[
          "inline-flex h-4 w-[2.25rem] items-center rounded-full border px-0.5 transition-all sm:h-6 sm:w-12 sm:px-1",
          stackedLabel ? "mt-1.5" : "",
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
