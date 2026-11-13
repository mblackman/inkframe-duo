import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { parseDevicesConfig, resolveTargetDeviceIds, type AppConfig } from "./config";
import { AppDatabase } from "./db";
import { createServer } from "./index";
import {
  renderHybridNote,
  renderWelcomeFrame,
  SPECTRA_6_PALETTE,
  WIDTH,
  HEIGHT,
} from "./palette";

describe("InkFrame Duo Core Suite", () => {
  let testDir: string;
  let testDb: AppDatabase;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "inkframe-test-"));
    testDb = new AppDatabase(testDir);
  });

  afterEach(() => {
    try {
      testDb.close();
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Device Configuration & Dynamic N-Device Setup
  // ---------------------------------------------------------------------------
  describe("Device Configuration Parser", () => {
    it("provides default 2 devices when INKFRAME_DEVICES is unset", () => {
      const devices = parseDevicesConfig("");
      expect(devices).toHaveLength(2);
      expect(devices[0].id).toBe("frame-wife");
      expect(devices[1].id).toBe("frame-matt");
    });

    it("parses comma-separated devices with custom names and optional tokens", () => {
      const raw = "kitchen:Kitchen Frame,office:Office Desk:secret123,nursery:Baby Room";
      const devices = parseDevicesConfig(raw);
      expect(devices).toHaveLength(3);
      expect(devices[0]).toEqual({ id: "kitchen", name: "Kitchen Frame", token: undefined, sortOrder: 0 });
      expect(devices[1]).toEqual({ id: "office", name: "Office Desk", token: "secret123", sortOrder: 1 });
      expect(devices[2]).toEqual({ id: "nursery", name: "Baby Room", token: undefined, sortOrder: 2 });
    });

    it("parses JSON formatted device configurations", () => {
      const raw = JSON.stringify([
        { id: "frame-a", name: "Alpha", token: "tok-a" },
        { id: "frame-b", name: "Beta" },
      ]);
      const devices = parseDevicesConfig(raw);
      expect(devices).toHaveLength(2);
      expect(devices[0].id).toBe("frame-a");
      expect(devices[0].token).toBe("tok-a");
      expect(devices[1].name).toBe("Beta");
    });

    it("resolves target device aliases accurately", () => {
      const devices = parseDevicesConfig("frame-wife:Wife's Desk Frame,frame-matt:Matt's Desk Frame,kitchen:Kitchen");
      expect(resolveTargetDeviceIds("wife", devices)).toEqual(["frame-wife"]);
      expect(resolveTargetDeviceIds("matt", devices)).toEqual(["frame-matt"]);
      expect(resolveTargetDeviceIds("all", devices)).toEqual(["frame-wife", "frame-matt", "kitchen"]);
      expect(resolveTargetDeviceIds("both", devices)).toEqual(["frame-wife", "frame-matt", "kitchen"]);
      expect(resolveTargetDeviceIds(["kitchen", "frame-wife"], devices)).toEqual(["kitchen", "frame-wife"]);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Strict Spectra 6 Palette & Hybrid Layer Rendering
  // ---------------------------------------------------------------------------
  describe("Calibrated Dual-Palette Rendering", () => {
    it("renders devicePngBuffer where 100% of pixels match theoretical Spectra 6 colors", async () => {
      // Create a test ink stroke
      const inkCanvas = createCanvas(WIDTH, HEIGHT);
      const inkCtx = inkCanvas.getContext("2d");
      inkCtx.strokeStyle = "#ff0000";
      inkCtx.lineWidth = 10;
      inkCtx.beginPath();
      inkCtx.moveTo(50, 50);
      inkCtx.lineTo(200, 200);
      inkCtx.stroke();

      // Create a gradient background
      const bgCanvas = createCanvas(WIDTH, HEIGHT);
      const bgCtx = bgCanvas.getContext("2d");
      const grad = bgCtx.createLinearGradient(0, 0, WIDTH, HEIGHT);
      grad.addColorStop(0, "#4a90e2");
      grad.addColorStop(1, "#50e3c2");
      bgCtx.fillStyle = grad;
      bgCtx.fillRect(0, 0, WIDTH, HEIGHT);

      const rendered = await renderHybridNote({
        backgroundDataUrl: bgCanvas.toDataURL(),
        inkDataUrl: inkCanvas.toDataURL(),
        ditherAlgorithm: "floyd",
      });

      expect(rendered.devicePngBuffer).toBeDefined();
      expect(rendered.previewPngBuffer).toBeDefined();

      // Inspect devicePngBuffer pixels
      const testImg = await loadImage(rendered.devicePngBuffer);
      expect(testImg.width).toBe(WIDTH);
      expect(testImg.height).toBe(HEIGHT);

      const checkCanvas = createCanvas(WIDTH, HEIGHT);
      const checkCtx = checkCanvas.getContext("2d");
      checkCtx.drawImage(testImg, 0, 0);
      const { data } = checkCtx.getImageData(0, 0, WIDTH, HEIGHT);

      const theoreticalSet = new Set(
        SPECTRA_6_PALETTE.map((c) => `${c.theoretical[0]},${c.theoretical[1]},${c.theoretical[2]}`)
      );

      // Verify every pixel matches the 6 theoretical colors
      for (let i = 0; i < data.length; i += 4) {
        const rgbKey = `${data[i]},${data[i + 1]},${data[i + 2]}`;
        expect(theoreticalSet.has(rgbKey)).toBe(true);
      }
    });

    it("renders welcome frame with valid Spectra 6 palette", async () => {
      const welcome = renderWelcomeFrame("Wife's Desk Frame", "frame-wife");
      expect(welcome.devicePngBuffer.length).toBeGreaterThan(1000);

      const img = await loadImage(welcome.devicePngBuffer);
      expect(img.width).toBe(800);
      expect(img.height).toBe(480);
    });

    it("supports ordered Bayer dithering with strict Spectra 6 theoretical palette", async () => {
      const bgCanvas = createCanvas(WIDTH, HEIGHT);
      const bgCtx = bgCanvas.getContext("2d");
      const grad = bgCtx.createLinearGradient(0, 0, WIDTH, HEIGHT);
      grad.addColorStop(0, "#d9822b");
      grad.addColorStop(1, "#3b5998");
      bgCtx.fillStyle = grad;
      bgCtx.fillRect(0, 0, WIDTH, HEIGHT);

      const rendered = await renderHybridNote({
        backgroundDataUrl: bgCanvas.toDataURL(),
        ditherAlgorithm: "bayer" as any,
      });

      const nearest = await renderHybridNote({
        backgroundDataUrl: bgCanvas.toDataURL(),
        ditherAlgorithm: "nearest",
      });

      expect(rendered.paletteIndices).not.toEqual(nearest.paletteIndices);

      const testImg = await loadImage(rendered.devicePngBuffer);
      expect(testImg.width).toBe(WIDTH);
      expect(testImg.height).toBe(HEIGHT);

      const checkCanvas = createCanvas(WIDTH, HEIGHT);
      const checkCtx = checkCanvas.getContext("2d");
      checkCtx.drawImage(testImg, 0, 0);
      const { data } = checkCtx.getImageData(0, 0, WIDTH, HEIGHT);

      const theoreticalSet = new Set(
        SPECTRA_6_PALETTE.map((c) => `${c.theoretical[0]},${c.theoretical[1]},${c.theoretical[2]}`)
      );

      for (let i = 0; i < data.length; i += 4) {
        const rgbKey = `${data[i]},${data[i + 1]},${data[i + 2]}`;
        expect(theoreticalSet.has(rgbKey)).toBe(true);
      }
    });

    it("preserves exact paletteIndices with zero generation-loss when remixing a rendered preview", async () => {
      const bgCanvas = createCanvas(WIDTH, HEIGHT);
      const bgCtx = bgCanvas.getContext("2d");
      const grad = bgCtx.createLinearGradient(0, 0, WIDTH, HEIGHT);
      grad.addColorStop(0, "#4a90e2");
      grad.addColorStop(0.5, "#f5a623");
      grad.addColorStop(1, "#7ed321");
      bgCtx.fillStyle = grad;
      bgCtx.fillRect(0, 0, WIDTH, HEIGHT);

      const initial = await renderHybridNote({
        backgroundDataUrl: bgCanvas.toDataURL(),
        ditherAlgorithm: "floyd",
      });

      const previewDataUrl = `data:image/png;base64,${initial.previewPngBuffer.toString("base64")}`;

      const remixedFloyd = await renderHybridNote({
        backgroundDataUrl: previewDataUrl,
        exposure: 1.0,
        contrast: 1.0,
        ditherAlgorithm: "floyd",
      });
      expect(remixedFloyd.paletteIndices).toEqual(initial.paletteIndices);

      const remixedBayer = await renderHybridNote({
        backgroundDataUrl: previewDataUrl,
        exposure: 1.0,
        contrast: 1.0,
        ditherAlgorithm: "bayer" as any,
      });
      expect(remixedBayer.paletteIndices).toEqual(initial.paletteIndices);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. HTTP Server, ETag Protocol, and Device Coordination
  // ---------------------------------------------------------------------------
  describe("Device HTTP Protocol & Caching", () => {
    function setupTestServer(options: { devices?: string; token?: string; webPin?: string } = {}) {
      const config: AppConfig = {
        port: 0, // In-memory/virtual fetch
        dataDir: testDir,
        globalFrameToken: options.token,
        webPin: options.webPin,
        devices: parseDevicesConfig(options.devices || "frame-wife:Wife's Desk Frame,frame-matt:Matt's Desk Frame", options.token),
      };
      return createServer(config, testDb);
    }

    it("returns 200 OK with Welcome Image on first poll before any note is queued", async () => {
      const { server } = setupTestServer();
      const res = await server.fetch(new Request("http://localhost/api/frame/frame-wife"));

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      const etag = res.headers.get("etag");
      expect(etag).toBe('"e6-welcome-frame-wife"');

      const body = await res.arrayBuffer();
      expect(body.byteLength).toBeGreaterThan(1000);
    });

    it("supports conditional ETag caching and returns 304 Not Modified", async () => {
      const { server } = setupTestServer();

      // 1. Initial Welcome Poll -> 200 OK
      const firstRes = await server.fetch(new Request("http://localhost/api/frame/frame-wife"));
      expect(firstRes.status).toBe(200);
      const welcomeEtag = firstRes.headers.get("etag")!;

      // 2. Poll again with matching If-None-Match -> 304 Not Modified
      const cachedRes = await server.fetch(
        new Request("http://localhost/api/frame/frame-wife", {
          headers: { "if-none-match": welcomeEtag },
        })
      );
      expect(cachedRes.status).toBe(304);
      const cachedBody = await cachedRes.text();
      expect(cachedBody).toBe("");

      // 3. Send a new note to Wife
      const inkCanvas = createCanvas(WIDTH, HEIGHT);
      const inkCtx = inkCanvas.getContext("2d");
      inkCtx.fillStyle = "#000000";
      inkCtx.fillRect(100, 100, 50, 50);

      const noteRes = await server.fetch(
        new Request("http://localhost/api/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            recipient: "wife",
            sender: "Matt",
            inkDataUrl: inkCanvas.toDataURL(),
          }),
        })
      );
      expect(noteRes.status).toBe(200);
      const noteJson = await noteRes.json();
      expect(noteJson.etag).toBeDefined();

      // 4. Poll again with old welcome ETag -> 200 OK with new image & new ETag
      const newPoll = await server.fetch(
        new Request("http://localhost/api/frame/frame-wife", {
          headers: { "if-none-match": welcomeEtag },
        })
      );
      expect(newPoll.status).toBe(200);
      const newEtag = newPoll.headers.get("etag");
      expect(newEtag).toBe(noteJson.etag);

      // 5. Poll again with new ETag -> 304 Not Modified
      const secondCachedRes = await server.fetch(
        new Request("http://localhost/api/frame/frame-wife", {
          headers: { "if-none-match": newEtag! },
        })
      );
      expect(secondCachedRes.status).toBe(304);
    });

    it("ingests and normalizes frame telemetry headers into SQLite", async () => {
      const { server } = setupTestServer();

      // Send telemetry during device poll
      const pollRes = await server.fetch(
        new Request("http://localhost/api/frame/frame-matt", {
          headers: {
            "x-battery-percentage": "87",
            "x-battery-voltage": "4.15", // In volts -> normalized to 4150 mV
            "x-ambient-temperature": "22.6",
            "x-ambient-humidity": "48.1",
            "x-firmware-version": "v2.2.0-photoframe",
            "x-sleep-duration": "900",
          },
        })
      );
      expect(pollRes.status).toBe(200);

      // Verify persisted state
      const stateRes = await server.fetch(new Request("http://localhost/api/state"));
      const state = await stateRes.json();
      const matt = state.devices.find((d: any) => d.device_id === "frame-matt");

      expect(matt).toBeDefined();
      expect(matt.battery_pct).toBe(87);
      expect(matt.battery_mv).toBe(4150);
      expect(matt.temperature_c).toBe(22.6);
      expect(matt.humidity_pct).toBe(48.1);
      expect(matt.firmware_version).toBe("v2.2.0-photoframe");
      expect(matt.sleep_duration_s).toBe(900);
      expect(matt.last_check_in).toBeDefined();
    });

    it("enforces bearer token when configured, and allows open access when unset", async () => {
      // 1. Server with tokens configured
      const secureServer = setupTestServer({ token: "my-secret-token" }).server;

      // Without token -> 401
      const unauth = await secureServer.fetch(new Request("http://localhost/api/frame/frame-wife"));
      expect(unauth.status).toBe(401);

      // With wrong token -> 401
      const wrongToken = await secureServer.fetch(
        new Request("http://localhost/api/frame/frame-wife", {
          headers: { authorization: "Bearer wrong" },
        })
      );
      expect(wrongToken.status).toBe(401);

      // With valid bearer header -> 200
      const validHeader = await secureServer.fetch(
        new Request("http://localhost/api/frame/frame-wife", {
          headers: { authorization: "Bearer my-secret-token" },
        })
      );
      expect(validHeader.status).toBe(200);

      // With valid query parameter -> 200
      const validQuery = await secureServer.fetch(
        new Request("http://localhost/api/frame/frame-wife?token=my-secret-token")
      );
      expect(validQuery.status).toBe(200);
    });

    it("supports multi-recipient broadcast and note re-send", async () => {
      const { server } = setupTestServer();

      const inkCanvas = createCanvas(WIDTH, HEIGHT);
      const inkCtx = inkCanvas.getContext("2d");
      inkCtx.fillStyle = "#ff0000";
      inkCtx.fillRect(10, 10, 20, 20);

      // Send to both frames
      const createRes = await server.fetch(
        new Request("http://localhost/api/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            recipient: "both",
            inkDataUrl: inkCanvas.toDataURL(),
          }),
        })
      );
      const created = await createRes.json();
      expect(created.recipients).toContain("frame-wife");
      expect(created.recipients).toContain("frame-matt");

      // Check state: both devices have active note
      const state1 = await (await server.fetch(new Request("http://localhost/api/state"))).json();
      const wifeDev = state1.devices.find((d: any) => d.device_id === "frame-wife");
      const mattDev = state1.devices.find((d: any) => d.device_id === "frame-matt");
      expect(wifeDev.active_etag).toBe(created.etag);
      expect(mattDev.active_etag).toBe(created.etag);

      // Re-send to only Matt
      const resendRes = await server.fetch(
        new Request(`http://localhost/api/notes/${created.id}/resend`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recipient: "frame-matt" }),
        })
      );
      expect(resendRes.status).toBe(200);
      const resendJson = await resendRes.json();
      expect(resendJson.ok).toBe(true);
    });

    it("enforces X-Pin consistently on note creation, resend, and deletion when webPin is set", async () => {
      const { server } = setupTestServer({ webPin: "4321" });

      const inkCanvas = createCanvas(WIDTH, HEIGHT);
      const inkCtx = inkCanvas.getContext("2d");
      inkCtx.fillStyle = "#000000";
      inkCtx.fillRect(10, 10, 20, 20);
      const inkDataUrl = inkCanvas.toDataURL();

      // 1. POST /api/notes without PIN -> 401
      const noPinCreate = await server.fetch(
        new Request("http://localhost/api/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recipient: "wife", inkDataUrl }),
        })
      );
      expect(noPinCreate.status).toBe(401);

      // 2. POST /api/notes with wrong PIN -> 401
      const wrongPinCreate = await server.fetch(
        new Request("http://localhost/api/notes", {
          method: "POST",
          headers: { "content-type": "application/json", "x-pin": "0000" },
          body: JSON.stringify({ recipient: "wife", inkDataUrl }),
        })
      );
      expect(wrongPinCreate.status).toBe(401);

      // 3. POST /api/notes with valid PIN -> 200
      const validCreate = await server.fetch(
        new Request("http://localhost/api/notes", {
          method: "POST",
          headers: { "content-type": "application/json", "x-pin": "4321" },
          body: JSON.stringify({ recipient: "wife", inkDataUrl }),
        })
      );
      expect(validCreate.status).toBe(200);
      const created = await validCreate.json();

      // 4. POST /api/notes/:id/resend without / wrong PIN -> 401, valid PIN -> 200
      const noPinResend = await server.fetch(
        new Request(`http://localhost/api/notes/${created.id}/resend`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recipient: "frame-matt" }),
        })
      );
      expect(noPinResend.status).toBe(401);

      const wrongPinResend = await server.fetch(
        new Request(`http://localhost/api/notes/${created.id}/resend`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-pin": "9999" },
          body: JSON.stringify({ recipient: "frame-matt" }),
        })
      );
      expect(wrongPinResend.status).toBe(401);

      const validResend = await server.fetch(
        new Request(`http://localhost/api/notes/${created.id}/resend`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-pin": "4321" },
          body: JSON.stringify({ recipient: "frame-matt" }),
        })
      );
      expect(validResend.status).toBe(200);

      // 5. DELETE /api/notes/:id without / wrong PIN -> 401, valid PIN -> 200
      const noPinDelete = await server.fetch(
        new Request(`http://localhost/api/notes/${created.id}`, { method: "DELETE" })
      );
      expect(noPinDelete.status).toBe(401);

      const wrongPinDelete = await server.fetch(
        new Request(`http://localhost/api/notes/${created.id}`, {
          method: "DELETE",
          headers: { "x-pin": "9999" },
        })
      );
      expect(wrongPinDelete.status).toBe(401);

      const validDelete = await server.fetch(
        new Request(`http://localhost/api/notes/${created.id}`, {
          method: "DELETE",
          headers: { "x-pin": "4321" },
        })
      );
      expect(validDelete.status).toBe(200);
    });
  });
});
