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

export type DitherAlgo = "floyd" | "atkinson" | "bayer" | "nearest";

export interface ColorOption {
  name: string;
  hex: string;
  isWhite?: boolean;
}

export type ToolMode = "arrange" | "draw" | "eraser" | "text" | "stamp" | "paper";

export type BrushStyle = "pen" | "marker" | "calligraphy" | "halftone";

export type DrawMode = "freehand" | "line" | "rect" | "circle" | "heart" | "fill";

export type TemplateId =
  | "blank"
  | "airmail"
  | "postcard"
  | "dotted"
  | "memo"
  | "tictactoe"
  | "hangman";

export type StampId =
  | "heart"
  | "star"
  | "coffee"
  | "sun"
  | "cloud"
  | "postmark"
  | "bubble"
  | "cat"
  | "arrow"
  | "check";

export type FrameStyle = "none" | "polaroid" | "stamp";

export type CollageLayoutId = "full" | "split" | "scatter" | "strip";

export interface ImageCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageLayer {
  id: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  flipX: boolean;
  brightness: number;
  contrast: number;
  frameStyle: FrameStyle;
  crop: ImageCrop;
}

export type TextFont = "handwritten" | "typewriter" | "bold" | "pixel";

export type TextBackdrop = "none" | "pill-light" | "pill-dark";

export interface TextLayer {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  scale: number;
  rotation: number;
  color: string;
  font: TextFont;
  backdrop: TextBackdrop;
}

export interface StampLayer {
  id: string;
  stampId: StampId;
  x: number;
  y: number;
  size: number;
  scale: number;
  rotation: number;
  color: string;
}

export type SelectedItem = {
  kind: "image" | "text" | "stamp";
  id: string;
} | null;
