import React, { useLayoutEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import type { Card, CorePhase } from "../../../game/types";

type HighlightRef = RefObject<HTMLElement | null> | RefObject<HTMLDivElement | null>;

type FirstRunCoachProps = {
  stage: number;
  show: boolean;
  infoPopoverRef: HighlightRef;
  handRef: RefObject<HTMLDivElement | null>;
  wheelRef: RefObject<HTMLDivElement | null>;
  resolveButtonRef: RefObject<HTMLButtonElement | null>;
  assigned: (Card | null)[];
  handCount: number;
  phase: CorePhase;
  onDismiss: () => void;
  onAdvance: () => void;
};

type CoachGeometry = {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
  viewportWidth: number;
  viewportHeight: number;
};

const getElement = (
  stage: number,
  refs: {
    handRef: RefObject<HTMLDivElement | null>;
    wheelRef: RefObject<HTMLDivElement | null>;
    resolveButtonRef: RefObject<HTMLButtonElement | null>;
    infoPopoverRef: HighlightRef;
  },
): HTMLElement | null => {
  if (stage === 0) return refs.handRef.current;
  if (stage === 1) return refs.wheelRef.current;
  if (stage === 2) return refs.resolveButtonRef.current ?? refs.infoPopoverRef.current;
  return null;
};

function toGeometry(target: HTMLElement | null): CoachGeometry | null {
  if (typeof window === "undefined" || !target) {
    return null;
  }
  const rect = target.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}

const STAGE_PADDING: Record<number, number> = {
  0: 18,
  1: 24,
  2: 14,
};

const FirstRunCoach: React.FC<FirstRunCoachProps> = ({
  stage,
  show,
  infoPopoverRef,
  handRef,
  wheelRef,
  resolveButtonRef,
  assigned,
  handCount,
  phase,
  onDismiss,
  onAdvance,
}) => {
  const [geometry, setGeometry] = useState<CoachGeometry | null>(null);

  useLayoutEffect(() => {
    if (!show) {
      setGeometry(null);
      return;
    }
    if (typeof window === "undefined") {
      return;
    }

    const update = () => {
      const target = getElement(stage, { handRef, wheelRef, resolveButtonRef, infoPopoverRef });
      setGeometry(toGeometry(target));
    };

    update();

    const handleResize = () => update();
    const handleScroll = () => update();

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);

    let resizeObserver: ResizeObserver | null = null;
    const target = getElement(stage, { handRef, wheelRef, resolveButtonRef, infoPopoverRef });
    if (typeof ResizeObserver !== "undefined" && target) {
      resizeObserver = new ResizeObserver(() => update());
      resizeObserver.observe(target);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [show, stage, handRef, wheelRef, resolveButtonRef, infoPopoverRef]);

  const assignedCount = useMemo(
    () => assigned.reduce((count, card) => (card ? count + 1 : count), 0),
    [assigned],
  );
  const totalSlots = assigned.length;
  const readyToResolve = stage >= 2 && phase === "choose";

  const stageCopy = useMemo(() => {
    if (stage === 0) {
      return {
        title: "Play a card",
        body:
          "Drag a card from your hand into a card slot beside any wheel to get started.",
        meta: handCount > 0 ? `${handCount} card${handCount === 1 ? "" : "s"} in hand` : undefined,
      };
    }
    if (stage === 1) {
      return {
        title: "Both players must fill each slot beside a wheel with a card.",
        body: `Each wheel uses the sum of both cards placed beside it to determine its winning Victory Condition for the round. Wheels generate randomized Victory Conditons each round. Slots filled: ${assignedCount}/${totalSlots}.`,
      };
    }
    if (stage === 2) {
      return {
        title: "Resolve the round",
        body: readyToResolve
          ? "Once you place 3 cards, press Resolve to spin each wheel and determine its winning condition. Check the Reference tab to see all Victory Conditons."
          : "Resolve becomes available once both sides finish assigning cards.",
      };
    }
    return null;
  }, [stage, assignedCount, totalSlots, handCount, readyToResolve]);

  if (!show || stage >= 3 || !stageCopy) {
    return null;
  }

  const padding = STAGE_PADDING[stage] ?? 16;
  const highlightStyle: React.CSSProperties | undefined = geometry
    ? {
        top: Math.max(8, geometry.top - padding),
        left: Math.max(8, geometry.left - padding),
        width: geometry.width + padding * 2,
        height: geometry.height + padding * 2,
        borderRadius: stage === 1 ? 20 : 14,
        boxShadow: "0 0 0 9999px rgba(10, 12, 22, 0.68)",
        border: "2px solid rgba(16, 185, 129, 0.7)",
      }
    : undefined;

  const viewportWidth = geometry?.viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1024);
  const viewportHeight = geometry?.viewportHeight ?? (typeof window !== "undefined" ? window.innerHeight : 768);
  const anchorCenter = geometry ? geometry.left + geometry.width / 2 : viewportWidth / 2;
  const belowSpace = geometry ? geometry.viewportHeight - geometry.bottom : viewportHeight;
  const preferBelow = belowSpace > 220;
  const calloutTop = geometry
    ? preferBelow
      ? Math.min(geometry.bottom + 18, viewportHeight - 180)
      : Math.max(16, geometry.top - 180)
    : viewportHeight * 0.25;
  const calloutLeft = Math.min(Math.max(anchorCenter, 160), viewportWidth - 160);

  const calloutStyle: React.CSSProperties = {
    top: calloutTop,
    left: calloutLeft,
    transform: "translateX(-50%)",
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]" aria-hidden={!show}>
      <div className="absolute inset-0 bg-slate-950/55" />
      {highlightStyle ? (
        <div
          className="absolute transition-all duration-200 ease-out"
          style={{ ...highlightStyle, pointerEvents: "none" }}
        />
      ) : null}
      <div className="absolute w-full max-w-xs px-2" style={calloutStyle}>
        <div className="pointer-events-auto rounded-xl border border-emerald-400/70 bg-slate-900/95 p-4 text-sm shadow-xl">
          <div className="text-emerald-200 text-sm font-semibold">{stageCopy.title}</div>
          <p className="mt-2 text-slate-200 text-[13px] leading-relaxed">{stageCopy.body}</p>
          {stageCopy.meta ? (
            <div className="mt-2 text-xs uppercase tracking-wide text-emerald-300/80">{stageCopy.meta}</div>
          ) : null}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex items-center justify-center rounded border border-emerald-400/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100"
            >
              Skip tutorial
            </button>
            <button
              type="button"
              onClick={onAdvance}
              className="inline-flex items-center justify-center rounded bg-emerald-400/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-950 transition hover:bg-emerald-300"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FirstRunCoach;
