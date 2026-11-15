import type {
  BrushStyle,
  EraserStyle,
  FigureFillMode,
  FigureShape,
} from "../types";

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
 * Deterministic screentone / dry-stipple pixel mask for Spectra 6 optical mixing.
 * - tone25: 25% coverage (1 of 4 2x2 blocks)
 * - halftone: 50% coverage (2x2 checkerboard)
 * - tone75: 75% coverage (3 of 4 2x2 blocks)
 * - pencil: ~60% deterministic hash stipple
 */
export function shouldPaintTonePixel(
  x: number,
  y: number,
  style: "tone25" | "halftone" | "tone75" | "pencil"
): boolean {
  if (style === "halftone") {
    return shouldPaintHalftonePixel(x, y);
  }
  if (style === "tone25") {
    const bx = Math.floor(x / 2) & 1;
    const by = Math.floor(y / 2) & 1;
    return bx === 0 && by === 0;
  }
  if (style === "tone75") {
    const bx = Math.floor(x / 2) & 1;
    const by = Math.floor(y / 2) & 1;
    return !(bx === 1 && by === 1);
  }
  const h = (((Math.floor(x) * 73856093) ^ (Math.floor(y) * 19349663)) >>> 0) % 5;
  return h < 3;
}

/**
 * C1-continuous quadratic Bézier stroke interpolator with optional EMA stabilization,
 * coalesced-point support, velocity/pressure dynamics, and dense equidistant stamp emission.
 */
export class StrokeSmoother {
  private readonly baseSize: number;
  private readonly style: BrushStyle | "eraser";
  private readonly stabilization: number;
  private readonly taper: boolean;
  private prevPt: StrokeInputPoint | null = null;
  private lastMid: { x: number; y: number } | null = null;
  private lastRawPt: StrokeInputPoint | null = null;
  private smoothedRadius: number;

  constructor(
    brushSize: number,
    style: BrushStyle | "eraser" = "pen",
    options?: { stabilization?: number; taper?: boolean }
  ) {
    this.baseSize = Math.max(1, brushSize);
    this.style = style;
    this.stabilization = clamp(options?.stabilization ?? 0, 0, 10);
    this.taper = options?.taper ?? true;
    this.smoothedRadius = this.baseSize / 2;
  }

