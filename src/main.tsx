import React from 'react';
import ReactDOM from 'react-dom/client';
import AppShell from './AppShell';
import './index.css';

// Entry point for the Rogue Wheel app.  Instead of mounting the
// original App component directly, we mount our AppShell wrapper.
// The AppShell displays a simple title screen before revealing the
// main game UI, which helps give the prototype a more video‑game like
// feel without altering any game logic.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>
);
