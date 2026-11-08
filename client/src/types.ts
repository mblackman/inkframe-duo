export interface DeviceItem {
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

export interface NoteItem {
  id: string;
  sender?: string | null;
  recipient: string;
  recipients_json: string;
  caption?: string | null;
  etag: string;
  dither_algo: string;
  created_at: string;
}

export interface ConfigInfo {
  devices: Array<{
    id: string;
    name: string;
    hasToken: boolean;
    sortOrder: number;
  }>;
  webPinRequired: boolean;
}

export interface SystemState {
  devices: DeviceItem[];
  notes: NoteItem[];
  config: ConfigInfo;
}

export type DitherAlgo = "floyd" | "atkinson" | "nearest";

export interface ColorOption {
  name: string;
  hex: string;
  isEraser?: boolean;
}