  private computeTargetRadius(
    prev: StrokeInputPoint | null,
    curr: StrokeInputPoint
  ): number {
    const baseRadius = this.baseSize / 2;
    if (this.style !== "pen" || !this.taper) {
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
    this.lastRawPt = pt;
    this.lastMid = { x: pt.x, y: pt.y };
    return [{ x: pt.x, y: pt.y, radius: initialRadius }];
  }

  public addPoint(pt: StrokeInputPoint): StampPoint[] {
    if (!this.prevPt || !this.lastMid) {
      return this.startStroke(pt);
    }

    this.lastRawPt = pt;

    let effectivePt = pt;
    if (this.stabilization > 0) {
      const alpha = clamp(1 - this.stabilization * 0.075, 0.22, 1);
      effectivePt = {
        ...pt,
        x: this.prevPt.x + (pt.x - this.prevPt.x) * alpha,
        y: this.prevPt.y + (pt.y - this.prevPt.y) * alpha,
      };
    }

    const prevRadius = this.smoothedRadius;
    const targetRadius = this.computeTargetRadius(this.prevPt, effectivePt);
    const nextRadius = prevRadius * 0.72 + targetRadius * 0.28;
    this.smoothedRadius = nextRadius;

    const mid = {
      x: (this.prevPt.x + effectivePt.x) / 2,
      y: (this.prevPt.y + effectivePt.y) / 2,
    };

    const stamps = this.sampleQuadratic(
      this.lastMid,
      this.prevPt,
      mid,
      prevRadius,
      nextRadius
    );

    this.lastMid = mid;
    this.prevPt = effectivePt;
    return stamps;
  }

  public finishStroke(): StampPoint[] {
    if (!this.prevPt || !this.lastMid) return [];
    const endTarget =
      this.stabilization > 0 && this.lastRawPt ? this.lastRawPt : this.prevPt;
    const dist = Math.hypot(
      endTarget.x - this.lastMid.x,
      endTarget.y - this.lastMid.y
    );
    if (dist < 0.1) {
      this.prevPt = null;
      this.lastMid = null;
      this.lastRawPt = null;
      return [];
    }

    const ctrl =
      this.stabilization > 0 && this.lastRawPt ? this.prevPt : this.lastMid;

    const stamps = this.sampleQuadratic(
      this.lastMid,
      ctrl,
      endTarget,
      this.smoothedRadius,
      this.smoothedRadius
    );
    this.prevPt = null;
    this.lastMid = null;
    this.lastRawPt = null;
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

const tonePatternCache = new Map<string, CanvasPattern>();

function getTonePattern(
  ctx: CanvasRenderingContext2D,
  style: "tone25" | "halftone" | "tone75" | "pencil",
  colorHex: string,
  subColorHex?: string | null
): CanvasPattern | string {
  const key = `${style}:${colorHex}:${subColorHex ?? "none"}`;
  const cached = tonePatternCache.get(key);
  if (cached) return cached;
  if (typeof document === "undefined") return colorHex;

  const tileSize = style === "pencil" ? 16 : 4;
  const tile = document.createElement("canvas");
  tile.width = tileSize;
  tile.height = tileSize;
  const tctx = tile.getContext("2d");
  if (!tctx) return colorHex;

  tctx.clearRect(0, 0, tileSize, tileSize);
  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      if (shouldPaintTonePixel(x, y, style)) {
        tctx.fillStyle = colorHex;
        tctx.fillRect(x, y, 1, 1);
      } else if (subColorHex) {
        tctx.fillStyle = subColorHex;
        tctx.fillRect(x, y, 1, 1);
      }
    }
  }

  const pattern = ctx.createPattern(tile, "repeat");
  if (pattern) {
    tonePatternCache.set(key, pattern);
    return pattern;
  }
  return colorHex;
}

function isPatternBrushStyle(
  style: BrushStyle | "eraser"
): style is "tone25" | "halftone" | "tone75" | "pencil" {
  return (
    style === "tone25" ||
    style === "halftone" ||
    style === "tone75" ||
    style === "pencil"
  );
}

/**
 * Renders interpolated brush stamps onto a Canvas2D context.
 */
export function renderStampsToContext(
  ctx: CanvasRenderingContext2D,
  stamps: StampPoint[],
  style: BrushStyle | "eraser",
  colorHex: string,
  isEraser: boolean,
  renderOpts?: { subColorHex?: string | null; eraserStyle?: EraserStyle }
): void {
  if (stamps.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";

  if (isEraser) {
    ctx.fillStyle =
      renderOpts?.eraserStyle === "kneaded"
        ? getTonePattern(ctx, "halftone", "#000000", null)
        : "#000000";
  } else if (isPatternBrushStyle(style)) {
    const subHex = style === "pencil" ? null : renderOpts?.subColorHex ?? null;
    ctx.fillStyle = getTonePattern(ctx, style, colorHex, subHex);
  } else {
    ctx.fillStyle = colorHex;
  }

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
 * Constrains shape end coordinates when Shift-constrain is active:
 * - line: snaps to 15-degree increments
 * - box shapes: locks 1:1 square aspect ratio
 */
export function constrainShapePoints(
  mode: FigureShape,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  shiftConstrain: boolean
): { x: number; y: number } {
  if (!shiftConstrain) return p1;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;

  if (mode === "line") {
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) return p1;
    const rawAngle = Math.atan2(dy, dx);
    const step = Math.PI / 12; // 15 deg
    const snapped = Math.round(rawAngle / step) * step;
    return {
      x: p0.x + Math.cos(snapped) * dist,
      y: p0.y + Math.sin(snapped) * dist,
    };
  }

  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: p0.x + (dx >= 0 ? side : -side),
    y: p0.y + (dy >= 0 ? side : -side),
  };
}

/**
 * Draws crisp vector geometric, heart, or star shapes on a Canvas2D context.
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  mode: FigureShape,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  brushSize: number,
  colorHex: string,
  shapeOpts?: {
    fillMode?: FigureFillMode;
    fillColorHex?: string;
    shiftConstrain?: boolean;
    isEraser?: boolean;
    toneStyle?: "solid" | "tone25" | "halftone" | "tone75";
    subColorHex?: string | null;
  }
): void {
  const endPt = constrainShapePoints(
    mode,
    p0,
    p1,
    Boolean(shapeOpts?.shiftConstrain)
  );
  const fillMode: FigureFillMode =
    mode === "line" ? "stroke" : shapeOpts?.fillMode ?? "stroke";
  const isEraser = Boolean(shapeOpts?.isEraser);
  const toneStyle = shapeOpts?.toneStyle ?? "solid";
  const strokePaint = isEraser
    ? "#000000"
    : toneStyle !== "solid"
    ? getTonePattern(ctx, toneStyle, colorHex, shapeOpts?.subColorHex ?? null)
    : colorHex;
  const fillRawHex = shapeOpts?.fillColorHex ?? colorHex;
  const fillPaint = isEraser
    ? "#000000"
    : toneStyle !== "solid"
    ? getTonePattern(ctx, toneStyle, fillRawHex, shapeOpts?.subColorHex ?? null)
    : fillRawHex;

  ctx.save();
  ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
  ctx.strokeStyle = strokePaint;
  ctx.fillStyle = fillPaint;
  ctx.lineWidth = brushSize;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (mode === "line") {
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(endPt.x, endPt.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const minX = Math.min(p0.x, endPt.x);
  const maxX = Math.max(p0.x, endPt.x);
  const minY = Math.min(p0.y, endPt.y);
  const maxY = Math.max(p0.y, endPt.y);
  const w = maxX - minX;
  const h = maxY - minY;

  ctx.beginPath();
  if (mode === "rect") {
    ctx.rect(minX, minY, w, h);
  } else if (mode === "circle") {
    ctx.ellipse(
      minX + w / 2,
      minY + h / 2,
      Math.max(1, w / 2),
      Math.max(1, h / 2),
      0,
      0,
      Math.PI * 2
    );
  } else if (mode === "heart") {
    const cx = minX + w / 2;
    const topY = minY + h * 0.28;
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
  } else if (mode === "star") {
    const cx = minX + w / 2;
    const cy = minY + h / 2;
    const rxOuter = Math.max(2, w / 2);
    const ryOuter = Math.max(2, h / 2);
    const rxInner = rxOuter * 0.42;
    const ryInner = ryOuter * 0.42;
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const rx = i % 2 === 0 ? rxOuter : rxInner;
      const ry = i % 2 === 0 ? ryOuter : ryInner;
      const px = cx + Math.cos(angle) * rx;
      const py = cy + Math.sin(angle) * ry;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  if (fillMode === "fill" || fillMode === "both") {
    ctx.fill();
  }
  if (fillMode === "stroke" || fillMode === "both") {
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Combines alpha channels across multiple visible reference layers so
 * Fill Bucket ("Refer All Layers") stops at lineart drawn on other layers.
 */
export function mergeBoundaryBuffers(
  buffers: Array<Uint8ClampedArray | null | undefined>
): Uint8ClampedArray | undefined {
  const valid = buffers.filter(
    (b): b is Uint8ClampedArray => Boolean(b && b.length > 0)
  );
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];

