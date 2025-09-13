import React from 'react';

/**
 * TitleScreen presents a simple landing view with the game title and a play
 * button.  When the button is clicked it calls the provided `onStart`
 * callback to notify the parent that the player wishes to begin.  Styling
 * makes use of Tailwind utility classes for a clean, responsive layout.
 */
export default function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <h1 className="text-5xl font-extrabold tracking-wide mb-3 drop-shadow-lg">
        Rogue Wheel
      </h1>
      <p className="mb-6 text-center text-slate-300 max-w-md">
        Lighthearted fantasy. Spin, draft, triumph.
      </p>
      <button
        onClick={onStart}
        className="mt-2 rounded-2xl bg-amber-400/90 px-8 py-3 font-semibold text-amber-900 shadow-md hover:bg-amber-300"
      >
        Play
      </button>
    </div>
  );
}
