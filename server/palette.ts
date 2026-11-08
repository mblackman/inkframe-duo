import { createCanvas, loadImage } from "@napi-rs/canvas";

export const WIDTH = 800;
export const HEIGHT = 480;

export interface SpectraColor {
  name: string;
  theoretical: [number, number, number];
  perceived: [number, number, number];
  hex: string;
}

export const SPECTRA_6_PALETTE: SpectraColor[] = [
  { name: "Black", theoretical: [0, 0, 0], perceived: [30, 30, 30], hex: "#000000" },
  { name: "White", theoretical: [255, 255, 255], perceived: [232, 228, 217], hex: "#FFFFFF" },
  { name: "Red", theoretical: [255, 0, 0], perceived: [158, 42, 31], hex: "#FF0000" },
  { name: "Yellow", theoretical: [255, 255, 0], perceived: [217, 184, 44], hex: "#FFFF00" },
  { name: "Green", theoretical: [0, 255, 0], perceived: [45, 106, 62], hex: "#00FF00" },
  { name: "Blue", theoretical: [0, 0, 255], perceived: [37, 70, 122], hex: "#0000FF" },
];

export type DitherAlgorithm = "floyd" | "atkinson" | "nearest";

function clampByte(val: number): number {
  return val < 0 ? 0 : val > 255 ? 255 : val;
}

