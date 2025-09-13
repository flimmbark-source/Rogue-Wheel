import React from "react";
import { motion } from "framer-motion";

export default function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-indigo-900 via-indigo-800 to-indigo-900 text-slate-100">
      <motion.img
        src="/rogue-wheel-logo.png"
        alt="Rogue Wheel"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 120, damping: 12 }}
        className="w-[320px] max-w-[80%] drop-shadow-[0_4px_12px_rgba(255,255,255,0.25)]"
      />

      <motion.button
        initial={{ y: 32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        onClick={onStart}
        className="mt-10 rounded-2xl bg-amber-400/90 px-10 py-4 text-lg font-semibold text-amber-900 shadow-lg hover:bg-amber-300"
      >
        Play
      </motion.button>
    </div>
  );
}
