import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import HubRoute from "./HubRoute";

export default function AppShell() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HubRoute />} />
        <Route path="/game" element={<App />} />
      </Routes>
    </BrowserRouter>
  );
}
