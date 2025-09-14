import React from "react";

export default function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <img
        src="/rogue-wheel-logo.png"
        alt="Rogue Wheel logo"
        className="mb-4 h-32 w-32"
      />
      <h1
        className="text-5xl font-extrabold drop-shadow-lg"
        style={{ textShadow: "0 4px 24px rgba(255,255,255,0.15)" }}
      >
        Rogue Wheel
      </h1>

      <p className="mt-3 text-slate-200/90">
        Lighthearted fantasy. Spin, draft, triumph.
      </p>

      <button
        onClick={onStart}
        className="mt-8 rounded-2xl bg-amber-400/90 px-8 py-3 font-semibold text-amber-900 shadow-lg hover:bg-amber-300"
      >
        Play
      </button>
    </div>
  );
}