export function findNearestPerceivedIndex(r: number, g: number, b: number): number {
  let bestIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < SPECTRA_6_PALETTE.length; i++) {
    const [pr, pg, pb] = SPECTRA_6_PALETTE[i].perceived;
    const dr = r - pr;
    const dg = g - pg;
    const db = b - pb;
    // Perceptual human eye color weighting
    const dist = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (dist < minDist) {
      minDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function findNearestTheoreticalIndex(r: number, g: number, b: number): number {
  let bestIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < SPECTRA_6_PALETTE.length; i++) {
    const [tr, tg, tb] = SPECTRA_6_PALETTE[i].theoretical;
    const dr = r - tr;
    const dg = g - tg;
    const db = b - tb;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < minDist) {
      minDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export interface RenderOptions {
  backgroundDataUrl?: string | null;
  inkDataUrl?: string | null;
  ditherAlgorithm?: DitherAlgorithm;
  exposure?: number;
  contrast?: number;
}

export interface RenderedFramePair {
  devicePngBuffer: Buffer; // Theoretical RGB for ESP32-S3-PhotoPainter
  previewPngBuffer: Buffer; // Perceived RGB for Web UI & History Gallery
  paletteIndices: Uint8Array;
}

export async function renderHybridNote(opts: RenderOptions): Promise<RenderedFramePair> {
  const ditherAlgo = opts.ditherAlgorithm ?? "floyd";
  const exposure = opts.exposure ?? 1.05;
  const contrast = opts.contrast ?? 1.15;

  const bgCanvas = createCanvas(WIDTH, HEIGHT);
  const bgCtx = bgCanvas.getContext("2d");

  // Default warm e-paper background (White index perceived)
  bgCtx.fillStyle = "#e8e4d9";
  bgCtx.fillRect(0, 0, WIDTH, HEIGHT);

  if (opts.backgroundDataUrl) {
    const bgImg = await loadImage(opts.backgroundDataUrl);
    // Aspect fill (cover) to 800x480
    const scale = Math.max(WIDTH / bgImg.width, HEIGHT / bgImg.height);
    const sw = bgImg.width * scale;
    const sh = bgImg.height * scale;
    const sx = (WIDTH - sw) / 2;
    const sy = (HEIGHT - sh) / 2;
    bgCtx.drawImage(bgImg, sx, sy, sw, sh);
  }

  const bgImageData = bgCtx.getImageData(0, 0, WIDTH, HEIGHT);
  const floatBuf = new Float32Array(WIDTH * HEIGHT * 3);

  for (let i = 0, j = 0; i < bgImageData.data.length; i += 4, j += 3) {
    let r = bgImageData.data[i] * exposure;
    let g = bgImageData.data[i + 1] * exposure;
    let b = bgImageData.data[i + 2] * exposure;
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;
    floatBuf[j] = clampByte(r);
    floatBuf[j + 1] = clampByte(g);
    floatBuf[j + 2] = clampByte(b);
  }

  const addError = (x: number, y: number, er: number, eg: number, eb: number, w: number) => {
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    const idx = (y * WIDTH + x) * 3;
    floatBuf[idx] = clampByte(floatBuf[idx] + er * w);
    floatBuf[idx + 1] = clampByte(floatBuf[idx + 1] + eg * w);
    floatBuf[idx + 2] = clampByte(floatBuf[idx + 2] + eb * w);
  };

  // Palette index map for every pixel (0..5)
  const paletteIndices = new Uint8Array(WIDTH * HEIGHT);

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const pIdx = y * WIDTH + x;
      const idx3 = pIdx * 3;
      const oldR = floatBuf[idx3];
      const oldG = floatBuf[idx3 + 1];
      const oldB = floatBuf[idx3 + 2];

      const nearestIdx = opts.backgroundDataUrl
        ? findNearestPerceivedIndex(oldR, oldG, oldB)
        : 1; // Default to Paper White (index 1) if no background photo

      paletteIndices[pIdx] = nearestIdx;

      if (opts.backgroundDataUrl && ditherAlgo !== "nearest") {
        const [pr, pg, pb] = SPECTRA_6_PALETTE[nearestIdx].perceived;
        const er = oldR - pr;
        const eg = oldG - pg;
        const eb = oldB - pb;

        if (ditherAlgo === "floyd") {
          addError(x + 1, y, er, eg, eb, 7 / 16);
          addError(x - 1, y + 1, er, eg, eb, 3 / 16);
          addError(x, y + 1, er, eg, eb, 5 / 16);
          addError(x + 1, y + 1, er, eg, eb, 1 / 16);
        } else if (ditherAlgo === "atkinson") {
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

  // Superimpose foreground ink layer WITHOUT dithering
  if (opts.inkDataUrl) {
    const inkCanvas = createCanvas(WIDTH, HEIGHT);
    const inkCtx = inkCanvas.getContext("2d");
    const inkImg = await loadImage(opts.inkDataUrl);
    inkCtx.drawImage(inkImg, 0, 0, WIDTH, HEIGHT);
    const inkData = inkCtx.getImageData(0, 0, WIDTH, HEIGHT).data;

    for (let i = 0, pIdx = 0; i < inkData.length; i += 4, pIdx++) {
      // Threshold alpha to capture crisp line art
      if (inkData[i + 3] > 64) {
        paletteIndices[pIdx] = findNearestPerceivedIndex(
          inkData[i],
          inkData[i + 1],
          inkData[i + 2]
        );
      }
    }
  }

  // Generate both Theoretical Device PNG and Perceived Preview PNG
  return createBuffersFromIndices(paletteIndices);
}

export function createBuffersFromIndices(paletteIndices: Uint8Array): RenderedFramePair {
  const deviceCanvas = createCanvas(WIDTH, HEIGHT);
  const deviceCtx = deviceCanvas.getContext("2d");
  const deviceImgData = deviceCtx.createImageData(WIDTH, HEIGHT);

  const previewCanvas = createCanvas(WIDTH, HEIGHT);
  const previewCtx = previewCanvas.getContext("2d");
  const previewImgData = previewCtx.createImageData(WIDTH, HEIGHT);

  for (let pIdx = 0, i = 0; pIdx < paletteIndices.length; pIdx++, i += 4) {
    const colorIdx = paletteIndices[pIdx] % 6;
    const entry = SPECTRA_6_PALETTE[colorIdx];

    // Theoretical palette for ESP32 hardware
    deviceImgData.data[i] = entry.theoretical[0];
    deviceImgData.data[i + 1] = entry.theoretical[1];
    deviceImgData.data[i + 2] = entry.theoretical[2];
    deviceImgData.data[i + 3] = 255;

    // Perceived palette for web preview
    previewImgData.data[i] = entry.perceived[0];
    previewImgData.data[i + 1] = entry.perceived[1];
    previewImgData.data[i + 2] = entry.perceived[2];
    previewImgData.data[i + 3] = 255;
  }

  deviceCtx.putImageData(deviceImgData, 0, 0);
  previewCtx.putImageData(previewImgData, 0, 0);

  return {
    devicePngBuffer: deviceCanvas.toBuffer("image/png"),
    previewPngBuffer: previewCanvas.toBuffer("image/png"),
    paletteIndices,
  };
}

export function renderWelcomeFrame(deviceName: string, deviceId: string): RenderedFramePair {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Warm paper background
  ctx.fillStyle = "#e8e4d9";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Decorative border
  ctx.strokeStyle = "#1e1e1e";
  ctx.lineWidth = 4;
  ctx.strokeRect(24, 24, WIDTH - 48, HEIGHT - 48);

  ctx.strokeStyle = "#9e2a1f";
  ctx.lineWidth = 2;
  ctx.strokeRect(32, 32, WIDTH - 64, HEIGHT - 64);

  // Header banner
  ctx.fillStyle = "#25467a";
  ctx.font = "bold 34px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("InkFrame Duo", WIDTH / 2, 90);

  ctx.fillStyle = "#1e1e1e";
  ctx.font = "bold 24px sans-serif";
  ctx.fillText(deviceName, WIDTH / 2, 140);

  ctx.fillStyle = "#2d6a3e";
  ctx.font = "18px sans-serif";
  ctx.fillText(`Device ID: ${deviceId} • E-Paper Link Active`, WIDTH / 2, 180);

  // Status box
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(100, 220, WIDTH - 200, 150);
  ctx.strokeStyle = "#1e1e1e";
  ctx.lineWidth = 2;
  ctx.strokeRect(100, 220, WIDTH - 200, 150);

  ctx.fillStyle = "#1e1e1e";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("Waiting for First Note", WIDTH / 2, 265);

  ctx.fillStyle = "#9e2a1f";
  ctx.font = "16px sans-serif";
  ctx.fillText("Open the InkFrame web studio on your phone or computer", WIDTH / 2, 305);
  ctx.fillText("to draw a note and send it to this frame!", WIDTH / 2, 335);

  // Bottom palette dots
  const dotY = 420;
  const startX = WIDTH / 2 - 125;
  const colors = ["#1e1e1e", "#9e2a1f", "#d9b82c", "#2d6a3e", "#25467a", "#ffffff"];
  colors.forEach((col, idx) => {
    ctx.beginPath();
    ctx.arc(startX + idx * 50, dotY, 14, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = "#1e1e1e";
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  const imgData = ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
  const indices = new Uint8Array(WIDTH * HEIGHT);

  for (let i = 0, pIdx = 0; i < imgData.length; i += 4, pIdx++) {
    indices[pIdx] = findNearestPerceivedIndex(imgData[i], imgData[i + 1], imgData[i + 2]);
  }

  return createBuffersFromIndices(indices);
}
