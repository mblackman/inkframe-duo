import type { BrushStyle, DrawMode } from "../types";

export interface StrokeInputPoint {
  x: number;
  y: number;
  time: number;
  pressure?: number;
  pointerType?: string;
}

export interface StampPoint {
  x: number;
  y: number;
  radius: number;
}

function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

/**
 * Deterministic 2x2 checkerboard halftone pattern helper.
 * Optically mixes two Spectra e-ink pigments at ~50% density.
 */
export function shouldPaintHalftonePixel(x: number, y: number): boolean {
  const bx = Math.floor(x / 2) & 1;
  const by = Math.floor(y / 2) & 1;
  return (bx ^ by) === 0;
}

/**
 * C1-continuous quadratic Bézier stroke interpolator with coalesced-point support,
 * velocity/pressure dynamics, and dense equidistant stamp emission so fast movement
 * never creates gaps.
 */
export class StrokeSmoother {
  private readonly baseSize: number;
  private readonly style: BrushStyle | "eraser";
  private prevPt: StrokeInputPoint | null = null;
  private lastMid: { x: number; y: number } | null = null;
  private smoothedRadius: number;

  constructor(brushSize: number, style: BrushStyle | "eraser" = "pen") {
    this.baseSize = Math.max(1, brushSize);
    this.style = style;
    this.smoothedRadius = this.baseSize / 2;
  }

  private computeTargetRadius(
    prev: StrokeInputPoint | null,
    curr: StrokeInputPoint
  ): number {
    const baseRadius = this.baseSize / 2;
    if (this.style !== "pen") {
      return baseRadius;
    }

    // Use native stylus pressure when reported (non-default mouse 0.5 / 0 values)
    const p = curr.pressure;
    if (
      curr.pointerType === "pen" &&
      typeof p === "number" &&
      p > 0.01 &&
      p < 0.99 &&
      Math.abs(p - 0.5) > 0.02
    ) {
      return clamp(baseRadius * (0.45 + p * 1.1), 0.75, baseRadius * 1.5);
    }

    if (!prev) {
      return baseRadius;
    }

    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const dt = Math.max(1, curr.time - prev.time);
    const speed = Math.hypot(dx, dy) / dt;
    const widthFactor = clamp(1.25 - speed * 0.12, 0.55, 1.35);
    return baseRadius * widthFactor;
  }

  public startStroke(pt: StrokeInputPoint): StampPoint[] {
    const initialRadius = this.computeTargetRadius(null, pt);
    this.smoothedRadius = initialRadius;
    this.prevPt = pt;
    this.lastMid = { x: pt.x, y: pt.y };
    return [{ x: pt.x, y: pt.y, radius: initialRadius }];
  }

  public addPoint(pt: StrokeInputPoint): StampPoint[] {
    if (!this.prevPt || !this.lastMid) {
      return this.startStroke(pt);
    }

    const prevRadius = this.smoothedRadius;
    const targetRadius = this.computeTargetRadius(this.prevPt, pt);
    const nextRadius = prevRadius * 0.72 + targetRadius * 0.28;
    this.smoothedRadius = nextRadius;

    const mid = {
      x: (this.prevPt.x + pt.x) / 2,
      y: (this.prevPt.y + pt.y) / 2,
    };

    const stamps = this.sampleQuadratic(
      this.lastMid,
      this.prevPt,
      mid,
      prevRadius,
      nextRadius
    );

    this.lastMid = mid;
    this.prevPt = pt;
    return stamps;
  }

  public finishStroke(): StampPoint[] {
    if (!this.prevPt || !this.lastMid) return [];
    const dist = Math.hypot(
      this.prevPt.x - this.lastMid.x,
      this.prevPt.y - this.lastMid.y
    );
    if (dist < 0.1) {
      this.prevPt = null;
      this.lastMid = null;
      return [];
    }

    const stamps = this.sampleQuadratic(
      this.lastMid,
      this.lastMid,
      this.prevPt,
      this.smoothedRadius,
      this.smoothedRadius
    );
    this.prevPt = null;
    this.lastMid = null;
    return stamps;
  }

  private sampleQuadratic(
    p0: { x: number; y: number },
    ctrl: { x: number; y: number },
    p2: { x: number; y: number },
    r0: number,
    r1: number
  ): StampPoint[] {
    const polyLen =
      Math.hypot(ctrl.x - p0.x, ctrl.y - p0.y) +
      Math.hypot(p2.x - ctrl.x, p2.y - ctrl.y);
    if (polyLen < 0.05) {
      return [];
    }

    const minR = Math.min(r0, r1);
    const maxStep = Math.min(1.5, Math.max(0.65, minR * 0.35));
    const steps = Math.max(1, Math.ceil(polyLen / maxStep));

    const out: StampPoint[] = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const omt = 1 - t;
      const x = omt * omt * p0.x + 2 * omt * t * ctrl.x + t * t * p2.x;
      const y = omt * omt * p0.y + 2 * omt * t * ctrl.y + t * t * p2.y;
      const radius = r0 + (r1 - r0) * t;
      out.push({ x, y, radius });
    }
    return out;
  }
}

const halftonePatternCache = new Map<string, CanvasPattern>();

