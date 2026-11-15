import type { CollageLayoutId, ImageLayer } from "../types";

export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 480;

export interface TransformableBox {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
}

export type HandleKind =
  | "move"
  | "nw"
  | "ne"
  | "se"
  | "sw"
  | "rotate"
  | "crop-n"
  | "crop-s"
  | "crop-w"
  | "crop-e";

/**
 * Maps client pointer coordinates into 800x480 canvas coordinates,
 * accounting for viewport zoom, pan, and horizontal Mirror View flip.
 */
export function screenRectToCanvasPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  viewFlipX = false
): { x: number; y: number } {
  const normX = (clientX - rect.left) / Math.max(1, rect.width);
  const normY = (clientY - rect.top) / Math.max(1, rect.height);
  return {
    x: (viewFlipX ? 1 - normX : normX) * CANVAS_WIDTH,
    y: normY * CANVAS_HEIGHT,
  };
}

export function worldToLocal(
  px: number,
  py: number,
  box: TransformableBox
): { x: number; y: number } {
  const dx = px - box.x;
  const dy = py - box.y;
  const cos = Math.cos(-box.rotation);
  const sin = Math.sin(-box.rotation);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  const safeScale = box.scale || 1;
  return {
    x: rx / safeScale,
    y: ry / safeScale,
  };
}

export function localToWorld(
  lx: number,
  ly: number,
  box: TransformableBox
): { x: number; y: number } {
  const sx = lx * box.scale;
  const sy = ly * box.scale;
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  return {
    x: box.x + sx * cos - sy * sin,
    y: box.y + sx * sin + sy * cos,
  };
}

export function getLayerCorners(
  box: TransformableBox
): Array<{ x: number; y: number }> {
  const hw = box.width / 2;
  const hh = box.height / 2;
  return [
    localToWorld(-hw, -hh, box), // nw
    localToWorld(hw, -hh, box), // ne
    localToWorld(hw, hh, box), // se
    localToWorld(-hw, hh, box), // sw
  ];
}

export function getRotationHandlePos(
  box: TransformableBox,
  offsetPx = 28
): { x: number; y: number } {
  const safeScale = Math.max(0.15, box.scale);
  return localToWorld(0, -box.height / 2 - offsetPx / safeScale, box);
}

export function hitTestBox(
  px: number,
  py: number,
  box: TransformableBox,
  padding = 4
): boolean {
  const local = worldToLocal(px, py, box);
  const safeScale = Math.max(0.15, box.scale);
  const padLocal = padding / safeScale;
  const hw = box.width / 2 + padLocal;
  const hh = box.height / 2 + padLocal;
  return (
    local.x >= -hw && local.x <= hw && local.y >= -hh && local.y <= hh
  );
}

export function hitTestHandles(
  px: number,
  py: number,
  box: TransformableBox,
  handleRadius = 14,
  isCropping = false
): HandleKind | null {
  if (isCropping) {
    const edges: Array<{ kind: HandleKind; lx: number; ly: number }> = [
      { kind: "crop-n", lx: 0, ly: -box.height / 2 },
      { kind: "crop-s", lx: 0, ly: box.height / 2 },
      { kind: "crop-w", lx: -box.width / 2, ly: 0 },
      { kind: "crop-e", lx: box.width / 2, ly: 0 },
    ];
    for (const edge of edges) {
      const wp = localToWorld(edge.lx, edge.ly, box);
      if (Math.hypot(px - wp.x, py - wp.y) <= handleRadius) {
        return edge.kind;
      }
    }
    return hitTestBox(px, py, box) ? "move" : null;
  }

  const rotPos = getRotationHandlePos(box);
  if (Math.hypot(px - rotPos.x, py - rotPos.y) <= handleRadius) {
    return "rotate";
  }

  const corners = getLayerCorners(box);
  const cornerKinds: HandleKind[] = ["nw", "ne", "se", "sw"];
  for (let i = 0; i < 4; i++) {
    if (Math.hypot(px - corners[i].x, py - corners[i].y) <= handleRadius) {
      return cornerKinds[i];
    }
  }

  if (hitTestBox(px, py, box)) {
    return "move";
  }

  return null;
}

export function snapAngle(angleRad: number, snapEnabled: boolean): number {
  if (!snapEnabled) return angleRad;
  const step = Math.PI / 12; // 15 degrees
  return Math.round(angleRad / step) * step;
}

export function computeSnapPosition(
  x: number,
  y: number,
  threshold = 8
): { x: number; y: number; snapX: boolean; snapY: boolean } {
  const cx = CANVAS_WIDTH / 2;
  const cy = CANVAS_HEIGHT / 2;
  const snapX = Math.abs(x - cx) <= threshold;
  const snapY = Math.abs(y - cy) <= threshold;
  return {
    x: snapX ? cx : x,
    y: snapY ? cy : y,
    snapX,
    snapY,
  };
}

function fitDimensionsIntoBox(
  aspect: number,
  maxW: number,
  maxH: number,
  cover = false
): { width: number; height: number } {
  const safeAspect = aspect > 0 ? aspect : 1;
  if (cover) {
    if (maxW / maxH > safeAspect) {
      return { width: maxW, height: maxW / safeAspect };
    }
    return { width: maxH * safeAspect, height: maxH };
  }
  if (maxW / maxH > safeAspect) {
    return { width: maxH * safeAspect, height: maxH };
  }
  return { width: maxW, height: maxW / safeAspect };
}

