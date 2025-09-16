// src/ui/Hand.tsx
import React from "react";
import type { Card, Side } from "../game/types";

export default function Hand({
  side,
  cards,
  onSelect,
  accentColor,
  title = "Your Hand",
}: {
  side: Side;                 // "left" | "right" (your new side type)
  cards: Card[];              // cards to show for THIS client only
  onSelect?: (c: Card) => void;
  accentColor?: string;       // UI accent (players[side].color)
  title?: string;             // optional override
}) {
  return (
    <div
      role="grid"
      className="rounded-xl border border-slate-700 bg-slate-800/70 p-2"
      style={{ boxShadow: "0 0 0 2px rgba(0,0,0,0.15) inset" }}
    >
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: accentColor }}
          aria-hidden
        />
        <span className="font-semibold opacity-80">
          {side === "left" ? "Left" : "Right"} • {title}
        </span>
      </div>

      {cards.length === 0 ? (
        <div className="text-sm italic opacity-60 px-1 py-2">No cards</div>
      ) : (
        <div className="flex flex-wrap gap-2" role="row">
          {cards.map((c) => (
            <button
              key={c.id}
              role="gridcell"
              onClick={() => onSelect?.(c)}
              className="rounded-lg border border-slate-600 bg-slate-700/60 px-2 py-1 text-sm hover:bg-slate-700 active:translate-y-[1px]"
              title={`${c.name} [${c.type === "split" ? `${c.leftValue ?? ""}|${c.rightValue ?? ""}` : c.number ?? ""}]`}
              style={{ outline: `2px solid transparent`, outlineOffset: 0 }}
            >
              {c.name}{" "}
              {c.type === "split"
                ? `[${c.leftValue ?? "?"}|${c.rightValue ?? "?"}]`
                : `[${c.number ?? "?"}]`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
