export interface DeviceConfig {
  id: string;
  name: string;
  token?: string;
  sortOrder: number;
}

export interface AppConfig {
  port: number;
  dataDir: string;
  globalFrameToken?: string;
  webPin?: string;
  devices: DeviceConfig[];
}

export function parseDevicesConfig(rawConfig?: string, globalToken?: string): DeviceConfig[] {
  const fallbackDevices: DeviceConfig[] = [
    { id: "frame-wife", name: "Wife's Desk Frame", sortOrder: 0 },
    { id: "frame-matt", name: "Matt's Desk Frame", sortOrder: 1 },
  ];

  if (!rawConfig || !rawConfig.trim()) {
    return fallbackDevices.map((d) => ({
      ...d,
      token: d.token || globalToken || undefined,
    }));
  }

  const trimmed = rawConfig.trim();
  const result: DeviceConfig[] = [];

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        parsed.forEach((item, index) => {
          if (item && typeof item === "object") {
            const id = String(item.id || item.deviceId || "").trim().toLowerCase();
            const name = String(item.name || item.displayName || id).trim();
            const token = item.token ? String(item.token).trim() : globalToken;
            if (id) {
              result.push({ id, name: name || id, token, sortOrder: index });
            }
          }
        });
      }
    } catch {
      // Fall through to comma-separated parser
    }
  }

  if (result.length === 0) {
    const entries = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    entries.forEach((entry, index) => {
      // Format: "id:Display Name[:token]"
      const parts = entry.split(":");
      const id = parts[0]?.trim().toLowerCase();
      if (!id) return;
      const name = parts[1]?.trim() || id;
      const token = parts[2]?.trim() || globalToken || undefined;
      result.push({ id, name, token, sortOrder: index });
    });
  }

  return result.length > 0
    ? result
    : fallbackDevices.map((d) => ({ ...d, token: globalToken || undefined }));
}

export function resolveTargetDeviceIds(
  target: string | string[] | undefined,
  configuredDevices: DeviceConfig[]
): string[] {
  const allIds = configuredDevices.map((d) => d.id);
  if (!target || target === "all" || target === "both") {
    return allIds;
  }

  const requested = Array.isArray(target) ? target : [target];
  const matched = new Set<string>();

  for (const rawReq of requested) {
    const req = String(rawReq).trim().toLowerCase();
    if (!req) continue;

    if (req === "all" || req === "both") {
      allIds.forEach((id) => matched.add(id));
      continue;
    }

    // Exact match
    const exact = configuredDevices.find((d) => d.id.toLowerCase() === req);
    if (exact) {
      matched.add(exact.id);
      continue;
    }

    // Match short alias: e.g. "wife" matches "frame-wife", "matt" matches "frame-matt"
    const bySubstr = configuredDevices.find(
      (d) =>
        d.id.toLowerCase().includes(req) ||
        d.name.toLowerCase().includes(req) ||
        req.includes(d.id.toLowerCase())
    );
    if (bySubstr) {
      matched.add(bySubstr.id);
      continue;
    }

    // If still not matched, preserve as given (might be a newly added device id)
    matched.add(req);
  }

  return matched.size > 0 ? Array.from(matched) : allIds;
}

export function loadAppConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const port = Number(env.PORT || 3000);
  const dataDir = env.DATA_DIR || "./data";
  const globalFrameToken = env.FRAME_TOKEN?.trim() || undefined;
  const webPin = env.WEB_PIN?.trim() || undefined;
  const devices = parseDevicesConfig(env.INKFRAME_DEVICES, globalFrameToken);

  return {
    port,
    dataDir,
    globalFrameToken,
    webPin,
    devices,
  };
}
