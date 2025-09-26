import type { ReactNode } from "react";

interface LoadingScreenProps {
  children?: ReactNode;
}

export default function LoadingScreen({ children }: LoadingScreenProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black text-white p-6 text-center">
      <img
        src="/rotogo_snap_logo_2.png"
        alt="RotoGo Snap logo"
        className="w-48 max-w-[60vw] h-auto"
      />
      {children ? <div className="mt-6 space-y-3 text-sm text-white/80">{children}</div> : null}
    </div>
  );
}
