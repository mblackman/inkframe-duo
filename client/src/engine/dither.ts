import type { DitherAlgo } from "../types";

export interface PerceivedPaletteEntry {
  name: string;
  hex: string;
  rgb: [number, number, number];
}

export const SPECTRA_PERCEIVED_COLORS: PerceivedPaletteEntry[] = [
  { name: "Ink Black", hex: "#1e1e1e", rgb: [30, 30, 30] },
  { name: "Paper White", hex: "#e8e4d9", rgb: [232, 228, 217] },
  { name: "Crimson Red", hex: "#9e2a1f", rgb: [158, 42, 31] },
  { name: "Sunbeam Yellow", hex: "#d9b82c", rgb: [217, 184, 44] },
  { name: "Forest Green", hex: "#2d6a3e", rgb: [45, 106, 62] },
  { name: "Cobalt Blue", hex: "#25467a", rgb: [37, 70, 122] },
];

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function clampByte(val: number): number {
  return val < 0 ? 0 : val > 255 ? 255 : val;
}

function isExactPerceivedColor(r: number, g: number, b: number): boolean {
  for (let i = 0; i < SPECTRA_PERCEIVED_COLORS.length; i++) {
    const [pr, pg, pb] = SPECTRA_PERCEIVED_COLORS[i].rgb;
    if (Math.abs(r - pr) <= 1 && Math.abs(g - pg) <= 1 && Math.abs(b - pb) <= 1) {
      return true;
    }
  }
  return false;
}

export function findNearestPerceivedColorIndex(
  r: number,
  g: number,
  b: number
): number {
  let bestIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < SPECTRA_PERCEIVED_COLORS.length; i++) {
    const [pr, pg, pb] = SPECTRA_PERCEIVED_COLORS[i].rgb;
    const dr = r - pr;
    const dg = g - pg;
    const db = b - pb;
    const dist = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (dist < minDist) {
      minDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Mirrors server/palette.ts quantization & dithering in the browser so users
 * can preview exact Spectra 6 e-paper pixels in real time.
 */
export function quantizeAndDitherRgba(
  bgRgba: Uint8ClampedArray | null,
  inkRgba: Uint8ClampedArray | null,
  width: number,
  height: number,
  algo: DitherAlgo
): Uint8ClampedArray {
  const totalPixels = width * height;
  const out = new Uint8ClampedArray(totalPixels * 4);
  const floatBuf = new Float32Array(totalPixels * 3);

  if (bgRgba) {
    for (let i = 0, j = 0; i < totalPixels * 4; i += 4, j += 3) {
      floatBuf[j] = bgRgba[i];
      floatBuf[j + 1] = bgRgba[i + 1];
      floatBuf[j + 2] = bgRgba[i + 2];
    }
  }

  const addError = (
    x: number,
    y: number,
    er: number,
    eg: number,
    eb: number,
    w: number
  ) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = (y * width + x) * 3;
    floatBuf[idx] = clampByte(floatBuf[idx] + er * w);
    floatBuf[idx + 1] = clampByte(floatBuf[idx + 1] + eg * w);
    floatBuf[idx + 2] = clampByte(floatBuf[idx + 2] + eb * w);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pIdx = y * width + x;
      const idx3 = pIdx * 3;
      const idx4 = pIdx * 4;

      if (inkRgba && inkRgba[idx4 + 3] >= 96) {
        const inkIdx = findNearestPerceivedColorIndex(
          inkRgba[idx4],
          inkRgba[idx4 + 1],
          inkRgba[idx4 + 2]
        );
        const [pr, pg, pb] = SPECTRA_PERCEIVED_COLORS[inkIdx].rgb;
        out[idx4] = pr;
        out[idx4 + 1] = pg;
        out[idx4 + 2] = pb;
        out[idx4 + 3] = 255;
        continue;
      }

      if (!bgRgba) {
        const [pr, pg, pb] = SPECTRA_PERCEIVED_COLORS[1].rgb;
        out[idx4] = pr;
        out[idx4 + 1] = pg;
        out[idx4 + 2] = pb;
        out[idx4 + 3] = 255;
        continue;
      }

      const oldR = floatBuf[idx3];
      const oldG = floatBuf[idx3 + 1];
      const oldB = floatBuf[idx3 + 2];

      let targetR = oldR;
      let targetG = oldG;
      let targetB = oldB;

      if (algo === "bayer" && !isExactPerceivedColor(oldR, oldG, oldB)) {
        const bayerOffset = (BAYER_4X4[y & 3][x & 3] / 16 - 0.5) * 48;
        targetR = clampByte(oldR + bayerOffset);
        targetG = clampByte(oldG + bayerOffset);
        targetB = clampByte(oldB + bayerOffset);
      }

      const nearestIdx = findNearestPerceivedColorIndex(targetR, targetG, targetB);
      const [pr, pg, pb] = SPECTRA_PERCEIVED_COLORS[nearestIdx].rgb;

      out[idx4] = pr;
      out[idx4 + 1] = pg;
      out[idx4 + 2] = pb;
      out[idx4 + 3] = 255;

      if (algo !== "nearest" && algo !== "bayer") {
        const er = oldR - pr;
        const eg = oldG - pg;
        const eb = oldB - pb;

        if (algo === "floyd") {
          addError(x + 1, y, er, eg, eb, 7 / 16);
          addError(x - 1, y + 1, er, eg, eb, 3 / 16);
          addError(x, y + 1, er, eg, eb, 5 / 16);
          addError(x + 1, y + 1, er, eg, eb, 1 / 16);
        } else if (algo === "atkinson") {
          const w = 1 / 8;
          addError(x + 1, y, er, eg, eb, w);
          addError(x + 2, y, er, eg, eb, w);
          addError(x - 1, y + 1, er, eg, eb, w);
          addError(x, y + 1, er, eg, eb, w);
          addError(x + 1, y + 1, er, eg, eb, w);
          addError(x, y + 2, er, eg, eb, w);
        }
      }
    }
  }

  return out;
}
