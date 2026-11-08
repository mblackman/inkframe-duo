import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadAppConfig, resolveTargetDeviceIds, type AppConfig } from "./config";
import { AppDatabase, getDb } from "./db";
import { renderHybridNote, renderWelcomeFrame, type DitherAlgorithm } from "./palette";

export function cleanEtag(etag?: string | null): string {
  if (!etag) return "";
  let clean = etag.trim();
  if (clean.startsWith("W/")) clean = clean.substring(2);
  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.substring(1, clean.length - 1);
  }
  return clean;
}

export function createServer(customConfig?: AppConfig, customDb?: AppDatabase) {
  const config = customConfig || loadAppConfig();
  const db = customDb || getDb();

  // Ensure configured devices are seeded into database
  db.syncDevices(config.devices);

  const server = Bun.serve({
    port: config.port,
    async fetch(req) {
      const url = new URL(req.url);

      // CORS headers for local dev / cross-origin preview
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, If-None-Match, X-Battery-Percentage, X-Battery-Voltage, X-Ambient-Temperature, X-Ambient-Humidity, X-Firmware-Version, X-Sleep-Duration, X-Pin",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // -----------------------------------------------------------------------
      // 0. Healthcheck
      // -----------------------------------------------------------------------
      if (url.pathname === "/api/health") {
        const devices = db.getAllDevices();
        return Response.json(
          {
            status: "ok",
            time: new Date().toISOString(),
            devicesCount: devices.length,
            configuredDevices: config.devices.map((d) => d.id),
          },
          { headers: corsHeaders }
        );
      }

      // -----------------------------------------------------------------------
      // 1. ESP32-PhotoFrame Polling Endpoint: GET /api/frame/:deviceId
      // -----------------------------------------------------------------------
      if (req.method === "GET" && url.pathname.startsWith("/api/frame/")) {
        const rawDeviceId = url.pathname.replace("/api/frame/", "").trim();
        const deviceId = decodeURIComponent(rawDeviceId);
        const device = db.getDevice(deviceId);

        if (!device) {
          return new Response(`Unknown device_id: ${deviceId}`, {
            status: 404,
            headers: corsHeaders,
          });
        }

        // Validate Bearer Token if configured for this device or globally
        const expectedToken = device.token || config.globalFrameToken;
        if (expectedToken) {
          const authHeader = req.headers.get("authorization") || "";
          const queryToken = url.searchParams.get("token") || "";
          const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
          const providedToken = bearerMatch ? bearerMatch[1].trim() : queryToken.trim();

          if (providedToken !== expectedToken) {
            return new Response("Unauthorized: invalid device token", {
              status: 401,
              headers: {
                ...corsHeaders,
                "WWW-Authenticate": 'Bearer realm="InkFrame"',
              },
            });
          }
        }

        // Ingest telemetry headers sent by aitjcize/esp32-photoframe firmware
        const rawBattPct = req.headers.get("x-battery-percentage");
        const rawBattMv = req.headers.get("x-battery-voltage");
        const rawTempC = req.headers.get("x-ambient-temperature");
        const rawHumPct = req.headers.get("x-ambient-humidity");
        const rawFwVer = req.headers.get("x-firmware-version");
        const rawSleepDur = req.headers.get("x-sleep-duration");

        let batteryPct: number | null = null;
        if (rawBattPct !== null) {
          const parsed = Number(rawBattPct);
          // Omit -1 as firmware sends -1 when running on USB without battery
          if (!isNaN(parsed) && parsed >= 0) {
            batteryPct = parsed;
          }
        }

        let batteryMv: number | null = null;
        if (rawBattMv !== null) {
          const parsed = Number(rawBattMv);
          if (!isNaN(parsed) && parsed > 0) {
            // Normalize volts (e.g. 4.12) to millivolts (4120)
            batteryMv = parsed < 20 ? Math.round(parsed * 1000) : Math.round(parsed);
          }
        }

        db.updateDeviceTelemetry(device.device_id, {
          batteryPct,
          batteryMv,
          temperatureC: rawTempC !== null && !isNaN(Number(rawTempC)) ? Number(rawTempC) : null,
          humidityPct: rawHumPct !== null && !isNaN(Number(rawHumPct)) ? Number(rawHumPct) : null,
          firmwareVersion: rawFwVer ? rawFwVer.trim() : null,
          sleepDurationS: rawSleepDur !== null && !isNaN(Number(rawSleepDur)) ? Number(rawSleepDur) : null,
        });

        // Determine current ETag
        const activeEtag = device.active_etag || `"e6-welcome-${device.device_id}"`;

        // Check incoming If-None-Match caching header -> 304 saves battery & panel flash
        const clientEtag = req.headers.get("if-none-match");
        if (clientEtag && cleanEtag(clientEtag) === cleanEtag(activeEtag)) {
          return new Response(null, {
            status: 304,
            headers: {
              ...corsHeaders,
              ETag: activeEtag,
              "Cache-Control": "no-cache",
            },
          });
        }

        // If an active note is queued, serve its device PNG
        if (device.active_note_id) {
          const devicePngPath = join(db.notesDir, `${device.active_note_id}-device.png`);
          if (existsSync(devicePngPath)) {
            const imgBytes = readFileSync(devicePngPath);
            return new Response(imgBytes, {
              status: 200,
              headers: {
                ...corsHeaders,
                "Content-Type": "image/png",
                "Content-Length": String(imgBytes.byteLength),
                ETag: activeEtag,
                "Cache-Control": "no-cache",
              },
            });
          }
        }

        // Otherwise, serve or generate the first-boot welcome card
        const welcomePath = join(db.dataDir, `welcome-${device.device_id}.png`);
        if (!existsSync(welcomePath)) {
          const welcome = renderWelcomeFrame(device.display_name, device.device_id);
          writeFileSync(welcomePath, welcome.devicePngBuffer);
        }

        const welcomeBytes = readFileSync(welcomePath);
        return new Response(welcomeBytes, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "image/png",
            "Content-Length": String(welcomeBytes.byteLength),
            ETag: activeEtag,
            "Cache-Control": "no-cache",
          },
        });
      }

      // -----------------------------------------------------------------------
      // 2. Submit New Handwritten Note: POST /api/notes
      // -----------------------------------------------------------------------
      if (req.method === "POST" && url.pathname === "/api/notes") {
        if (config.webPin) {
          const pin = req.headers.get("x-pin");
          if (pin !== config.webPin) {
            return Response.json(
              { error: "Invalid or missing PIN" },
              { status: 401, headers: corsHeaders }
            );
          }
        }

        const body = await req.json().catch(() => null);
        if (!body) {
          return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
        }

        const {
          recipient,
          recipients,
          sender = "Anonymous",
          caption = "",
          backgroundDataUrl = null,
          inkDataUrl,
          ditherAlgorithm = "floyd",
          exposure = 1.05,
          contrast = 1.15,
        } = body;

        if (!inkDataUrl && !backgroundDataUrl) {
          return Response.json(
            { error: "At least inkDataUrl or backgroundDataUrl is required" },
            { status: 400, headers: corsHeaders }
          );
        }

        // Render dual-layer hybrid note
        const { devicePngBuffer, previewPngBuffer } = await renderHybridNote({
          backgroundDataUrl,
          inkDataUrl,
          ditherAlgorithm: ditherAlgorithm as DitherAlgorithm,
          exposure: Number(exposure),
          contrast: Number(contrast),
        });

        // Compute deterministic content hash & ETag
        const hash = createHash("sha256").update(devicePngBuffer).digest("hex").slice(0, 10);
        const noteId = `${Date.now()}-${hash}`;
        const etag = `"e6-${hash}"`;

        writeFileSync(join(db.notesDir, `${noteId}-device.png`), devicePngBuffer);
        writeFileSync(join(db.notesDir, `${noteId}-preview.png`), previewPngBuffer);

        // Resolve target devices
        const targetInput = recipients || recipient || "all";
        const targetDeviceIds = resolveTargetDeviceIds(targetInput, config.devices);

        db.insertNote({
          id: noteId,
          sender,
          recipient: Array.isArray(targetInput) ? targetInput.join(", ") : String(targetInput),
          recipients: targetDeviceIds,
          caption,
          etag,
          ditherAlgo: ditherAlgorithm,
        });

        // Update active notes for all targeted devices
        for (const devId of targetDeviceIds) {
          db.setDeviceActiveNote(devId, noteId, etag);
        }

        return Response.json(
          {
            id: noteId,
            recipients: targetDeviceIds,
            etag,
            previewUrl: `/api/notes/${noteId}/preview.png`,
            deviceUrl: `/api/notes/${noteId}/device.png`,
          },
          { headers: corsHeaders }
        );
      }

      // -----------------------------------------------------------------------
      // 3. Re-Send Historical Note: POST /api/notes/:id/resend
      // -----------------------------------------------------------------------
      if (req.method === "POST" && url.pathname.match(/^\/api\/notes\/[^/]+\/resend$/)) {
        const parts = url.pathname.split("/");
        const noteId = parts[3];
        const note = db.getNote(noteId);
        if (!note) {
          return Response.json({ error: "Note not found" }, { status: 404, headers: corsHeaders });
        }

        const body = await req.json().catch(() => ({}));
        const targetInput = body?.recipients || body?.recipient || JSON.parse(note.recipients_json || "[]");
        const targetDeviceIds = resolveTargetDeviceIds(targetInput, config.devices);

        for (const devId of targetDeviceIds) {
          db.setDeviceActiveNote(devId, note.id, note.etag);
        }

        return Response.json(
          {
            ok: true,
            noteId: note.id,
            etag: note.etag,
            recipients: targetDeviceIds,
          },
          { headers: corsHeaders }
        );
      }

      // -----------------------------------------------------------------------
      // 4. Delete Note: DELETE /api/notes/:id
      // -----------------------------------------------------------------------
      if (req.method === "DELETE" && url.pathname.match(/^\/api\/notes\/[^/]+$/)) {
        const noteId = url.pathname.split("/")[3];
        db.deleteNote(noteId);

        const devP = join(db.notesDir, `${noteId}-device.png`);
        const prvP = join(db.notesDir, `${noteId}-preview.png`);
        if (existsSync(devP)) unlinkSync(devP);
        if (existsSync(prvP)) unlinkSync(prvP);

        return Response.json({ ok: true, deleted: noteId }, { headers: corsHeaders });
      }

      // -----------------------------------------------------------------------
      // 5. Serve Images: GET /api/notes/:id/preview.png & device.png
      // -----------------------------------------------------------------------
      if (req.method === "GET" && url.pathname.match(/^\/api\/notes\/[^/]+\/(preview|device)\.png$/)) {
        const parts = url.pathname.split("/");
        const noteId = parts[3];
        const type = parts[4].replace(".png", "");
        const filePath = join(db.notesDir, `${noteId}-${type}.png`);

        if (!existsSync(filePath)) {
          return new Response("Image not found", { status: 404, headers: corsHeaders });
        }

        const imgBytes = readFileSync(filePath);
        return new Response(imgBytes, {
          headers: {
            ...corsHeaders,
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }

      // -----------------------------------------------------------------------
      // 6. Simulate Frame Check-In: POST /api/devices/:deviceId/simulate-poll
      // -----------------------------------------------------------------------
      if (req.method === "POST" && url.pathname.match(/^\/api\/devices\/[^/]+\/simulate-poll$/)) {
        const deviceId = url.pathname.split("/")[3];
        const body = (await req.json().catch(() => ({}))) || {};

        const simulatedHeaders: Record<string, string> = {
          "x-battery-percentage": String(body.batteryPct ?? 88),
          "x-battery-voltage": String(body.batteryMv ? body.batteryMv / 1000 : 4.05),
          "x-ambient-temperature": String(body.temperatureC ?? 21.8),
          "x-ambient-humidity": String(body.humidityPct ?? 48.2),
          "x-firmware-version": String(body.firmwareVersion ?? "v2.1.0"),
          "x-sleep-duration": String(body.sleepDurationS ?? 900),
        };

        if (body.ifNoneMatch) {
          simulatedHeaders["if-none-match"] = body.ifNoneMatch;
        }

        const pollReq = new Request(`http://localhost:${config.port}/api/frame/${deviceId}`, {
          method: "GET",
          headers: simulatedHeaders,
        });

        const pollRes = await server.fetch(pollReq);
        const etag = pollRes.headers.get("etag");
        const status = pollRes.status;

        return Response.json(
          {
            simulated: true,
            status,
            statusText: status === 304 ? "304 Not Modified" : "200 OK (Image Refreshed)",
            etag,
            headersSent: simulatedHeaders,
          },
          { headers: corsHeaders }
        );
      }

      // -----------------------------------------------------------------------
      // 7. System State: GET /api/state
      // -----------------------------------------------------------------------
      if (req.method === "GET" && url.pathname === "/api/state") {
        const devices = db.getAllDevices();
        const notes = db.getRecentNotes(50);
        return Response.json(
          {
            devices,
            notes,
            config: {
              devices: config.devices.map((d) => ({
                id: d.id,
                name: d.name,
                hasToken: Boolean(d.token || config.globalFrameToken),
                sortOrder: d.sortOrder,
              })),
              webPinRequired: Boolean(config.webPin),
            },
          },
          { headers: corsHeaders }
        );
      }

      // -----------------------------------------------------------------------
      // 8. Static Web UI Files (dist/client/)
      // -----------------------------------------------------------------------
      const staticDir = join(process.cwd(), "dist/client");
      let filePath = join(staticDir, url.pathname === "/" ? "index.html" : url.pathname.slice(1));

      if (existsSync(filePath)) {
        return new Response(Bun.file(filePath));
      }

      // Fallback for SPA routing if index.html exists
      const indexPath = join(staticDir, "index.html");
      if (existsSync(indexPath)) {
        return new Response(Bun.file(indexPath));
      }

      // Fallback response if static UI hasn't been built yet
      return new Response(
        `<!DOCTYPE html>
<html>
  <head>
    <title>InkFrame Duo Server</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body { font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; line-height: 1.5; color: #1e1e1e; background: #fdfcf9; }
      h1 { color: #25467a; }
      code { background: #e8e4d9; padding: 2px 6px; border-radius: 4px; }
      a { color: #9e2a1f; }
    </style>
  </head>
  <body>
    <h1>InkFrame Duo Server is Running</h1>
    <p>API is active. To launch the web studio interface:</p>
    <ul>
      <li>In production / docker: Run <code>bun run build</code> then refresh this page.</li>
      <li>In development: Run <code>bun run dev:client</code> for Vite hot reloading on port 5173.</li>
    </ul>
    <p>API Endpoints: <a href="/api/state">/api/state</a> | <a href="/api/health">/api/health</a></p>
  </body>
</html>`,
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
        }
      );
    },
  });

  return { server, config, db };
}

// Auto-start server when run directly
if (import.meta.main) {
  const { config } = createServer();
  console.log(`🖼️  InkFrame Duo server listening on http://localhost:${config.port}`);
  console.log(
    `📡 Configured frames: ${config.devices.map((d) => `${d.name} (/api/frame/${d.id})`).join(", ")}`
  );
}
