import type { ReactNode } from "react";

const LOGO_PATH = "/rotogo_snap_logo_(2).PNG";

type LoadingScreenProps = {
  label?: string;
  children?: ReactNode;
};

export default function LoadingScreen({ label, children }: LoadingScreenProps) {
  return (
    <div className="min-h-dvh min-w-full bg-black text-white flex flex-col items-center justify-center gap-4 p-6">
      <img src={LOGO_PATH} alt="Rotogo Snap logo" className="w-40 max-w-[60vw]" />
      {label ? <p className="text-sm uppercase tracking-[0.2em] text-white/70">{label}</p> : null}
      {children}
    </div>
  );
}
