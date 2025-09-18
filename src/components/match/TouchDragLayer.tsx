import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import StSCard from "../StSCard";
import type { Card } from "../../game/types";
import { MAX_WHEEL, MIN_WHEEL, calcWheelSize } from "../../game/match/wheelSizing";

type DropTarget = { kind: "wheel" | "slot"; idx: number };

type UseTouchDragLayerOptions = {
  active: readonly boolean[];
  assignToWheel: (index: number, card: Card) => void;
  setDragOverWheel: (index: number | null) => void;
  setDragCardId: (id: string | null) => void;
  setSelectedCardId: (id: string | null) => void;
};

type PointerPositionRef = MutableRefObject<{ x: number; y: number }>;

type CleanupFn = () => void;

export function useTouchDragLayer({
  active,
  assignToWheel,
  setDragOverWheel,
  setDragCardId,
  setSelectedCardId,
}: UseTouchDragLayerOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragCard, setDragCard] = useState<Card | null>(null);
  const pointerPosition = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const cleanupRef = useRef<CleanupFn | null>(null);
  const activeRef = useRef(active);
  const assignRef = useRef(assignToWheel);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    assignRef.current = assignToWheel;
  }, [assignToWheel]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const startPointerDrag = useCallback(
    (card: Card, event: React.PointerEvent) => {
      if (event.pointerType === "mouse") return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setSelectedCardId(card.id);
      setDragCardId(card.id);
      setDragCard(card);
      setIsDragging(true);
      pointerPosition.current = { x: event.clientX, y: event.clientY };
      addTouchDragCss(true);

      const handleMove = (ev: PointerEvent) => {
        pointerPosition.current = { x: ev.clientX, y: ev.clientY };
        const target = getDropTargetAt(ev.clientX, ev.clientY);
        setDragOverWheel(target && (target.kind === "wheel" || target.kind === "slot") ? target.idx : null);
        ev.preventDefault?.();
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove, listenerOptions);
        window.removeEventListener("pointerup", handleUp, listenerOptions);
        window.removeEventListener("pointercancel", handleCancel, listenerOptions);
        setIsDragging(false);
        setDragCard(null);
        setDragOverWheel(null);
        setDragCardId(null);
        addTouchDragCss(false);
      };

      const handleUp = (ev: PointerEvent) => {
        pointerPosition.current = { x: ev.clientX, y: ev.clientY };
        const target = getDropTargetAt(ev.clientX, ev.clientY);
        if (target && activeRef.current[target.idx]) {
          assignRef.current(target.idx, card);
        }
        cleanup();
      };

      const handleCancel = () => {
        cleanup();
      };

      cleanupRef.current = cleanup;

      window.addEventListener("pointermove", handleMove, listenerOptions);
      window.addEventListener("pointerup", handleUp, listenerOptions);
      window.addEventListener("pointercancel", handleCancel, listenerOptions);
    },
    [setDragCardId, setDragOverWheel, setSelectedCardId]
  );

  return { isDragging, dragCard, pointerPosition, startPointerDrag };
}

type TouchDragLayerProps = {
  dragCard: Card | null;
  isDragging: boolean;
  pointerPosition: PointerPositionRef;
};

export default function TouchDragLayer({ dragCard, isDragging, pointerPosition }: TouchDragLayerProps) {
  if (!isDragging || !dragCard) return null;

  const { x, y } = pointerPosition.current;

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        transform: `translate(${x - 48}px, ${y - 64}px)`,
        pointerEvents: "none",
        zIndex: 9999,
      }}
      aria-hidden
    >
      <div style={{ transform: "scale(0.9)", filter: "drop-shadow(0 6px 8px rgba(0,0,0,.35))" }}>
        <StSCard card={dragCard} showReserve={false} showName={false} />
      </div>
    </div>
  );
}

const listenerOptions = { passive: false, capture: true } as const;

function addTouchDragCss(on: boolean) {
  const root = document.documentElement;
  if (on) {
    (root as any).__prevTouchAction = root.style.touchAction;
    (root as any).__prevOverscroll = root.style.overscrollBehavior;
    root.style.touchAction = "none";
    root.style.overscrollBehavior = "contain";
  } else {
    root.style.touchAction = (root as any).__prevTouchAction ?? "";
    root.style.overscrollBehavior = (root as any).__prevOverscroll ?? "";
    delete (root as any).__prevTouchAction;
    delete (root as any).__prevOverscroll;
  }
}

function getDropTargetAt(x: number, y: number): DropTarget | null {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el) {
    const data = el.dataset;
    if (data.drop && data.idx) {
      if (data.drop === "wheel") return { kind: "wheel", idx: Number(data.idx) };
      if (data.drop === "slot") return { kind: "slot", idx: Number(data.idx) };
    }
    el = el.parentElement;
  }
  return null;
}
