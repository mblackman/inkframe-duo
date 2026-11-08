import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DeviceConfig } from "./config";

export interface DeviceRecord {
  device_id: string;
  display_name: string;
  sort_order: number;
  token?: string | null;
  active_note_id?: string | null;
  active_etag?: string | null;
  battery_pct?: number | null;
  battery_mv?: number | null;
  temperature_c?: number | null;
  humidity_pct?: number | null;
  firmware_version?: string | null;
  sleep_duration_s?: number | null;
  last_check_in?: string | null;
}

export interface NoteRecord {
  id: string;
  sender?: string | null;
  recipient: string;
  recipients_json: string;
  caption?: string | null;
  etag: string;
  dither_algo: string;
  created_at: string;
}

export interface DeviceTelemetryUpdate {
  batteryPct?: number | null;
  batteryMv?: number | null;
  temperatureC?: number | null;
  humidityPct?: number | null;
  firmwareVersion?: string | null;
  sleepDurationS?: number | null;
}

export class AppDatabase {
  public db: Database;
  public dataDir: string;
  public notesDir: string;

  constructor(dataDir = process.env.DATA_DIR || "./data") {
    this.dataDir = dataDir;
    this.notesDir = join(dataDir, "notes");
    mkdirSync(this.notesDir, { recursive: true });

    const dbPath = join(dataDir, "inkframe.sqlite");
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.initTables();
  }

  private initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        sender TEXT,
        recipient TEXT NOT NULL,
        recipients_json TEXT NOT NULL,
        caption TEXT,
        etag TEXT NOT NULL,
        dither_algo TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        token TEXT,
        active_note_id TEXT,
        active_etag TEXT,
        battery_pct INTEGER,
        battery_mv INTEGER,
        temperature_c REAL,
        humidity_pct REAL,
        firmware_version TEXT,
        sleep_duration_s INTEGER,
        last_check_in TEXT,
        FOREIGN KEY (active_note_id) REFERENCES notes(id) ON DELETE SET NULL
      );
    `);
  }

  public syncDevices(configuredDevices: DeviceConfig[]) {
    const upsert = this.db.prepare(`
      INSERT INTO devices (device_id, display_name, sort_order, token, active_etag)
      VALUES ($id, $name, $sortOrder, $token, $activeEtag)
      ON CONFLICT(device_id) DO UPDATE SET
        display_name = excluded.display_name,
        sort_order = excluded.sort_order,
        token = COALESCE(excluded.token, devices.token)
    `);

    for (const d of configuredDevices) {
      upsert.run({
        $id: d.id,
        $name: d.name,
        $sortOrder: d.sortOrder,
        $token: d.token ?? null,
        $activeEtag: `"e6-welcome-${d.id}"`,
      });
    }
  }

  public getAllDevices(): DeviceRecord[] {
    return this.db
      .query("SELECT * FROM devices ORDER BY sort_order ASC, device_id ASC")
      .all() as DeviceRecord[];
  }

  public getDevice(deviceId: string): DeviceRecord | null {
    return (
      (this.db
        .query("SELECT * FROM devices WHERE LOWER(device_id) = LOWER($id)")
        .get({ $id: deviceId }) as DeviceRecord) || null
    );
  }

  public updateDeviceTelemetry(deviceId: string, telemetry: DeviceTelemetryUpdate) {
    this.db
      .prepare(`
        UPDATE devices
        SET battery_pct = COALESCE($batteryPct, battery_pct),
            battery_mv = COALESCE($batteryMv, battery_mv),
            temperature_c = COALESCE($temperatureC, temperature_c),
            humidity_pct = COALESCE($humidityPct, humidity_pct),
            firmware_version = COALESCE($firmwareVersion, firmware_version),
            sleep_duration_s = COALESCE($sleepDurationS, sleep_duration_s),
            last_check_in = datetime('now')
        WHERE LOWER(device_id) = LOWER($id)
      `)
      .run({
        $id: deviceId,
        $batteryPct: telemetry.batteryPct ?? null,
        $batteryMv: telemetry.batteryMv ?? null,
        $temperatureC: telemetry.temperatureC ?? null,
        $humidityPct: telemetry.humidityPct ?? null,
        $firmwareVersion: telemetry.firmwareVersion ?? null,
        $sleepDurationS: telemetry.sleepDurationS ?? null,
      });
  }

  public setDeviceActiveNote(deviceId: string, noteId: string, etag: string) {
    this.db
      .prepare(`
        UPDATE devices
        SET active_note_id = $noteId,
            active_etag = $etag
        WHERE LOWER(device_id) = LOWER($id)
      `)
      .run({
        $id: deviceId,
        $noteId: noteId,
        $etag: etag,
      });
  }

  public insertNote(note: {
    id: string;
    sender?: string;
    recipient: string;
    recipients: string[];
    caption?: string;
    etag: string;
    ditherAlgo: string;
  }) {
    this.db
      .prepare(`
        INSERT INTO notes (id, sender, recipient, recipients_json, caption, etag, dither_algo, created_at)
        VALUES ($id, $sender, $recipient, $recipientsJson, $caption, $etag, $algo, datetime('now'))
      `)
      .run({
        $id: note.id,
        $sender: note.sender || null,
        $recipient: note.recipient,
        $recipientsJson: JSON.stringify(note.recipients),
        $caption: note.caption || null,
        $etag: note.etag,
        $algo: note.ditherAlgo,
      });
  }

  public getRecentNotes(limit = 50): NoteRecord[] {
    return this.db
      .query("SELECT * FROM notes ORDER BY created_at DESC LIMIT $limit")
      .all({ $limit: limit }) as NoteRecord[];
  }

  public getNote(id: string): NoteRecord | null {
    return (
      (this.db
        .query("SELECT * FROM notes WHERE id = $id")
        .get({ $id: id }) as NoteRecord) || null
    );
  }

  public deleteNote(id: string) {
    this.db.prepare("DELETE FROM notes WHERE id = $id").run({ $id: id });
  }

  public close() {
    this.db.close();
  }
}

// Global default singleton initialized from environment
let defaultAppDb: AppDatabase | null = null;

export function getDb(): AppDatabase {
  if (!defaultAppDb) {
    defaultAppDb = new AppDatabase();
  }
  return defaultAppDb;
}
