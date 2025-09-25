// src/components/CanvasWheel.tsx
import React, { forwardRef, memo, useEffect, useImperativeHandle, useRef } from "react";
import { SLICES, Section } from "../game/types";
import { inSection, polar } from "../game/math";
import { VC_META } from "../game/wheel";

export type WheelHandle = { setVisualToken: (slice: number) => void };
type CanvasWheelProps = { sections: Section[]; size: number; onTapAssign?: () => void; };

const CanvasWheel = memo(forwardRef<WheelHandle, CanvasWheelProps>(
  ({ sections, size, onTapAssign }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const tokenElRef = useRef<HTMLDivElement | null>(null);
    const tokenSliceRef = useRef<number>(0);

    // Small safety margin and alignment offsets
    const CLIP_PAD = 3;
    const WHEEL_OFFSET_X = -8; // tweak to move left/right
    const WHEEL_OFFSET_Y = -1; // tweak to move up/down

    const drawBase = () => {
      const canvas = canvasRef.current; if (!canvas) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const cssW = Math.round(size), cssH = Math.round(size);

      // ensure backing store matches CSS size
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
      }

      const ctx = canvas.getContext("2d"); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // center & radius (with small clip pad)
      const centerX = cssW / 2 + WHEEL_OFFSET_X;
      const centerY = cssH / 2 + WHEEL_OFFSET_Y;
      const wheelR = cssW / 2 - (16 + CLIP_PAD);

      const angPer = 360 / SLICES;
      const sliceFill = (i: number) =>
        sections.find((s) => inSection(i, s))?.color ?? "#334155";

      ctx.clearRect(0, 0, cssW, cssH);

      for (let i = 0; i < SLICES; i++) {
        const startAng = (i * angPer - 90) * (Math.PI / 180);
        const endAng   = ((i + 1) * angPer - 90) * (Math.PI / 180);

        // slice
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, wheelR, startAng, endAng, false);
        ctx.closePath();
        ctx.fillStyle = i === 0 ? "#6b7280" : sliceFill(i);
        (ctx as any).globalAlpha = 0.9; ctx.fill(); (ctx as any).globalAlpha = 1;
        ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 1; ctx.stroke();

        // numbers
        const midAng = (i + 0.5) * angPer;
        const numPos = polar(centerX, centerY, wheelR * 0.6, midAng);
        ctx.fillStyle = i === 0 ? "#ffffff" : "#0f172a";
        ctx.font = "700 11px system-ui, -apple-system, Segoe UI, Roboto";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(i), numPos.x, numPos.y);

        // icons
        if (i !== 0) {
          const sec = sections.find((s) => inSection(i, s));
          if (sec) {
            const iconPos = polar(centerX, centerY, wheelR * 0.86, midAng);
            ctx.font = "12px system-ui, Apple Color Emoji, Segoe UI Emoji";
            ctx.fillStyle = "#ffffff";
            ctx.fillText(VC_META[sec.id].icon, iconPos.x, iconPos.y);
          }
        }
      }

      // re-place the token at the new center after redraw
      placeToken(tokenSliceRef.current);
    };

    // Move token imperatively (keeps React out of the loop)
    const placeToken = (slice: number) => {
      const el = tokenElRef.current; if (!el) return;
      const wheelR = size / 2 - (16 + CLIP_PAD);
      const angPer = 360 / SLICES;
      const tokenAng = (slice + 0.5) * angPer;

      // same center offsets as the drawing code
      const cx = size / 2 + WHEEL_OFFSET_X;
      const cy = size / 2 + WHEEL_OFFSET_Y;

      const pos = polar(cx, cy, wheelR * 0.94, tokenAng);
      const x = Math.round(pos.x - 7), y = Math.round(pos.y - 7);
      el.style.transform = `translate(${x}px, ${y}px)`;
    };

    // redraw base when size/sections change
    useEffect(() => { drawBase(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [size, sections]);

    // expose imperative API
    useImperativeHandle(ref, () => ({
      setVisualToken: (s: number) => { tokenSliceRef.current = s; placeToken(s); }
    }), [size]);

    return (
      <div
        onClick={onTapAssign}
        className="relative overflow-hidden rounded-full"
        style={{
          width: size,
          height: size,
          contain: 'paint',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden
          style={{ position: 'absolute', inset: 0, display: 'block' }}
        />
        <div
          ref={tokenElRef}
          aria-hidden
          style={{
            position: 'absolute',
            width: 14, height: 14, left: 0, top: 0,
            borderRadius: 9999,
            background: '#fff',
            border: '2px solid #0f172a',
            willChange: 'transform'
          }}
        />
      </div>
    );
  }
));
CanvasWheel.displayName = 'CanvasWheel';

export default CanvasWheel;
