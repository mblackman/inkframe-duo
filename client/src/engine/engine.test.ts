import { describe, expect, it } from "bun:test";
import {
  StrokeSmoother,
  shouldPaintHalftonePixel,
  shouldPaintTonePixel,
  floodFillBuffer,
  constrainShapePoints,
  mergeBoundaryBuffers,
} from "./stroke";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  worldToLocal,
  localToWorld,
  hitTestBox,
  snapAngle,
  computeSnapPosition,
  computeCollageLayout,
  screenRectToCanvasPoint,
} from "./transforms";
import {
  SPECTRA_PERCEIVED_COLORS,
  quantizeAndDitherRgba,
} from "./dither";
import {
  SPECTRA_PALETTE,
  OPTICAL_MIX_SWATCHES,
  hexToRgba,
  sampleSpectraColorHex,
} from "./palette-swatches";
import type { ImageLayer } from "../types";

describe("Client Studio Engines", () => {
  describe("Stroke Engine", () => {
    it("interpolates huge fast mouse jumps without gaps (> 2px)", () => {
      const smoother = new StrokeSmoother(4, "pen");
      const startStamps = smoother.startStroke({
        x: 10,
        y: 10,
        time: 0,
        pressure: 0.5,
        pointerType: "mouse",
      });
      const moveStamps = smoother.addPoint({
        x: 760,
        y: 440,
        time: 8,
        pressure: 0.5,
        pointerType: "mouse",
      });
      const endStamps = smoother.finishStroke();

      const all = [...startStamps, ...moveStamps, ...endStamps];
      expect(all.length).toBeGreaterThan(200);
      expect(all[0].x).toBeCloseTo(10, 1);
      expect(all[0].y).toBeCloseTo(10, 1);

      const last = all[all.length - 1];
      expect(last.x).toBeCloseTo(760, 1);
      expect(last.y).toBeCloseTo(440, 1);

      for (let i = 1; i < all.length; i++) {
        const dx = all[i].x - all[i - 1].x;
        const dy = all[i].y - all[i - 1].y;
        const dist = Math.hypot(dx, dy);
        expect(dist).toBeLessThanOrEqual(2.0);
      }
    });

    it("produces smooth curved intermediate stamps across multi-point turns", () => {
      const smoother = new StrokeSmoother(6, "marker");
      const s0 = smoother.startStroke({ x: 0, y: 0, time: 0 });
      const s1 = smoother.addPoint({ x: 100, y: 0, time: 10 });
      const s2 = smoother.addPoint({ x: 100, y: 100, time: 20 });
      const s3 = smoother.finishStroke();

      const all = [...s0, ...s1, ...s2, ...s3];
      // Verify the curve bends inward (y > 0 while x < 100) rather than sharp corner
      const curvedPoints = all.filter((p) => p.x > 55 && p.x < 98 && p.y > 1);
      expect(curvedPoints.length).toBeGreaterThan(0);

      // Verify end point reached
      const last = all[all.length - 1];
      expect(last.x).toBeCloseTo(100, 1);
      expect(last.y).toBeCloseTo(100, 1);
    });

    it("alternates halftone pixels deterministically in 2x2 blocks (~50% coverage)", () => {
      let painted = 0;
      const total = 16 * 16;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (shouldPaintHalftonePixel(x, y)) painted++;
        }
      }
      expect(painted).toBe(total / 2);
      // 2x2 block consistency
      expect(shouldPaintHalftonePixel(0, 0)).toBe(shouldPaintHalftonePixel(1, 1));
      expect(shouldPaintHalftonePixel(0, 0)).not.toBe(shouldPaintHalftonePixel(2, 0));
    });

    it("flood-fills enclosed regions without leaking and no-ops when already filled", () => {
      const w = 10;
      const h = 10;
      const data = new Uint8ClampedArray(w * h * 4); // All transparent [0,0,0,0]

      // Draw closed black border around box x:[2..7], y:[2..7]
      for (let y = 2; y <= 7; y++) {
        for (let x = 2; x <= 7; x++) {
          if (x === 2 || x === 7 || y === 2 || y === 7) {
            const idx = (y * w + x) * 4;
            data[idx] = 30;
            data[idx + 1] = 30;
            data[idx + 2] = 30;
            data[idx + 3] = 255;
          }
        }
      }

      const red: [number, number, number, number] = [158, 42, 31, 255];
      const changed = floodFillBuffer(data, w, h, 4, 4, red);
      expect(changed).toBe(true);

      // Interior (3..6, 3..6) is filled red
      for (let y = 3; y <= 6; y++) {
        for (let x = 3; x <= 6; x++) {
          const idx = (y * w + x) * 4;
          expect([data[idx], data[idx + 1], data[idx + 2], data[idx + 3]]).toEqual(red);
        }
      }

      // Exterior (0,0) and (9,9) remain unfilled
      expect(data[3]).toBe(0);
      expect(data[(9 * w + 9) * 4 + 3]).toBe(0);

      // Filling the same spot with the exact same color is a clean no-op
      const second = floodFillBuffer(data, w, h, 4, 4, red);
      expect(second).toBe(false);
    });
  });

  describe("Transform & Collage Engine", () => {
    it("round-trips worldToLocal and localToWorld accurately", () => {
      const box = {
        x: 320,
        y: 210,
        width: 200,
        height: 120,
        scale: 1.5,
        rotation: Math.PI / 5,
      };
      const local = { x: 45, y: -22 };
      const world = localToWorld(local.x, local.y, box);
      const back = worldToLocal(world.x, world.y, box);

      expect(back.x).toBeCloseTo(local.x, 5);
      expect(back.y).toBeCloseTo(local.y, 5);
    });

    it("hit-tests rotated boxes accurately", () => {
      const box = {
        x: 400,
        y: 240,
        width: 200,
        height: 60,
        scale: 1,
        rotation: Math.PI / 2, // Now effectively 60 wide x 200 tall
      };
      // Inside vertical span (y = 240 + 80 = 320)
      expect(hitTestBox(400, 320, box)).toBe(true);
      // Outside horizontal span (x = 400 + 60 = 460; half-width after 90deg rot is 30)
      expect(hitTestBox(460, 240, box)).toBe(false);
    });

    it("snaps angles to 15-degree increments when enabled", () => {
      const rad14 = (14 * Math.PI) / 180;
      const rad15 = (15 * Math.PI) / 180;
      expect(snapAngle(rad14, true)).toBeCloseTo(rad15, 6);
      expect(snapAngle(rad14, false)).toBeCloseTo(rad14, 6);
    });

    it("snaps position to canvas center and reports active guide flags", () => {
      const snapped = computeSnapPosition(404, 236, 8);
      expect(snapped).toEqual({
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT / 2,
        snapX: true,
        snapY: true,
      });

      const free = computeSnapPosition(120, 380, 8);
      expect(free).toEqual({ x: 120, y: 380, snapX: false, snapY: false });
    });

    it("computes valid collage layouts within canvas bounds", () => {
      const sampleImages: ImageLayer[] = [1, 2, 3].map((n) => ({
        id: `img-${n}`,
        src: "data:image/png;base64,AA==",
        naturalWidth: 800,
        naturalHeight: 600,
        x: 100,
        y: 100,
        width: 300,
        height: 225,
        scale: 1,
        rotation: 0,
        flipX: false,
        brightness: 1.05,
        contrast: 1.12,
        frameStyle: "none",
        crop: { x: 0, y: 0, w: 1, h: 1 },
      }));

      for (const layout of ["full", "split", "scatter", "strip"] as const) {
        const result = computeCollageLayout(sampleImages, layout);
        expect(result).toHaveLength(3);
        for (const item of result) {
          expect(item.x).toBeGreaterThan(0);
          expect(item.x).toBeLessThan(CANVAS_WIDTH);
          expect(item.y).toBeGreaterThan(0);
          expect(item.y).toBeLessThan(CANVAS_HEIGHT);
          expect(item.width * item.scale).toBeGreaterThan(20);
          expect(item.height * item.scale).toBeGreaterThan(20);
        }
        if (layout === "scatter") {
          expect(result.every((i) => i.frameStyle === "polaroid")).toBe(true);
        }
      }
    });
  });

  describe("Client Spectra 6 Dither Engine", () => {
    it("quantizes all pixels strictly to perceived Spectra 6 colors and keeps ink un-dithered", () => {
      const w = 16;
      const h = 16;
      const bg = new Uint8ClampedArray(w * h * 4);
      const ink = new Uint8ClampedArray(w * h * 4);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          bg[i] = Math.round((x / (w - 1)) * 255);
          bg[i + 1] = Math.round((y / (h - 1)) * 255);
          bg[i + 2] = 128;
          bg[i + 3] = 255;

          // Draw a pure Cobalt Blue ink square at (4..6, 4..6)
          if (x >= 4 && x <= 6 && y >= 4 && y <= 6) {
            ink[i] = 37;
            ink[i + 1] = 70;
            ink[i + 2] = 122;
            ink[i + 3] = 255;
          }
        }
      }

      const validRgb = new Set(
        SPECTRA_PERCEIVED_COLORS.map((c) => `${c.rgb[0]},${c.rgb[1]},${c.rgb[2]}`)
      );

      for (const algo of ["floyd", "atkinson", "bayer", "nearest"] as const) {
        const out = quantizeAndDitherRgba(bg, ink, w, h, algo);
        expect(out.length).toBe(w * h * 4);

        for (let i = 0; i < out.length; i += 4) {
          const key = `${out[i]},${out[i + 1]},${out[i + 2]}`;
          expect(validRgb.has(key)).toBe(true);
          expect(out[i + 3]).toBe(255);
        }

        // Check crisp Cobalt Blue ink pixel at (5,5)
        const inkIdx = (5 * w + 5) * 4;
        expect([out[inkIdx], out[inkIdx + 1], out[inkIdx + 2]]).toEqual([37, 70, 122]);
      }
    });

    it("provides 12 curated optical mix swatches using strictly valid Spectra 6 hexes and samples nearest Spectra hex", () => {
      const validHexes = new Set(SPECTRA_PALETTE.map((c) => c.hex));
      expect(SPECTRA_PALETTE).toHaveLength(6);
      expect(OPTICAL_MIX_SWATCHES).toHaveLength(12);

      for (const sw of OPTICAL_MIX_SWATCHES) {
        expect(validHexes.has(sw.primaryHex)).toBe(true);
        expect(validHexes.has(sw.secondaryHex)).toBe(true);
        expect(["tone25", "halftone", "tone75"]).toContain(sw.density);
      }

      expect(hexToRgba("#9e2a1f")).toEqual([158, 42, 31, 255]);
      expect(sampleSpectraColorHex(160, 44, 30)).toBe("#9e2a1f");
      expect(sampleSpectraColorHex(35, 72, 125)).toBe("#25467a");
    });
  });

  describe("Clip Studio Paint Engine Extensions", () => {
    it("computes deterministic screentone densities for tone25 (25%), halftone (50%), tone75 (75%), and dry pencil", () => {
      const total = 16 * 16;
      const countCoverage = (style: "tone25" | "halftone" | "tone75" | "pencil") => {
        let count = 0;
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            if (shouldPaintTonePixel(x, y, style)) count++;
          }
        }
        return count;
      };

      expect(countCoverage("tone25")).toBe(total * 0.25);
      expect(countCoverage("halftone")).toBe(total * 0.5);
      expect(countCoverage("tone75")).toBe(total * 0.75);

      const pencilCount = countCoverage("pencil");
      expect(pencilCount).toBeGreaterThan(total * 0.4);
      expect(pencilCount).toBeLessThan(total * 0.8);
      expect(shouldPaintTonePixel(7, 11, "pencil")).toBe(shouldPaintTonePixel(7, 11, "pencil"));
    });

    it("stabilizes jittery strokes and converges cleanly to the final raw endpoint, and supports taper: false", () => {
      const jittery = new StrokeSmoother(8, "pen", { stabilization: 8, taper: true });
      const rawPoints = [
        { x: 0, y: 100, time: 0 },
        { x: 20, y: 80, time: 10 },
        { x: 40, y: 120, time: 20 },
        { x: 60, y: 80, time: 30 },
        { x: 80, y: 100, time: 40 },
      ];
      const stamps = [
        ...jittery.startStroke(rawPoints[0]),
        ...jittery.addPoint(rawPoints[1]),
        ...jittery.addPoint(rawPoints[2]),
        ...jittery.addPoint(rawPoints[3]),
        ...jittery.addPoint(rawPoints[4]),
        ...jittery.finishStroke(),
      ];

      const maxDeviation = Math.max(...stamps.map((s) => Math.abs(s.y - 100)));
      expect(maxDeviation).toBeLessThan(15);
      const last = stamps[stamps.length - 1];
      expect(last.x).toBeCloseTo(80, 1);
      expect(last.y).toBeCloseTo(100, 1);

      const untapered = new StrokeSmoother(10, "pen", { stabilization: 0, taper: false });
      const s0 = untapered.startStroke({ x: 0, y: 0, time: 0, pressure: 0.2, pointerType: "pen" });
      const s1 = untapered.addPoint({ x: 120, y: 0, time: 2, pressure: 0.9, pointerType: "pen" });
      const s2 = untapered.finishStroke();
      for (const st of [...s0, ...s1, ...s2]) {
        expect(st.radius).toBeCloseTo(5, 5);
      }
    });

    it("constrains line angles to 15° increments and locks box shapes to 1:1 when shiftConstrain is true", () => {
      const lineFree = constrainShapePoints("line", { x: 100, y: 100 }, { x: 195, y: 120 }, false);
      expect(lineFree).toEqual({ x: 195, y: 120 });

      // ~11.8 deg snaps to 15 deg
      const lineSnapped = constrainShapePoints("line", { x: 100, y: 100 }, { x: 195, y: 120 }, true);
      const snappedAngle = Math.atan2(lineSnapped.y - 100, lineSnapped.x - 100);
      expect(snappedAngle).toBeCloseTo(Math.PI / 12, 4);

      const rectSquare = constrainShapePoints("rect", { x: 50, y: 60 }, { x: 150, y: 90 }, true);
      expect(Math.abs(rectSquare.x - 50)).toBeCloseTo(Math.abs(rectSquare.y - 60), 5);
      expect(Math.abs(rectSquare.x - 50)).toBe(100);
    });

    it("merges multi-layer boundary buffers for cross-layer fill and supports 2-color halftone flood fill", () => {
      const w = 10;
      const h = 10;
      const layerA = new Uint8ClampedArray(w * h * 4);
      const layerB = new Uint8ClampedArray(w * h * 4);

      // Horizontal top/bottom border in layerA, vertical left/right border in layerB
      for (let x = 2; x <= 7; x++) {
        layerA[(2 * w + x) * 4 + 3] = 255;
        layerA[(7 * w + x) * 4 + 3] = 255;
      }
      for (let y = 2; y <= 7; y++) {
        layerB[(y * w + 2) * 4 + 3] = 255;
        layerB[(y * w + 7) * 4 + 3] = 255;
      }

      const boundary = mergeBoundaryBuffers([layerA, layerB]);
      expect(boundary).toBeDefined();

      const targetColorLayer = new Uint8ClampedArray(w * h * 4);
      const red: [number, number, number, number] = [158, 42, 31, 255];
      const yellow: [number, number, number, number] = [217, 184, 44, 255];

      const changed = floodFillBuffer(
        targetColorLayer,
        w,
        h,
        4,
        4,
        red,
        boundary,
        { mode: "halftone", secondaryRgba: yellow }
      );
      expect(changed).toBe(true);

      // Exterior stays empty (no leak across combined boundary)
      expect(targetColorLayer[3]).toBe(0);
      expect(targetColorLayer[(9 * w + 9) * 4 + 3]).toBe(0);

      // Interior contains both red and yellow pixels in deterministic checkerboard
      let sawRed = false;
      let sawYellow = false;
      for (let y = 3; y <= 6; y++) {
        for (let x = 3; x <= 6; x++) {
          const i = (y * w + x) * 4;
          const rgba = [
            targetColorLayer[i],
            targetColorLayer[i + 1],
            targetColorLayer[i + 2],
            targetColorLayer[i + 3],
          ];
          if (shouldPaintHalftonePixel(x, y)) {
            expect(rgba).toEqual(red);
            sawRed = true;
          } else {
            expect(rgba).toEqual(yellow);
            sawYellow = true;
          }
        }
      }
      expect(sawRed).toBe(true);
      expect(sawYellow).toBe(true);
    });

    it("maps screen rect pointer coordinates accurately under zoom, offset, and viewFlipX", () => {
      const rect = { left: 100, top: 50, width: 1600, height: 960 }; // 200% zoom
      const normal = screenRectToCanvasPoint(500, 290, rect, false);
      expect(normal.x).toBeCloseTo(200, 5);
      expect(normal.y).toBeCloseTo(120, 5);

      const flipped = screenRectToCanvasPoint(500, 290, rect, true);
      expect(flipped.x).toBeCloseTo(600, 5);
      expect(flipped.y).toBeCloseTo(120, 5);
    });
  });
});
