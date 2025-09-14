import React from "react";

function makeIcon(symbol: string) {
  return function Icon({ className }: { className?: string }) {
    return (
      <span className={className} role="img" aria-hidden style={{ display: "inline-block" }}>
        {symbol}
      </span>
    );
  };
}

export const PlayCircle = makeIcon("▶️");
export const Swords = makeIcon("⚔️");
export const Trophy = makeIcon("🏆");
export const BookOpen = makeIcon("📖");
export const Sparkles = makeIcon("✨");
export const Settings = makeIcon("⚙️");
export const User = makeIcon("👤");
export const RefreshCw = makeIcon("🔄");
export const Star = makeIcon("⭐");
export const Wand2 = makeIcon("🪄");
export const Info = makeIcon("ℹ️");
export const Power = makeIcon("⏻");
