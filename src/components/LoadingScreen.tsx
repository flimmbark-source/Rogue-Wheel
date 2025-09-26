import type { ReactNode } from "react";

const LOGO_SRC = "/assets/rogue-wheel-logo.png";

type LoadingScreenProps = {
  /** Optional message rendered under the logo. */
  message?: ReactNode;
  /** Additional content rendered below the message (e.g. retry buttons). */
  children?: ReactNode;
  /** Extra class names appended to the root element. */
  className?: string;
  /** Override the alt text used for the logo image. */
  logoAlt?: string;
};

export default function LoadingScreen({
  message,
  children,
  className = "",
  logoAlt = "Rogue Wheel logo",
}: LoadingScreenProps) {
  const classes = ["rw-loading-screen", className].filter(Boolean).join(" ");
  const ariaLabel = typeof message === "string" ? message : undefined;

  return (
    <div
      className={classes}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={ariaLabel ?? "Loading"}
    >
      <img
        src={LOGO_SRC}
        alt={logoAlt}
        className="rw-loading-screen__logo"
        draggable={false}
      />
      {message ? <div className="rw-loading-screen__message">{message}</div> : null}
      {children ? <div className="rw-loading-screen__extra">{children}</div> : null}
      {!message && <span className="sr-only">Loading</span>}
    </div>
  );
}
