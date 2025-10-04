// src/components/SpellDescription.tsx
import React from "react";

const normalizeNewlines = (s: string) => s.replace(/\\n/g, "\n");

export function SpellDescription({ text }: { text: string }) {
  return (
    <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
      {normalizeNewlines(text)}
    </pre>
  );
}
