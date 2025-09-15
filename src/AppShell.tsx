import React, { useState } from "react";
import App from "./App";
import HubRoute from "./HubRoute";

export default function AppShell() {
  const [view, setView] = useState<"hub" | "game">("hub");
  return view === "hub" ? (
    <HubRoute onStart={() => setView("game")} />
  ) : (
    <App />
  );
}