  const len = valid[0].length;
  const out = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i += 4) {
    let maxA = 0;
    for (let k = 0; k < valid.length; k++) {
      const a = valid[k][i + 3];
      if (a > maxA) maxA = a;
    }
    out[i + 3] = maxA;
  }
  return out;
}

/**
 * Fast typed-array BFS flood fill for paint-bucket tool.
 * Respects both existing ink pixels, optional multi-layer boundary pixels,
 * and optional 2-color halftone/screentone fill patterns.
 */
export function floodFillBuffer(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  fillRgba: [number, number, number, number],
  boundaryData?: Uint8ClampedArray,
  patternOpts?: {
    mode: "solid" | "tone25" | "halftone" | "tone75";
    secondaryRgba?: [number, number, number, number] | null;
  }
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
  const patternMode = patternOpts?.mode ?? "solid";

  if (
    patternMode === "solid" &&
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
    const x = pos % width;
    const y = (pos - x) / width;

    if (patternMode === "solid") {
      data[i] = fr;
      data[i + 1] = fg;
      data[i + 2] = fb;
      data[i + 3] = fa;
    } else if (shouldPaintTonePixel(x, y, patternMode)) {
      data[i] = fr;
      data[i + 1] = fg;
      data[i + 2] = fb;
      data[i + 3] = fa;
    } else if (patternOpts?.secondaryRgba) {
      const [sr, sg, sb, sa] = patternOpts.secondaryRgba;
      data[i] = sr;
      data[i + 1] = sg;
      data[i + 2] = sb;
      data[i + 3] = sa;
    }

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