export function computeCollageLayout(
  images: ImageLayer[],
  layoutId: CollageLayoutId
): ImageLayer[] {
  if (images.length === 0) return [];
  const count = images.length;

  if (layoutId === "full") {
    return images.map((img, idx) => {
      const aspect =
        (img.naturalWidth * img.crop.w) /
        Math.max(1, img.naturalHeight * img.crop.h);
      const dims =
        idx === 0
          ? fitDimensionsIntoBox(aspect, CANVAS_WIDTH, CANVAS_HEIGHT, true)
          : fitDimensionsIntoBox(aspect, 260, 190, false);
      return {
        ...img,
        x: idx === 0 ? CANVAS_WIDTH / 2 : 170 + (idx % 3) * 230,
        y: idx === 0 ? CANVAS_HEIGHT / 2 : CANVAS_HEIGHT / 2,
        width: dims.width,
        height: dims.height,
        scale: 1,
        rotation: 0,
        frameStyle: idx === 0 ? "none" : img.frameStyle,
      };
    });
  }

  if (layoutId === "split") {
    const pad = 18;
    const cols = count <= 2 ? count : Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const cellW = (CANVAS_WIDTH - pad * (cols + 1)) / cols;
    const cellH = (CANVAS_HEIGHT - pad * (rows + 1)) / rows;

    return images.map((img, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const aspect =
        (img.naturalWidth * img.crop.w) /
        Math.max(1, img.naturalHeight * img.crop.h);
      const dims = fitDimensionsIntoBox(aspect, cellW, cellH, false);
      return {
        ...img,
        x: pad + col * (cellW + pad) + cellW / 2,
        y: pad + row * (cellH + pad) + cellH / 2,
        width: dims.width,
        height: dims.height,
        scale: 1,
        rotation: 0,
        frameStyle: "none",
      };
    });
  }

  if (layoutId === "scatter") {
    const angles = [-0.09, 0.08, -0.05, 0.07, -0.11, 0.06];
    const maxW = count === 1 ? 380 : count === 2 ? 300 : 230;
    const maxH = count === 1 ? 290 : count === 2 ? 230 : 185;
    const spanX = count === 1 ? 0 : Math.min(500, count * 170);
    const startX = CANVAS_WIDTH / 2 - spanX / 2;

    return images.map((img, idx) => {
      const aspect =
        (img.naturalWidth * img.crop.w) /
        Math.max(1, img.naturalHeight * img.crop.h);
      const dims = fitDimensionsIntoBox(aspect, maxW, maxH, false);
      const t = count === 1 ? 0.5 : idx / (count - 1);
      const cx = count === 1 ? CANVAS_WIDTH / 2 : startX + t * spanX;
      const cy =
        CANVAS_HEIGHT / 2 + (idx % 2 === 0 ? -22 : 22) * (count > 1 ? 1 : 0);

      return {
        ...img,
        x: cx,
        y: cy,
        width: dims.width,
        height: dims.height,
        scale: 1,
        rotation: angles[idx % angles.length],
        frameStyle: "polaroid",
      };
    });
  }

  // "strip": photobooth vertical column on left, leaving right open for notes/stamps
  const stripCount = Math.min(count, 4);
  const slotPad = 14;
  const availH = CANVAS_HEIGHT - slotPad * (stripCount + 1);
  const slotH = availH / stripCount;
  const slotW = 240;

  return images.map((img, idx) => {
    const aspect =
      (img.naturalWidth * img.crop.w) /
      Math.max(1, img.naturalHeight * img.crop.h);
    const dims = fitDimensionsIntoBox(aspect, slotW, slotH, false);
    const slotIdx = idx % stripCount;
    const offsetCol = Math.floor(idx / stripCount) * 265;
    return {
      ...img,
      x: 165 + offsetCol,
      y: slotPad + slotIdx * (slotH + slotPad) + slotH / 2,
      width: dims.width,
      height: dims.height,
      scale: 1,
      rotation: 0,
      frameStyle: "polaroid",
    };
  });
}

function clampByte(val: number): number {
  return val < 0 ? 0 : val > 255 ? 255 : val;
}

/**
 * Applies brightness & contrast matching server/palette.ts math.
 */
export function applyBrightnessContrast(
  srcCanvas: HTMLCanvasElement,
  brightness: number,
  contrast: number
): HTMLCanvasElement {
  if (
    Math.abs(brightness - 1) < 0.005 &&
    Math.abs(contrast - 1) < 0.005
  ) {
    return srcCanvas;
  }

  const out = document.createElement("canvas");
  out.width = srcCanvas.width;
  out.height = srcCanvas.height;
  const sctx = srcCanvas.getContext("2d");
  const octx = out.getContext("2d");
  if (!sctx || !octx) return srcCanvas;

  const imgData = sctx.getImageData(0, 0, out.width, out.height);
  const data = imgData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = (data[i] * brightness - 128) * contrast + 128;
    const g = (data[i + 1] * brightness - 128) * contrast + 128;
    const b = (data[i + 2] * brightness - 128) * contrast + 128;
    data[i] = clampByte(r);
    data[i + 1] = clampByte(g);
    data[i + 2] = clampByte(b);
  }

  octx.putImageData(imgData, 0, 0);
  return out;
}
