import React, { useState } from "react";
import RogueWheelHub from "../ui/RogueWheelHub";
import App from "./App"; // your existing game component (default export)

export default function AppShell() {
  const [showTitle, setShowTitle] = useState(true);

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-indigo-900 via-indigo-800 to-indigo-900 text-slate-100">
      {showTitle ? <RogueWheelHub onPlay={() => setShowTitle(false)} /> : <App />}
    </div>
  );
}
