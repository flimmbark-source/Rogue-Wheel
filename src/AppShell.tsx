import React, { useState } from 'react';
import TitleScreen from './ui/TitleScreen';
import App from './App';

/**
 * AppShell wraps the main game component and introduces a title screen.
 * On first load the player is greeted with the title and a “Play” button.
 * When they click play, the shell swaps in the existing game UI.  No
 * changes are made to the underlying App component, keeping the game
 * logic intact while adding a layer of polish.
 */
export default function AppShell() {
  const [showTitle, setShowTitle] = useState(true);
  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-indigo-900 via-indigo-800 to-indigo-900 text-slate-100">
      {showTitle ? (
        <TitleScreen onStart={() => setShowTitle(false)} />
      ) : (
        // Once the title screen is dismissed, render the original game.
        <App />
      )}
    </div>
  );
}
