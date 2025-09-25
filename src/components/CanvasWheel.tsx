// src/components/CanvasWheel.tsx
import React, { forwardRef, memo, useEffect, useImperativeHandle, useRef } from "react";
import { SLICES, Section } from "../game/types";
import { inSection, polar } from "../game/math";
import {
  VC_META,
  WHEEL_PALETTES,
  WHEEL_SHAPE_POINTS,
  type WheelPaletteMode,
  type WheelShape,
} from "../game/wheel";

export type WheelHandle = { setVisualToken: (slice: number) => void };
type CanvasWheelProps = {
  sections: Section[];
  size: number;
  onTapAssign?: () => void;
  paletteMode?: WheelPaletteMode;
};

const START_SLICE_COLOR = "#6b7280";
const DEFAULT_SLICE_FALLBACK = "#334155";
const TEXT_LIGHT = "#f8fafc";
const TEXT_DARK = "#020617";

const parseHexColor = (hex: string): [number, number, number] | null => {
  const normalized = hex.trim().replace("#", "");
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b];
  }
  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
};

const srgbToLinear = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const getLuminance = ([r, g, b]: [number, number, number]): number =>
  0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);

const getContrastRatio = (lumA: number, lumB: number): number =>
  (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);

const WHITE_LUMINANCE = 1; // luminance of pure white
const DARK_RGB = parseHexColor(TEXT_DARK);
const DARK_LUMINANCE = DARK_RGB ? getLuminance(DARK_RGB) : 0;

const chooseTextColor = (hexColor: string): string => {
  const rgb = parseHexColor(hexColor);
  if (!rgb) return TEXT_DARK;
  const luminance = getLuminance(rgb);
  const contrastLight = getContrastRatio(luminance, WHITE_LUMINANCE);
  const contrastDark = getContrastRatio(luminance, DARK_LUMINANCE);
  if (contrastLight >= contrastDark) return TEXT_LIGHT;
  return TEXT_DARK;
};

const drawShape = (
  ctx: CanvasRenderingContext2D,
  shape: WheelShape,
  x: number,
  y: number,
  size: number
) => {
  const pts = WHEEL_SHAPE_POINTS[shape];
  if (!pts) return;
  ctx.save();
  ctx.translate(x, y);
  const scale = size / 100;
  ctx.scale(scale, scale);
  const strokePx = Math.max(2.2, size * 0.18);
  ctx.lineWidth = strokePx / scale;
  ctx.lineJoin = "round";
  ctx.fillStyle = "rgba(15,23,42,0.88)";
  ctx.strokeStyle = "rgba(248,250,252,0.94)";
  ctx.shadowColor = "rgba(15,23,42,0.35)";
  ctx.shadowBlur = size * 0.08;
  ctx.beginPath();
  pts.forEach(([px, py], idx) => {
    const nx = px - 50;
    const ny = py - 50;
    if (idx === 0) ctx.moveTo(nx, ny);
    else ctx.lineTo(nx, ny);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

const CanvasWheel = memo(forwardRef<WheelHandle, CanvasWheelProps>(
  ({ sections, size, onTapAssign, paletteMode = "default" }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const tokenElRef = useRef<HTMLDivElement | null>(null);
    const tokenSliceRef = useRef<number>(0);

    // Small safety margin and alignment offsets
    const CLIP_PAD = 3;
    const WHEEL_OFFSET_X = -8; // tweak to move left/right
    const WHEEL_OFFSET_Y =  -1; // tweak to move up/down

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
      const palette = WHEEL_PALETTES[paletteMode] ?? WHEEL_PALETTES.default;
      const sliceFill = (i: number) => {
        const sec = sections.find((s) => inSection(i, s));
        if (!sec) return DEFAULT_SLICE_FALLBACK;
        return palette[sec.id] ?? sec.color ?? DEFAULT_SLICE_FALLBACK;
      };

      ctx.clearRect(0, 0, cssW, cssH);

      for (let i = 0; i < SLICES; i++) {
        const startAng = (i * angPer - 90) * (Math.PI / 180);
        const endAng   = ((i + 1) * angPer - 90) * (Math.PI / 180);

        // slice
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, wheelR, startAng, endAng, false);
        ctx.closePath();
        const fillColor = i === 0 ? START_SLICE_COLOR : sliceFill(i);
        ctx.fillStyle = fillColor;
        (ctx as any).globalAlpha = 0.9; ctx.fill(); (ctx as any).globalAlpha = 1;
        ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 1; ctx.stroke();

        // numbers
        const midAng = (i + 0.5) * angPer;
        const numPos = polar(centerX, centerY, wheelR * 0.6, midAng);
        const textColor = chooseTextColor(fillColor);
        const fontPx = Math.max(12, Math.round(size * 0.09));
        const font = `600 ${fontPx}px "Roboto Flex", "Inter var", "Inter", "system-ui", -apple-system`;
        ctx.font = font;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const outlineColor = textColor === TEXT_LIGHT ? "rgba(15,23,42,0.7)" : "rgba(248,250,252,0.85)";
        const outlineWidth = Math.max(0.75, fontPx * 0.1);
        ctx.lineJoin = "round";
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = outlineWidth;
        ctx.strokeText(String(i), numPos.x, numPos.y);
        ctx.fillStyle = textColor;
        ctx.fillText(String(i), numPos.x, numPos.y);

        // icons
        if (i !== 0) {
          const sec = sections.find((s) => inSection(i, s));
          if (sec) {
            const iconPos = polar(centerX, centerY, wheelR * 0.86, midAng);
            const shape = VC_META[sec.id]?.shape;
            if (shape) {
              const iconSize = Math.min(32, Math.max(18, wheelR * 0.32));
              drawShape(ctx, shape, iconPos.x, iconPos.y, iconSize);
            }
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
    useEffect(() => {
      drawBase();
      if (typeof document !== "undefined" && "fonts" in document) {
        let cancelled = false;
        void (document.fonts as FontFaceSet)
          .load('600 16px "Roboto Flex"')
          .then(() => {
            if (!cancelled) drawBase();
          })
          .catch(() => {});
        return () => {
          cancelled = true;
        };
      }
      return undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [size, sections, paletteMode]);

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