function getHalftonePattern(
  ctx: CanvasRenderingContext2D,
  colorHex: string
): CanvasPattern | string {
  const cached = halftonePatternCache.get(colorHex);
  if (cached) return cached;
  if (typeof document === "undefined") return colorHex;

  const tile = document.createElement("canvas");
  tile.width = 4;
  tile.height = 4;
  const tctx = tile.getContext("2d");
  if (!tctx) return colorHex;

  tctx.clearRect(0, 0, 4, 4);
  tctx.fillStyle = colorHex;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (shouldPaintHalftonePixel(x, y)) {
        tctx.fillRect(x, y, 1, 1);
      }
    }
  }

  const pattern = ctx.createPattern(tile, "repeat");
  if (pattern) {
    halftonePatternCache.set(colorHex, pattern);
    return pattern;
  }
  return colorHex;
}

/**
 * Renders interpolated brush stamps onto a Canvas2D context.
 */
export function renderStampsToContext(
  ctx: CanvasRenderingContext2D,
  stamps: StampPoint[],
  style: BrushStyle | "eraser",
  colorHex: string,
  isEraser: boolean
): void {
  if (stamps.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
  ctx.fillStyle =
    !isEraser && style === "halftone"
      ? getHalftonePattern(ctx, colorHex)
      : colorHex;

  if (style === "calligraphy" && !isEraser) {
    const angle = -Math.PI / 5; // -36 deg chisel angle
    for (let i = 0; i < stamps.length; i++) {
      const s = stamps[i];
      const rx = Math.max(1.5, s.radius * 1.45);
      const ry = Math.max(0.8, s.radius * 0.36);
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, rx, ry, angle, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    for (let i = 0; i < stamps.length; i++) {
      const s = stamps[i];
      ctx.moveTo(s.x + s.radius, s.y);
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Draws crisp vector geometric or heart shapes on a Canvas2D context.
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  mode: Exclude<DrawMode, "freehand" | "fill">,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  brushSize: number,
  colorHex: string
): void {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = colorHex;
  ctx.lineWidth = brushSize;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (mode === "line") {
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const minX = Math.min(p0.x, p1.x);
  const maxX = Math.max(p0.x, p1.x);
  const minY = Math.min(p0.y, p1.y);
  const maxY = Math.max(p0.y, p1.y);
  const w = maxX - minX;
  const h = maxY - minY;

  if (mode === "rect") {
    ctx.beginPath();
    ctx.rect(minX, minY, w, h);
    ctx.stroke();
  } else if (mode === "circle") {
    ctx.beginPath();
    ctx.ellipse(
      minX + w / 2,
      minY + h / 2,
      Math.max(1, w / 2),
      Math.max(1, h / 2),
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
  } else if (mode === "heart") {
    const cx = minX + w / 2;
    const topY = minY + h * 0.28;
    ctx.beginPath();
    ctx.moveTo(cx, maxY);
    ctx.bezierCurveTo(
      minX - w * 0.08,
      minY + h * 0.62,
      minX,
      minY + h * 0.05,
      cx,
      topY
    );
    ctx.bezierCurveTo(
      maxX,
      minY + h * 0.05,
      maxX + w * 0.08,
      minY + h * 0.62,
      cx,
      maxY
    );
    ctx.closePath();
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Fast typed-array BFS flood fill for paint-bucket tool.
 * Respects both existing ink pixels and optional boundary pixels (e.g., stationery lines).
 */
export function floodFillBuffer(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  fillRgba: [number, number, number, number],
  boundaryData?: Uint8ClampedArray
): boolean {
  const sx = Math.round(startX);
  const sy = Math.round(startY);
  if (sx < 0 || sx >= width || sy < 0 || sy >= height) return false;

  const startPos = sy * width + sx;
  const startByte = startPos * 4;

  if (boundaryData && boundaryData[startByte + 3] >= 96) {
    return false;
  }

  const tr = data[startByte];
  const tg = data[startByte + 1];
  const tb = data[startByte + 2];
  const ta = data[startByte + 3];

  const [fr, fg, fb, fa] = fillRgba;
  if (
    Math.abs(tr - fr) <= 4 &&
    Math.abs(tg - fg) <= 4 &&
    Math.abs(tb - fb) <= 4 &&
    Math.abs(ta - fa) <= 4
  ) {
    return false;
  }

  const tolerance = 36;
  const matchesTarget = (pos: number): boolean => {
    const i = pos * 4;
    if (boundaryData && boundaryData[i + 3] >= 96) {
      return false;
    }
    const a = data[i + 3];
    if (ta < 32 && a < 32) return true;
    return (
      Math.abs(data[i] - tr) <= tolerance &&
      Math.abs(data[i + 1] - tg) <= tolerance &&
      Math.abs(data[i + 2] - tb) <= tolerance &&
      Math.abs(a - ta) <= tolerance
    );
  };

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  queue[tail++] = startPos;
  visited[startPos] = 1;

  while (head < tail) {
    const pos = queue[head++];
    const i = pos * 4;
    data[i] = fr;
    data[i + 1] = fg;
    data[i + 2] = fb;
    data[i + 3] = fa;

    const x = pos % width;
    const y = (pos - x) / width;

    if (x > 0) {
      const n = pos - 1;
      if (!visited[n] && matchesTarget(n)) {
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
    if (x < width - 1) {
      const n = pos + 1;
      if (!visited[n] && matchesTarget(n)) {
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
    if (y > 0) {
      const n = pos - width;
      if (!visited[n] && matchesTarget(n)) {
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
    if (y < height - 1) {
      const n = pos + width;
      if (!visited[n] && matchesTarget(n)) {
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
  }

  return true;
}
