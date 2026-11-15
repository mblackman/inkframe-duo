import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Battery,
  Check,
  Clock,
  Copy,
  Droplets,
  Heart,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Sliders,
  Thermometer,
  Wand2,
  Wifi,
  X,
} from "lucide-react";
import type {
  BrushStyle,
  CollageLayoutId,
  DeviceItem,
  DitherAlgo,
  EraserStyle,
  FigureFillMode,
  FigureShape,
  FillReferenceMode,
  ImageLayer,
  InkLayerItem,
  OpticalMixSwatch,
  SelectedItem,
  StampId,
  StampLayer,
  SystemState,
  TemplateId,
  TextBackdrop,
  TextFont,
  TextLayer,
  ToolMode,
} from "./types";
import {
  StrokeSmoother,
  drawShape,
  floodFillBuffer,
  mergeBoundaryBuffers,
  renderStampsToContext,
  type StrokeInputPoint,
} from "./engine/stroke";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  applyBrightnessContrast,
  computeCollageLayout,
  computeSnapPosition,
  getLayerCorners,
  getRotationHandlePos,
  hitTestBox,
  hitTestHandles,
  screenRectToCanvasPoint,
  snapAngle,
  worldToLocal,
  type HandleKind,
  type TransformableBox,
} from "./engine/transforms";
import { quantizeAndDitherRgba } from "./engine/dither";
import {
  OPTICAL_MIX_SWATCHES,
  SPECTRA_PALETTE,
  hexToRgba,
  sampleSpectraColorHex,
} from "./engine/palette-swatches";
import {
  drawImageLayerFrameCrisp,
  drawStamp,
  drawStationeryTemplate,
  drawTextLayer,
  measureTextLayerBounds,
} from "./engine/templates";
import { PostcardHeader } from "./components/PostcardHeader";
import { InkPaletteCard, type InkTextureMode } from "./components/InkPaletteCard";
import { TracingSheetsCard } from "./components/TracingSheetsCard";
import { NIB_SIZE_PRESETS, PencilCaseDock } from "./components/PencilCaseDock";
import { ScrapbookDialog } from "./components/ScrapbookDialog";

const DRAFT_STORAGE_KEY = "inkframe-studio-draft-v1";
const MAX_UNDO = 25;
const MAX_INK_LAYERS = 4;

interface InkLayerSnapshot extends InkLayerItem {
  data: ImageData;
}

interface StudioSnapshot {
  inkLayers: InkLayerSnapshot[];
  activeInkLayerId: string;
  images: ImageLayer[];
  texts: TextLayer[];
  stamps: StampLayer[];
  templateId: TemplateId;
}

type DragGesture =
  | {
      type: "transform";
      handle: HandleKind;
      item: NonNullable<SelectedItem>;
      startPt: { x: number; y: number };
      startBox: TransformableBox;
      startImage?: ImageLayer;
      startText?: TextLayer;
      startStamp?: StampLayer;
      moved: boolean;
    }
  | {
      type: "pinch";
      item: NonNullable<SelectedItem>;
      startDist: number;
      startAngle: number;
      startMid: { x: number; y: number };
      startCenter: { x: number; y: number };
      startScale: number;
      startRotation: number;
      moved: boolean;
    }
  | {
      type: "viewport-pan";
      startClient: { x: number; y: number };
      startPan: { x: number; y: number };
    }
  | {
      type: "viewport-pinch";
      startDist: number;
      startMidClient: { x: number; y: number };
      startZoom: number;
      startPan: { x: number; y: number };
    };

function createDefaultInkLayers(): InkLayerItem[] {
  return [
    { id: "ink-color", name: "Coloring", visible: true, locked: false },
    { id: "ink-lineart", name: "Lineart", visible: true, locked: false },
  ];
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

function parseSqliteUtcMs(iso?: string | null): number | null {
  if (!iso) return null;
  const normalized = iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
}

function estimateDeviceWakeMinutes(device: DeviceItem): number | null {
  const checkInMs = parseSqliteUtcMs(device.last_check_in);
  if (checkInMs === null) return null;
  const sleepS = device.sleep_duration_s || 900;
  const nextWakeMs = checkInMs + sleepS * 1000;
  const diffMin = Math.ceil((nextWakeMs - Date.now()) / 60000);
  if (diffMin <= 0) return 0;
  return diffMin;
}

function downscaleImageToDataUrl(
  img: HTMLImageElement,
  mimeHint: string
): { src: string; width: number; height: number } {
  const maxDim = 1400;
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (w > maxDim || h > maxDim) {
    const ratio = maxDim / Math.max(w, h);
    w = Math.max(1, Math.round(w * ratio));
    h = Math.max(1, Math.round(h * ratio));
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) {
    return { src: img.src, width: w, height: h };
  }
  ctx.drawImage(img, 0, 0, w, h);
  const outMime = mimeHint === "image/png" ? "image/png" : "image/jpeg";
  return {
    src: c.toDataURL(outMime, 0.9),
    width: w,
    height: h,
  };
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

function imageDataToDataUrl(data: ImageData): string {
  const c = document.createElement("canvas");
  c.width = CANVAS_WIDTH;
  c.height = CANVAS_HEIGHT;
  c.getContext("2d")?.putImageData(data, 0, 0);
  return c.toDataURL("image/png");
}

async function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  const img = await loadImageElement(dataUrl);
  const c = document.createElement("canvas");
  c.width = CANVAS_WIDTH;
  c.height = CANVAS_HEIGHT;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  return ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

let supportsDisplayTransition: boolean | undefined;
function canTransitionDisplay(): boolean {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (
    typeof window === "undefined" ||
    !window.CSS?.supports?.("transition-behavior", "allow-discrete") ||
    !document.body
  ) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  supportsDisplayTransition = getComputedStyle(probe).display === "block";
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.CSS?.supports?.("overlay", "auto")) &&
    canTransitionDisplay()
  );
}

async function closeTopLayer(dialog: HTMLDialogElement | null) {
  if (!dialog || !dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute("data-closing", "");
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 400)),
      ]);
    }
    if (!dialog.hasAttribute("data-closing")) return;
    dialog.removeAttribute("data-closing");
  }
  dialog.close();
}

export default function App() {
  const [state, setState] = useState<SystemState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [sendSuccessBanner, setSendSuccessBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusAnnouncement, setStatusAnnouncement] = useState<string>("");
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [simulatingDevice, setSimulatingDevice] = useState<string | null>(null);
  const [simulationResult, setSimulationResult] = useState<{
    deviceId: string;
    text: string;
  } | null>(null);

  // Canvas Viewport State (Crisp 1:1 Fit + Optional Zoom/Pan + E-Ink Peek)
  const [wellSize, setWellSize] = useState<{ width: number; height: number }>({
    width: 820,
    height: 500,
  });
  const [isDesktopViewport, setIsDesktopViewport] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : true
  );
  const [zoomMode, setZoomMode] = useState<"fit" | "manual">("fit");
  const [zoomScale, setZoomScale] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showEInkPreview, setShowEInkPreview] = useState<boolean>(false);
  const [spaceHeld, setSpaceHeld] = useState<boolean>(false);

  // Unified Drawing, Color & Riso Halftone State
  const [selectedRecipient, setSelectedRecipient] = useState<string>("all");
  const [activeTool, setActiveTool] = useState<ToolMode>("pen");
  const [brushSize, setBrushSize] = useState<number>(7);
  const [penFeel, setPenFeel] = useState<"pen" | "pencil">("pen");
  const [inkTexture, setInkTexture] = useState<InkTextureMode>("solid");
  const [mainColor, setMainColor] = useState<string>("#1e1e1e");
  const [subColor, setSubColor] = useState<string>("#e8e4d9");
  const [selectedMixId, setSelectedMixId] = useState<string | null>(null);
  const [eraserStyle, setEraserStyle] = useState<EraserStyle>("hard");
  const [figureShape, setFigureShape] = useState<FigureShape>("rect");
  const [figureFillMode, setFigureFillMode] = useState<FigureFillMode>("stroke");
  const [fillReference, setFillReference] = useState<FillReferenceMode>("all");
  const [ditherAlgo, setDitherAlgo] = useState<DitherAlgo>("floyd");
  const [caption, setCaption] = useState<string>("");
  const [pin, setPin] = useState<string>("");
  const [showHardwareLut, setShowHardwareLut] = useState<Record<string, boolean>>({});
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);

  // Tracing Sheets & Scene Layers
  const [inkLayers, setInkLayers] = useState<InkLayerItem[]>(createDefaultInkLayers);
  const [activeInkLayerId, setActiveInkLayerId] = useState<string>("ink-lineart");
  const [objectsVisible, setObjectsVisible] = useState<boolean>(true);
  const [paperVisible, setPaperVisible] = useState<boolean>(true);
  const [photosVisible] = useState<boolean>(true);

  const [images, setImages] = useState<ImageLayer[]>([]);
  const [texts, setTexts] = useState<TextLayer[]>([]);
  const [stamps, setStamps] = useState<StampLayer[]>([]);
  const [templateId, setTemplateId] = useState<TemplateId>("blank");
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);
  const [isCroppingImage, setIsCroppingImage] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Typewriter Label Draft State
  const [draftText, setDraftText] = useState("");
  const [draftFont, setDraftFont] = useState<TextFont>("handwritten");
  const [draftBackdrop, setDraftBackdrop] = useState<TextBackdrop>("none");
  const [draftFontSize, setDraftFontSize] = useState<number>(32);

  // Interactive Canvas Feedback
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const [isDrawingActive, setIsDrawingActive] = useState(false);
  const [imageCacheVersion, setImageCacheVersion] = useState(0);
  const [canRestoreSent, setCanRestoreSent] = useState(false);

  // Refs
  const wellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const crispUnderlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const objectsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eInkPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrapbookDialogRef = useRef<HTMLDialogElement | null>(null);
  const adminDialogRef = useRef<HTMLDialogElement | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);

  // Multi-Sheet Canvas Registry
  const inkCanvasMapRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const inkRefCallbacksRef = useRef<Map<string, (el: HTMLCanvasElement | null) => void>>(
    new Map()
  );
  const pendingRestorePixelsRef = useRef<Map<string, ImageData>>(new Map());

  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const smootherRef = useRef<StrokeSmoother | null>(null);
  const isDrawingRef = useRef(false);
  const strokeGuardRef = useRef<{
    layerId: string;
    preData: ImageData;
    startTime: number;
    startPt: { x: number; y: number };
    maxDist: number;
  } | null>(null);
  const shapeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const shapeCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const shapeShiftRef = useRef<boolean>(false);
  const activePointersRef = useRef<
    Map<number, { x: number; y: number; clientX: number; clientY: number }>
  >(new Map());
  const gestureRef = useRef<DragGesture | null>(null);

  const undoStack = useRef<StudioSnapshot[]>([]);
  const redoStack = useRef<StudioSnapshot[]>([]);
  const preSendSnapshotRef = useRef<StudioSnapshot | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const sceneRef = useRef({
    inkLayers,
    activeInkLayerId,
    images,
    texts,
    stamps,
    templateId,
  });
  sceneRef.current = {
    inkLayers,
    activeInkLayerId,
    images,
    texts,
    stamps,
    templateId,
  };

  // Derived Pen / Tone Parameters
  const effectiveBrushStyle: BrushStyle = inkTexture === "solid" ? penFeel : inkTexture;
  const effectiveToneSubHex = selectedMixId ? subColor : null;

  // Derived Viewport Scale (crisp 1:1 native max in Fit mode)
  const fitScale = useMemo(() => {
    const availW = Math.max(240, wellSize.width - 20);
    const maxAvailH = isDesktopViewport
      ? Math.max(320, (typeof window !== "undefined" ? window.innerHeight : 900) - 270)
      : 480;
    return clamp(Math.min(availW / CANVAS_WIDTH, maxAvailH / CANVAS_HEIGHT), 0.28, 1.0);
  }, [wellSize.width, isDesktopViewport]);

  const effectiveZoom = zoomMode === "fit" ? fitScale : zoomScale;

  // Track responsive breakpoint & well width
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktopViewport(e.matches);
    setIsDesktopViewport(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = wellRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0) {
          setWellSize({ width, height: height || 480 });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Selected Canvas Objects
  const selectedImage = useMemo(
    () =>
      selectedItem?.kind === "image"
        ? images.find((i) => i.id === selectedItem.id) || null
        : null,
    [images, selectedItem]
  );
  const selectedText = useMemo(
    () =>
      selectedItem?.kind === "text"
        ? texts.find((t) => t.id === selectedItem.id) || null
        : null,
    [texts, selectedItem]
  );
  const selectedStamp = useMemo(
    () =>
      selectedItem?.kind === "stamp"
        ? stamps.find((s) => s.id === selectedItem.id) || null
        : null,
    [stamps, selectedItem]
  );

  // Stable callback ref generator per tracing sheet
  const getInkCanvasRefCallback = useCallback((layerId: string) => {
    let cb = inkRefCallbacksRef.current.get(layerId);
    if (!cb) {
      cb = (el: HTMLCanvasElement | null) => {
        if (el) {
          inkCanvasMapRef.current.set(layerId, el);
          const pending = pendingRestorePixelsRef.current.get(layerId);
          if (pending) {
            const ctx = el.getContext("2d", { willReadFrequently: true });
            ctx?.putImageData(pending, 0, 0);
            pendingRestorePixelsRef.current.delete(layerId);
          }
        } else {
          inkCanvasMapRef.current.delete(layerId);
        }
      };
      inkRefCallbacksRef.current.set(layerId, cb);
    }
    return cb;
  }, []);

  useLayoutEffect(() => {
    if (pendingRestorePixelsRef.current.size === 0) return;
    for (const [layerId, imgData] of Array.from(pendingRestorePixelsRef.current.entries())) {
      const el = inkCanvasMapRef.current.get(layerId);
      if (el) {
        const ctx = el.getContext("2d", { willReadFrequently: true });
        ctx?.putImageData(imgData, 0, 0);
        pendingRestorePixelsRef.current.delete(layerId);
      }
    }
  }, [inkLayers]);

  // Fetch state from server
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/state");
      if (res.ok) {
        const data: SystemState = await res.json();
        setState(data);
      }
    } catch (err) {
      console.error("Failed to fetch state:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 15000);
    return () => clearInterval(interval);
  }, [fetchState]);

  // Setup native dialog cancel & closedby fallback light-dismiss
  useEffect(() => {
    const dialogs = [
      scrapbookDialogRef.current,
      adminDialogRef.current,
      deleteDialogRef.current,
    ].filter((d): d is HTMLDialogElement => d !== null);
    const cleanups: Array<() => void> = [];

    for (const dialog of dialogs) {
      const handleCancel = (e: Event) => {
        e.preventDefault();
        closeTopLayer(dialog);
      };
      dialog.addEventListener("cancel", handleCancel);
      cleanups.push(() => dialog.removeEventListener("cancel", handleCancel));

      if (!("closedBy" in HTMLDialogElement.prototype)) {
        const onClickBackdrop = (event: MouseEvent) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const isDialogContent =
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width;
          if (isDialogContent) return;
          closeTopLayer(dialog);
        };
        dialog.addEventListener("click", onClickBackdrop);
        cleanups.push(() => dialog.removeEventListener("click", onClickBackdrop));
      }
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  // Snapshot helpers
  const readLayerImageData = useCallback((layerId: string): ImageData => {
    const pending = pendingRestorePixelsRef.current.get(layerId);
    if (pending) {
      return new ImageData(new Uint8ClampedArray(pending.data), CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    const canvas = inkCanvasMapRef.current.get(layerId);
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      const d = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      return new ImageData(new Uint8ClampedArray(d.data), CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    return new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
  }, []);

  const cloneSnapshot = useCallback(
    (
      override?: Partial<Omit<StudioSnapshot, "inkLayers">> & {
        inkLayers?: InkLayerSnapshot[];
      }
    ): StudioSnapshot => {
      const cur = sceneRef.current;
      const inkSnaps: InkLayerSnapshot[] = override?.inkLayers
        ? override.inkLayers.map((l) => ({
            id: l.id,
            name: l.name,
            visible: l.visible,
            locked: l.locked,
            data: new ImageData(new Uint8ClampedArray(l.data.data), CANVAS_WIDTH, CANVAS_HEIGHT),
          }))
        : cur.inkLayers.map((l) => ({
            ...l,
            data: readLayerImageData(l.id),
          }));

      return {
        inkLayers: inkSnaps,
        activeInkLayerId: override?.activeInkLayerId ?? cur.activeInkLayerId,
        images: (override?.images ?? cur.images).map((i) => ({ ...i, crop: { ...i.crop } })),
        texts: (override?.texts ?? cur.texts).map((t) => ({ ...t })),
        stamps: (override?.stamps ?? cur.stamps).map((s) => ({ ...s })),
        templateId: override?.templateId ?? cur.templateId,
      };
    },
    [readLayerImageData]
  );

  const pushUndoSnapshot = useCallback(
    (
      override?: Partial<Omit<StudioSnapshot, "inkLayers">> & {
        inkLayers?: InkLayerSnapshot[];
      }
    ) => {
      const snap = cloneSnapshot(override);
      undoStack.current.push(snap);
      if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
      redoStack.current = [];
      setCanUndo(undoStack.current.length > 1);
      setCanRedo(false);
    },
    [cloneSnapshot]
  );

  const applySnapshot = useCallback((snap: StudioSnapshot) => {
    pendingRestorePixelsRef.current.clear();
    for (const lSnap of snap.inkLayers) {
      const cloned = new ImageData(
        new Uint8ClampedArray(lSnap.data.data),
        CANVAS_WIDTH,
        CANVAS_HEIGHT
      );
      const canvas = inkCanvasMapRef.current.get(lSnap.id);
      if (canvas) {
        canvas.getContext("2d", { willReadFrequently: true })?.putImageData(cloned, 0, 0);
      } else {
        pendingRestorePixelsRef.current.set(lSnap.id, cloned);
      }
    }

    setInkLayers(
      snap.inkLayers.map(({ id, name, visible, locked }) => ({
        id,
        name,
        visible,
        locked,
      }))
    );
    setActiveInkLayerId(snap.activeInkLayerId);
    setImages(snap.images.map((i) => ({ ...i, crop: { ...i.crop } })));
    setTexts(snap.texts.map((t) => ({ ...t })));
    setStamps(snap.stamps.map((s) => ({ ...s })));
    setTemplateId(snap.templateId);
    setSelectedItem(null);
    setIsCroppingImage(false);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStack.current.length <= 1) return;
    const current = undoStack.current.pop()!;
    redoStack.current.push(current);
    const previous = undoStack.current[undoStack.current.length - 1];
    applySnapshot(previous);
    setCanUndo(undoStack.current.length > 1);
    setCanRedo(true);
    setStatusAnnouncement("Undid last action");
  }, [applySnapshot]);

  const handleRedo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(next);
    applySnapshot(next);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
    setStatusAnnouncement("Redid action");
  }, [applySnapshot]);

  // Restore Local Draft on Mount (supporting multi-sheet & legacy single-layer drafts)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const restoredImages: ImageLayer[] = Array.isArray(parsed.images) ? parsed.images : [];
          const restoredTexts: TextLayer[] = Array.isArray(parsed.texts) ? parsed.texts : [];
          const restoredStamps: StampLayer[] = Array.isArray(parsed.stamps) ? parsed.stamps : [];
          const restoredTemplate: TemplateId = parsed.templateId || "blank";

          if (typeof parsed.caption === "string") setCaption(parsed.caption);
          if (parsed.ditherAlgo) setDitherAlgo(parsed.ditherAlgo);
          if (typeof parsed.mainColor === "string") setMainColor(parsed.mainColor);
          if (typeof parsed.subColor === "string") setSubColor(parsed.subColor);
          if (typeof parsed.selectedMixId === "string" || parsed.selectedMixId === null) {
            setSelectedMixId(parsed.selectedMixId);
          }
          if (parsed.inkTexture) setInkTexture(parsed.inkTexture);

          let layerSnaps: InkLayerSnapshot[] = [];
          let targetActiveId = "ink-lineart";

          if (Array.isArray(parsed.inkLayers) && parsed.inkLayers.length > 0) {
            for (const item of parsed.inkLayers.slice(0, MAX_INK_LAYERS)) {
              const id = typeof item.id === "string" ? item.id : makeId("ink");
              let data = new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
              if (typeof item.dataUrl === "string" && item.dataUrl.length > 0) {
                try {
                  data = await dataUrlToImageData(item.dataUrl);
                } catch {
                  // Ignore corrupt layer bitmap
                }
              }
              layerSnaps.push({
                id,
                name: typeof item.name === "string" ? item.name : "Sheet",
                visible: item.visible !== false,
                locked: Boolean(item.locked),
                data,
              });
            }
            if (
              typeof parsed.activeInkLayerId === "string" &&
              layerSnaps.some((l) => l.id === parsed.activeInkLayerId)
            ) {
              targetActiveId = parsed.activeInkLayerId;
            } else if (layerSnaps[layerSnaps.length - 1]) {
              targetActiveId = layerSnaps[layerSnaps.length - 1].id;
            }
          } else if (typeof parsed.inkDataUrl === "string" && parsed.inkDataUrl.length > 0) {
            let data = new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
            try {
              data = await dataUrlToImageData(parsed.inkDataUrl);
            } catch {
              // Ignore corrupt legacy draft bitmap
            }
            layerSnaps = [
              {
                id: "ink-color",
                name: "Coloring",
                visible: true,
                locked: false,
                data: new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT),
              },
              { id: "ink-lineart", name: "Lineart", visible: true, locked: false, data },
            ];
            targetActiveId = "ink-lineart";
          }

          if (cancelled) return;

          if (layerSnaps.length > 0) {
            const snap: StudioSnapshot = {
              inkLayers: layerSnaps,
              activeInkLayerId: targetActiveId,
              images: restoredImages,
              texts: restoredTexts,
              stamps: restoredStamps,
              templateId: restoredTemplate,
            };
            applySnapshot(snap);
            undoStack.current = [cloneSnapshot(snap)];
            setCanUndo(false);
            setCanRedo(false);
            return;
          }

          setImages(restoredImages);
          setTexts(restoredTexts);
          setStamps(restoredStamps);
          setTemplateId(restoredTemplate);
        }
      } catch {
        // Ignore malformed localStorage draft
      }

      if (!cancelled) {
        undoStack.current = [cloneSnapshot()];
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applySnapshot, cloneSnapshot]);

  // Debounced Local Draft Persistence
  const saveDraftToStorage = useCallback(() => {
    try {
      const serializedLayers = inkLayers.map((l) => {
        const c = inkCanvasMapRef.current.get(l.id);
        let dataUrl = "";
        if (c) {
          dataUrl = c.toDataURL("image/png");
        } else {
          const pending = pendingRestorePixelsRef.current.get(l.id);
          if (pending) dataUrl = imageDataToDataUrl(pending);
        }
        return { ...l, dataUrl };
      });
      const payload = {
        inkLayers: serializedLayers,
        activeInkLayerId,
        images,
        texts,
        stamps,
        templateId,
        caption,
        ditherAlgo,
        mainColor,
        subColor,
        selectedMixId,
        inkTexture,
      };
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore QuotaExceededError gracefully
    }
  }, [
    inkLayers,
    activeInkLayerId,
    images,
    texts,
    stamps,
    templateId,
    caption,
    ditherAlgo,
    mainColor,
    subColor,
    selectedMixId,
    inkTexture,
  ]);

  useEffect(() => {
    const timer = setTimeout(saveDraftToStorage, 750);
    return () => clearTimeout(timer);
  }, [saveDraftToStorage, canUndo]);

  // Render Background Photo Layer
  const renderBackgroundLayer = useCallback(() => {
    const bgCanvas = bgCanvasRef.current;
    if (!bgCanvas) return;
    const ctx = bgCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.fillStyle = "#e8e4d9";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (!photosVisible) return;

    for (const layer of images) {
      const el = imageCacheRef.current.get(layer.src);
      if (!el) {
        const loadingImg = new Image();
        loadingImg.crossOrigin = "anonymous";
        loadingImg.onload = () => {
          imageCacheRef.current.set(layer.src, loadingImg);
          setImageCacheVersion((v) => v + 1);
        };
        loadingImg.src = layer.src;
        continue;
      }

      const natW = el.naturalWidth || layer.naturalWidth;
      const natH = el.naturalHeight || layer.naturalHeight;
      const sx = layer.crop.x * natW;
      const sy = layer.crop.y * natH;
      const sw = Math.max(1, layer.crop.w * natW);
      const sh = Math.max(1, layer.crop.h * natH);

      let drawSource: HTMLCanvasElement | HTMLImageElement = el;
      let dSx = sx;
      let dSy = sy;
      let dSw = sw;
      let dSh = sh;

      if (
        Math.abs(layer.brightness - 1) >= 0.005 ||
        Math.abs(layer.contrast - 1) >= 0.005
      ) {
        const tmp = document.createElement("canvas");
        const targetW = clamp(Math.round(layer.width * Math.max(1, layer.scale)), 64, 800);
        const targetH = clamp(Math.round(layer.height * Math.max(1, layer.scale)), 64, 480);
        tmp.width = targetW;
        tmp.height = targetH;
        const tctx = tmp.getContext("2d");
        if (tctx) {
          tctx.drawImage(el, sx, sy, sw, sh, 0, 0, targetW, targetH);
          drawSource = applyBrightnessContrast(tmp, layer.brightness, layer.contrast);
          dSx = 0;
          dSy = 0;
          dSw = drawSource.width;
          dSh = drawSource.height;
        }
      }

      ctx.save();
      ctx.translate(layer.x, layer.y);
      ctx.rotate(layer.rotation);
      ctx.scale(layer.flipX ? -layer.scale : layer.scale, layer.scale);
      ctx.drawImage(
        drawSource,
        dSx,
        dSy,
        dSw,
        dSh,
        -layer.width / 2,
        -layer.height / 2,
        layer.width,
        layer.height
      );
      ctx.restore();
    }
  }, [images, photosVisible, imageCacheVersion]);

  // Render Stationery Template & Crisp Photo Cutout Mats
  const renderCrispUnderlay = useCallback(() => {
    const canvas = crispUnderlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (paperVisible) {
      drawStationeryTemplate(ctx, templateId);
    }

    if (photosVisible) {
      for (const layer of images) {
        ctx.save();
        ctx.translate(layer.x, layer.y);
        ctx.rotate(layer.rotation);
        ctx.scale(layer.scale, layer.scale);
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
        ctx.restore();

        drawImageLayerFrameCrisp(ctx, layer);
      }
    }
  }, [images, templateId, paperVisible, photosVisible]);

  // Render Stamps & Text Labels (+ live shape preview)
  const renderObjectsLayer = useCallback(() => {
    const canvas = objectsCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (objectsVisible) {
      for (const st of stamps) {
        drawStamp(ctx, st);
      }
      for (const txt of texts) {
        drawTextLayer(ctx, txt);
      }
    }

    if (shapeOriginRef.current && shapeCurrentRef.current && activeTool === "figure") {
      drawShape(
        ctx,
        figureShape,
        shapeOriginRef.current,
        shapeCurrentRef.current,
        brushSize,
        mainColor,
        {
          fillMode: figureFillMode,
          shiftConstrain: shapeShiftRef.current,
          toneStyle: inkTexture,
          subColorHex: effectiveToneSubHex,
        }
      );
    }
  }, [
    stamps,
    texts,
    objectsVisible,
    activeTool,
    figureShape,
    figureFillMode,
    brushSize,
    mainColor,
    inkTexture,
    effectiveToneSubHex,
  ]);

  // Refresh E-Ink Quantized Peek Preview
  const refreshEInkPreview = useCallback(() => {
    if (!showEInkPreview || isDrawingRef.current) return;
    const previewCanvas = eInkPreviewCanvasRef.current;
    const bgCanvas = bgCanvasRef.current;
    const underlayCanvas = crispUnderlayCanvasRef.current;
    const objCanvas = objectsCanvasRef.current;
    if (!previewCanvas || !bgCanvas || !underlayCanvas || !objCanvas) return;

    const pCtx = previewCanvas.getContext("2d", { willReadFrequently: true });
    const bgCtx = bgCanvas.getContext("2d", { willReadFrequently: true });
    if (!pCtx || !bgCtx) return;

    const mergedInk = document.createElement("canvas");
    mergedInk.width = CANVAS_WIDTH;
    mergedInk.height = CANVAS_HEIGHT;
    const mCtx = mergedInk.getContext("2d", { willReadFrequently: true });
    if (!mCtx) return;

    mCtx.drawImage(underlayCanvas, 0, 0);
    for (const layer of inkLayers) {
      if (!layer.visible) continue;
      const layerCanvas = inkCanvasMapRef.current.get(layer.id);
      if (layerCanvas) mCtx.drawImage(layerCanvas, 0, 0);
    }
    if (objectsVisible) {
      mCtx.drawImage(objCanvas, 0, 0);
    }

    const bgRgba =
      photosVisible && images.length > 0
        ? bgCtx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).data
        : null;
    const inkRgba = mCtx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).data;

    const outRgba = quantizeAndDitherRgba(
      bgRgba,
      inkRgba,
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
      ditherAlgo
    );
    pCtx.putImageData(
      new ImageData(new Uint8ClampedArray(outRgba), CANVAS_WIDTH, CANVAS_HEIGHT),
      0,
      0
    );
  }, [showEInkPreview, images.length, photosVisible, objectsVisible, inkLayers, ditherAlgo]);

  useEffect(() => {
    renderBackgroundLayer();
    renderCrispUnderlay();
    renderObjectsLayer();
    const t = setTimeout(() => {
      refreshEInkPreview();
    }, 30);
    return () => clearTimeout(t);
  }, [renderBackgroundLayer, renderCrispUnderlay, renderObjectsLayer, refreshEInkPreview, canUndo, canRedo]);

  // Clear everything cleanly -> Fresh Card with default 2-sheet stack
  const handleClearAll = useCallback(() => {
    for (const layer of sceneRef.current.inkLayers) {
      inkCanvasMapRef.current
        .get(layer.id)
        ?.getContext("2d", { willReadFrequently: true })
        ?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    const baseLayers = createDefaultInkLayers();
    setInkLayers(baseLayers);
    setActiveInkLayerId("ink-lineart");
    setImages([]);
    setTexts([]);
    setStamps([]);
    setTemplateId("blank");
    setSelectedItem(null);
    setIsCroppingImage(false);
    pushUndoSnapshot({
      inkLayers: baseLayers.map((l) => ({ ...l, data: new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT) })),
      activeInkLayerId: "ink-lineart",
      images: [],
      texts: [],
      stamps: [],
      templateId: "blank",
    });
    setStatusAnnouncement("Started a fresh blank postcard");
  }, [pushUndoSnapshot]);

  // Delete selected sticker / label / photo
  const handleDeleteSelected = useCallback(() => {
    if (!selectedItem) return;
    let nextImages = images;
    let nextTexts = texts;
    let nextStamps = stamps;

    if (selectedItem.kind === "image") {
      nextImages = images.filter((i) => i.id !== selectedItem.id);
      setImages(nextImages);
    } else if (selectedItem.kind === "text") {
      nextTexts = texts.filter((t) => t.id !== selectedItem.id);
      setTexts(nextTexts);
    } else if (selectedItem.kind === "stamp") {
      nextStamps = stamps.filter((s) => s.id !== selectedItem.id);
      setStamps(nextStamps);
    }

    setSelectedItem(null);
    setIsCroppingImage(false);
    pushUndoSnapshot({
      images: nextImages,
      texts: nextTexts,
      stamps: nextStamps,
    });
    setStatusAnnouncement("Removed selected item");
  }, [selectedItem, images, texts, stamps, pushUndoSnapshot]);

  // Viewport Zoom & Pan helpers
  const handleZoomAt = useCallback((nextZoomRaw: number) => {
    const nextZoom = clamp(nextZoomRaw, 0.35, 3);
    setZoomMode("manual");
    setZoomScale(nextZoom);
  }, []);

  const handleZoomIn = useCallback(() => {
    handleZoomAt(effectiveZoom * 1.25);
  }, [effectiveZoom, handleZoomAt]);

  const handleZoomOut = useCallback(() => {
    handleZoomAt(effectiveZoom / 1.25);
  }, [effectiveZoom, handleZoomAt]);

  const handleZoomFit = useCallback(() => {
    setZoomMode("fit");
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // Unified Color & Riso Halftone Handlers
  const handleSelectPureColor = useCallback(
    (hex: string) => {
      if (selectedItem?.kind === "text") {
        const next = texts.map((t) => (t.id === selectedItem.id ? { ...t, color: hex } : t));
        setTexts(next);
        pushUndoSnapshot({ texts: next });
        return;
      }
      if (selectedItem?.kind === "stamp") {
        const next = stamps.map((s) => (s.id === selectedItem.id ? { ...s, color: hex } : s));
        setStamps(next);
        pushUndoSnapshot({ stamps: next });
        return;
      }

      setMainColor(hex);
      if (selectedMixId !== null) {
        setSelectedMixId(null);
        setInkTexture("solid");
      }
      if (activeTool === "eraser") {
        setActiveTool("pen");
      }
    },
    [selectedItem, texts, stamps, selectedMixId, activeTool, pushUndoSnapshot]
  );

  const handleSelectOpticalMix = useCallback(
    (swatch: OpticalMixSwatch) => {
      setMainColor(swatch.primaryHex);
      setSubColor(swatch.secondaryHex);
      setSelectedMixId(swatch.id);
      setInkTexture(swatch.density);
      if (activeTool !== "pen" && activeTool !== "fill" && activeTool !== "figure") {
        setActiveTool("pen");
      }
      setStatusAnnouncement(`Selected Riso halftone: ${swatch.label}`);
    },
    [activeTool]
  );

  const handleChangeInkTexture = useCallback(
    (tex: InkTextureMode) => {
      setInkTexture(tex);
      if (tex === "solid" && selectedMixId !== null) {
        setSelectedMixId(null);
      }
    },
    [selectedMixId]
  );

  // Alt+Click Quick Ink Sampler
  const sampleCanvasColorAt = useCallback(
    (pt: { x: number; y: number }) => {
      const px = clamp(Math.round(pt.x), 0, CANVAS_WIDTH - 1);
      const py = clamp(Math.round(pt.y), 0, CANVAS_HEIGHT - 1);

      const sampleTopLayers = (): [number, number, number] => {
        const readPixel = (canvas: HTMLCanvasElement | null | undefined) => {
          const ctx = canvas?.getContext("2d", { willReadFrequently: true });
          if (!ctx) return null;
          const d = ctx.getImageData(px, py, 1, 1).data;
          return d[3] >= 96 ? ([d[0], d[1], d[2]] as [number, number, number]) : null;
        };

        if (objectsVisible) {
          const obj = readPixel(objectsCanvasRef.current);
          if (obj) return obj;
        }
        for (let i = inkLayers.length - 1; i >= 0; i--) {
          const layer = inkLayers[i];
          if (!layer.visible) continue;
          const ink = readPixel(inkCanvasMapRef.current.get(layer.id));
          if (ink) return ink;
        }
        const underlay = readPixel(crispUnderlayCanvasRef.current);
        if (underlay) return underlay;
        if (photosVisible && images.length > 0) {
          const bg = readPixel(bgCanvasRef.current);
          if (bg) return bg;
        }
        return [232, 228, 217];
      };

      const [r, g, b] = sampleTopLayers();
      const sampledHex = sampleSpectraColorHex(r, g, b);
      const name = SPECTRA_PALETTE.find((c) => c.hex === sampledHex)?.name ?? sampledHex;

      setMainColor(sampledHex);
      setSelectedMixId(null);
      setStatusAnnouncement(`Sampled ink: ${name}`);
    },
    [inkLayers, objectsVisible, photosVisible, images.length]
  );

  // Keyboard Shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      const isTextInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (isTextInput) return;
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        if (isTextInput) return;
        e.preventDefault();
        handleRedo();
        return;
      }

      if (isTextInput) return;

      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }

      if (e.key === "Escape" && selectedItem) {
        setSelectedItem(null);
        setIsCroppingImage(false);
        return;
      }

      if ((e.key === "Backspace" || e.key === "Delete") && selectedItem) {
        e.preventDefault();
        handleDeleteSelected();
        return;
      }

      if (
        selectedItem &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 2;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;

        if (selectedItem.kind === "image") {
          const next = images.map((i) =>
            i.id === selectedItem.id ? { ...i, x: i.x + dx, y: i.y + dy } : i
          );
          setImages(next);
          pushUndoSnapshot({ images: next });
        } else if (selectedItem.kind === "text") {
          const next = texts.map((t) =>
            t.id === selectedItem.id ? { ...t, x: t.x + dx, y: t.y + dy } : t
          );
          setTexts(next);
          pushUndoSnapshot({ texts: next });
        } else if (selectedItem.kind === "stamp") {
          const next = stamps.map((s) =>
            s.id === selectedItem.id ? { ...s, x: s.x + dx, y: s.y + dy } : s
          );
          setStamps(next);
          pushUndoSnapshot({ stamps: next });
        }
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key.toLowerCase();
      switch (k) {
        case "v":
          setActiveTool("arrange");
          break;
        case "p":
        case "b":
          setActiveTool("pen");
          setSelectedItem(null);
          setIsCroppingImage(false);
          break;
        case "e":
          setActiveTool("eraser");
          setSelectedItem(null);
          setIsCroppingImage(false);
          break;
        case "u":
          setActiveTool("figure");
          setSelectedItem(null);
          setIsCroppingImage(false);
          break;
        case "g":
          setActiveTool("fill");
          setSelectedItem(null);
          setIsCroppingImage(false);
          break;
        case "t":
          setActiveTool("text");
          break;
        case "s":
          setActiveTool("stamp");
          break;
        case "m":
          setActiveTool("paper");
          setSelectedItem(null);
          break;
        case "0":
          handleZoomFit();
          break;
        case "=":
        case "+":
          handleZoomIn();
          break;
        case "-":
          handleZoomOut();
          break;
        case "[": {
          const idx = NIB_SIZE_PRESETS.findIndex((s) => s >= brushSize);
          const nextSize = idx > 0 ? NIB_SIZE_PRESETS[idx - 1] : NIB_SIZE_PRESETS[0];
          setBrushSize(nextSize);
          break;
        }
        case "]": {
          const idx = NIB_SIZE_PRESETS.findIndex((s) => s > brushSize);
          const nextSize =
            idx >= 0 ? NIB_SIZE_PRESETS[idx] : NIB_SIZE_PRESETS[NIB_SIZE_PRESETS.length - 1];
          setBrushSize(nextSize);
          break;
        }
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6": {
          const entry = SPECTRA_PALETTE[Number(k) - 1];
          if (entry) handleSelectPureColor(entry.hex);
          break;
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };

    const onBlur = () => setSpaceHeld(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [
    handleUndo,
    handleRedo,
    selectedItem,
    handleDeleteSelected,
    images,
    texts,
    stamps,
    pushUndoSnapshot,
    handleZoomFit,
    handleZoomIn,
    handleZoomOut,
    brushSize,
    handleSelectPureColor,
  ]);

  // Add Multiple Photo Files
  const addImageFiles = useCallback(
    async (files: File[]) => {
      const validFiles = files.filter((f) => f.type.startsWith("image/"));
      if (validFiles.length === 0) return;

      try {
        const existingCount = sceneRef.current.images.length;
        const createdLayers: ImageLayer[] = [];

        for (let idx = 0; idx < validFiles.length; idx++) {
          const file = validFiles[idx];
          const url = URL.createObjectURL(file);
          try {
            const imgEl = await loadImageElement(url);
            const scaled = downscaleImageToDataUrl(imgEl, file.type);
            const decoded = await loadImageElement(scaled.src);
            imageCacheRef.current.set(scaled.src, decoded);

            const aspect = scaled.width / Math.max(1, scaled.height);
            const maxW = existingCount === 0 && validFiles.length === 1 ? 520 : 310;
            const maxH = existingCount === 0 && validFiles.length === 1 ? 360 : 230;
            const fitW = maxW / maxH > aspect ? maxH * aspect : maxW;
            const fitH = maxW / maxH > aspect ? maxH : maxW / aspect;

            const offset = (existingCount + idx) % 5;
            createdLayers.push({
              id: makeId("img"),
              src: scaled.src,
              naturalWidth: scaled.width,
              naturalHeight: scaled.height,
              x: CANVAS_WIDTH / 2 + (existingCount > 0 ? (offset - 1) * 26 : 0),
              y: CANVAS_HEIGHT / 2 + (existingCount > 0 ? (offset - 1) * 18 : 0),
              width: fitW,
              height: fitH,
              scale: 1,
              rotation: 0,
              flipX: false,
              brightness: 1.05,
              contrast: 1.12,
              frameStyle: existingCount > 0 || validFiles.length > 1 ? "polaroid" : "none",
              crop: { x: 0, y: 0, w: 1, h: 1 },
            });
          } finally {
            URL.revokeObjectURL(url);
          }
        }

        let nextImages = [...sceneRef.current.images, ...createdLayers];
        if (existingCount === 0 && createdLayers.length > 1) {
          nextImages = computeCollageLayout(
            nextImages,
            createdLayers.length === 2 ? "split" : "scatter"
          );
        }

        const lastAdded = nextImages[nextImages.length - 1];
        setImages(nextImages);
        setActiveTool("arrange");
        setSelectedItem(lastAdded ? { kind: "image", id: lastAdded.id } : null);
        setIsCroppingImage(false);
        pushUndoSnapshot({ images: nextImages });
      } catch (err) {
        console.error("Failed to import image:", err);
        setErrorBanner("Could not read one of the selected photos. Try PNG, JPG, or WebP.");
      }
    },
    [pushUndoSnapshot]
  );

  // Clipboard image paste handler
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addImageFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImageFiles]);

  // Coordinate conversions
  const clientToCanvasPt = (clientX: number, clientY: number): { x: number; y: number } => {
    const el = stageRef.current;
    if (!el) return { x: 0, y: 0 };
    return screenRectToCanvasPoint(clientX, clientY, el.getBoundingClientRect(), false);
  };

  // Compute TransformableBox for any selected item
  const getBoxForItem = useCallback(
    (item: NonNullable<SelectedItem>): TransformableBox | null => {
      if (item.kind === "image") {
        const img = images.find((i) => i.id === item.id);
        if (!img) return null;
        return {
          x: img.x,
          y: img.y,
          width: img.width,
          height: img.height,
          scale: img.scale,
          rotation: img.rotation,
        };
      }
      if (item.kind === "stamp") {
        const st = stamps.find((s) => s.id === item.id);
        if (!st) return null;
        return {
          x: st.x,
          y: st.y,
          width: st.size,
          height: st.size,
          scale: st.scale,
          rotation: st.rotation,
        };
      }
      const txt = texts.find((t) => t.id === item.id);
      if (!txt) return null;
      const ctx = objectsCanvasRef.current?.getContext("2d");
      if (!ctx) return null;
      const bounds = measureTextLayerBounds(ctx, txt);
      return {
        x: txt.x,
        y: txt.y,
        width: bounds.width,
        height: bounds.height,
        scale: txt.scale,
        rotation: txt.rotation,
      };
    },
    [images, stamps, texts]
  );

  // Hit-test topmost object
  const findTopObjectAtPoint = useCallback(
    (px: number, py: number): NonNullable<SelectedItem> | null => {
      const ctx = objectsCanvasRef.current?.getContext("2d");

      if (objectsVisible) {
        for (let i = texts.length - 1; i >= 0; i--) {
          const txt = texts[i];
          if (!ctx) continue;
          const b = measureTextLayerBounds(ctx, txt);
          if (
            hitTestBox(px, py, {
              x: txt.x,
              y: txt.y,
              width: b.width,
              height: b.height,
              scale: txt.scale,
              rotation: txt.rotation,
            })
          ) {
            return { kind: "text", id: txt.id };
          }
        }

        for (let i = stamps.length - 1; i >= 0; i--) {
          const st = stamps[i];
          if (
            hitTestBox(px, py, {
              x: st.x,
              y: st.y,
              width: st.size,
              height: st.size,
              scale: st.scale,
              rotation: st.rotation,
            })
          ) {
            return { kind: "stamp", id: st.id };
          }
        }
      }

      if (photosVisible) {
        for (let i = images.length - 1; i >= 0; i--) {
          const img = images[i];
          if (
            hitTestBox(px, py, {
              x: img.x,
              y: img.y,
              width: img.width,
              height: img.height,
              scale: img.scale,
              rotation: img.rotation,
            })
          ) {
            return { kind: "image", id: img.id };
          }
        }
      }

      return null;
    },
    [images, stamps, texts, objectsVisible, photosVisible]
  );

  const getEditableInkContext = useCallback((): {
    layer: InkLayerItem;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
  } | null => {
    const layer = inkLayers.find((l) => l.id === activeInkLayerId) ?? inkLayers[0];
    if (!layer) return null;
    if (layer.locked) {
      setStatusAnnouncement(`Sheet "${layer.name}" is locked — unlock it first to draw.`);
      return null;
    }
    if (!layer.visible) {
      setStatusAnnouncement(`Sheet "${layer.name}" is hidden — toggle its eye icon first.`);
      return null;
    }
    const canvas = inkCanvasMapRef.current.get(layer.id);
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) return null;
    return { layer, canvas, ctx };
  }, [inkLayers, activeInkLayerId]);

  // Unified Stage Pointer Handlers
  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const isMiddleMouse = e.pointerType === "mouse" && e.button === 1;
    if (e.pointerType === "mouse" && e.button !== 0 && !isMiddleMouse) return;

    const pt = clientToCanvasPt(e.clientX, e.clientY);
    activePointersRef.current.set(e.pointerId, {
      x: pt.x,
      y: pt.y,
      clientX: e.clientX,
      clientY: e.clientY,
    });
    setHoverPoint(pt);

    // Capture pointers cleanly on well when zooming/panning or drawing
    e.currentTarget.setPointerCapture?.(e.pointerId);

    // 2-finger gesture handling
    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());

      if (
        selectedItem &&
        (activeTool === "arrange" || activeTool === "text" || activeTool === "stamp")
      ) {
        const box = getBoxForItem(selectedItem);
        if (box) {
          const dist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
          const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
          gestureRef.current = {
            type: "pinch",
            item: selectedItem,
            startDist: dist,
            startAngle: angle,
            startMid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
            startCenter: { x: box.x, y: box.y },
            startScale: box.scale,
            startRotation: box.rotation,
            moved: false,
          };
          isDrawingRef.current = false;
          return;
        }
      }

      // Cancel accidental <220ms touch-down dot before starting pinch zoom/pan
      if (isDrawingRef.current && strokeGuardRef.current) {
        const guard = strokeGuardRef.current;
        if (Date.now() - guard.startTime < 220 && guard.maxDist < 12) {
          const c = inkCanvasMapRef.current.get(guard.layerId);
          c?.getContext("2d", { willReadFrequently: true })?.putImageData(guard.preData, 0, 0);
        }
        isDrawingRef.current = false;
        setIsDrawingActive(false);
        smootherRef.current = null;
        strokeGuardRef.current = null;
      }
      shapeOriginRef.current = null;
      shapeCurrentRef.current = null;

      const dist = Math.max(
        10,
        Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY)
      );
      gestureRef.current = {
        type: "viewport-pinch",
        startDist: dist,
        startMidClient: {
          x: (pts[0].clientX + pts[1].clientX) / 2,
          y: (pts[0].clientY + pts[1].clientY) / 2,
        },
        startZoom: effectiveZoom,
        startPan: panOffset,
      };
      return;
    }

    // Space+Drag or Middle-Mouse Pan
    if (spaceHeld || isMiddleMouse) {
      if (zoomMode === "fit") {
        setZoomScale(fitScale);
        setZoomMode("manual");
      }
      gestureRef.current = {
        type: "viewport-pan",
        startClient: { x: e.clientX, y: e.clientY },
        startPan: panOffset,
      };
      return;
    }

    // Alt+Click Quick Sampler
    if (e.altKey) {
      sampleCanvasColorAt(pt);
      return;
    }

    // Object Interaction (Photos, Stamps, Labels)
    const isRasterTool =
      activeTool === "pen" ||
      activeTool === "eraser" ||
      activeTool === "figure" ||
      activeTool === "fill";
    const canInteractWithObjects =
      !isRasterTool &&
      (activeTool === "arrange" ||
        activeTool === "text" ||
        activeTool === "stamp" ||
        selectedItem !== null);

    if (canInteractWithObjects) {
      if (selectedItem) {
        const currentBox = getBoxForItem(selectedItem);
        if (currentBox) {
          const handle = hitTestHandles(
            pt.x,
            pt.y,
            currentBox,
            18,
            isCroppingImage && selectedItem.kind === "image"
          );
          if (handle) {
            gestureRef.current = {
              type: "transform",
              handle,
              item: selectedItem,
              startPt: pt,
              startBox: currentBox,
              startImage:
                selectedItem.kind === "image"
                  ? images.find((i) => i.id === selectedItem.id)
                  : undefined,
              startText:
                selectedItem.kind === "text"
                  ? texts.find((t) => t.id === selectedItem.id)
                  : undefined,
              startStamp:
                selectedItem.kind === "stamp"
                  ? stamps.find((s) => s.id === selectedItem.id)
                  : undefined,
              moved: false,
            };
            return;
          }
        }
      }

      const hit = findTopObjectAtPoint(pt.x, pt.y);
      if (hit) {
        setSelectedItem(hit);
        setIsCroppingImage(false);
        const box = getBoxForItem(hit);
        if (box) {
          gestureRef.current = {
            type: "transform",
            handle: "move",
            item: hit,
            startPt: pt,
            startBox: box,
            startImage: hit.kind === "image" ? images.find((i) => i.id === hit.id) : undefined,
            startText: hit.kind === "text" ? texts.find((t) => t.id === hit.id) : undefined,
            startStamp: hit.kind === "stamp" ? stamps.find((s) => s.id === hit.id) : undefined,
            moved: false,
          };
        }
        return;
      }

      setSelectedItem(null);
      setIsCroppingImage(false);
      return;
    }

    // Raster tools on active Tracing Sheet
    if (isRasterTool) {
      setSelectedItem(null);
      setIsCroppingImage(false);

      const target = getEditableInkContext();
      if (!target) return;
      const { layer, ctx: inkCtx } = target;

      // 1. Paint Bucket (respects Lineart & all visible sheets by default)
      if (activeTool === "fill") {
        const inkImgData = inkCtx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        let boundary: Uint8ClampedArray | undefined;
        if (fillReference === "all") {
          const buffers: Array<Uint8ClampedArray | null> = [];
          const underlayCtx = crispUnderlayCanvasRef.current?.getContext("2d", {
            willReadFrequently: true,
          });
          if (underlayCtx && paperVisible) {
            buffers.push(underlayCtx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).data);
          }
          for (const l of inkLayers) {
            if (!l.visible || l.id === layer.id) continue;
            const lc = inkCanvasMapRef.current.get(l.id);
            const lctx = lc?.getContext("2d", { willReadFrequently: true });
            if (lctx) {
              buffers.push(lctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).data);
            }
          }
          boundary = mergeBoundaryBuffers(buffers);
        }

        const fillRgba = hexToRgba(mainColor);
        const secondaryRgba = effectiveToneSubHex ? hexToRgba(effectiveToneSubHex) : null;

        const changed = floodFillBuffer(
          inkImgData.data,
          CANVAS_WIDTH,
          CANVAS_HEIGHT,
          pt.x,
          pt.y,
          fillRgba,
          boundary,
          { mode: inkTexture, secondaryRgba }
        );
        if (changed) {
          inkCtx.putImageData(inkImgData, 0, 0);
          pushUndoSnapshot();
          setTimeout(() => refreshEInkPreview(), 0);
        }
        return;
      }

      // 2. Shape Stencil drag
      if (activeTool === "figure") {
        isDrawingRef.current = true;
        setIsDrawingActive(true);
        shapeOriginRef.current = pt;
        shapeCurrentRef.current = pt;
        shapeShiftRef.current = e.shiftKey;
        renderObjectsLayer();
        return;
      }

      // 3. Freehand Pen or Eraser
      const isErasing = activeTool === "eraser";
      const strokeStyle: BrushStyle | "eraser" = isErasing ? "eraser" : effectiveBrushStyle;
      const preData = inkCtx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      strokeGuardRef.current = {
        layerId: layer.id,
        preData: new ImageData(new Uint8ClampedArray(preData.data), CANVAS_WIDTH, CANVAS_HEIGHT),
        startTime: Date.now(),
        startPt: pt,
        maxDist: 0,
      };

      isDrawingRef.current = true;
      setIsDrawingActive(true);
      const smoother = new StrokeSmoother(brushSize, strokeStyle, {
        stabilization: 2,
        taper: true,
      });
      smootherRef.current = smoother;
      const startStamps = smoother.startStroke({
        x: pt.x,
        y: pt.y,
        time: e.timeStamp || Date.now(),
        pressure: e.pressure,
        pointerType: e.pointerType,
      });
      renderStampsToContext(inkCtx, startStamps, strokeStyle, mainColor, isErasing, {
        subColorHex: effectiveToneSubHex,
        eraserStyle: isErasing ? eraserStyle : "hard",
      });
    }
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pt = clientToCanvasPt(e.clientX, e.clientY);
    setHoverPoint(pt);

    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, {
        x: pt.x,
        y: pt.y,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    }

    const gesture = gestureRef.current;

    if (gesture && gesture.type === "viewport-pan") {
      setPanOffset({
        x: gesture.startPan.x + (e.clientX - gesture.startClient.x),
        y: gesture.startPan.y + (e.clientY - gesture.startClient.y),
      });
      return;
    }

    if (
      gesture &&
      gesture.type === "viewport-pinch" &&
      activePointersRef.current.size >= 2
    ) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.max(
        10,
        Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY)
      );
      const mid = {
        x: (pts[0].clientX + pts[1].clientX) / 2,
        y: (pts[0].clientY + pts[1].clientY) / 2,
      };
      const nextZoom = clamp(gesture.startZoom * (dist / gesture.startDist), 0.35, 3);
      setZoomMode("manual");
      setZoomScale(nextZoom);
      setPanOffset({
        x: gesture.startPan.x + (mid.x - gesture.startMidClient.x),
        y: gesture.startPan.y + (mid.y - gesture.startMidClient.y),
      });
      return;
    }

    if (gesture && gesture.type === "pinch" && activePointersRef.current.size >= 2) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };

      const nextScale = clamp(gesture.startScale * (dist / gesture.startDist), 0.15, 6);
      const nextRot = gesture.startRotation + (angle - gesture.startAngle);
      const nextX = gesture.startCenter.x + (mid.x - gesture.startMid.x);
      const nextY = gesture.startCenter.y + (mid.y - gesture.startMid.y);
      gesture.moved = true;

      if (gesture.item.kind === "image") {
        setImages((prev) =>
          prev.map((i) =>
            i.id === gesture.item.id
              ? { ...i, x: nextX, y: nextY, scale: nextScale, rotation: nextRot }
              : i
          )
        );
      } else if (gesture.item.kind === "text") {
        setTexts((prev) =>
          prev.map((t) =>
            t.id === gesture.item.id
              ? { ...t, x: nextX, y: nextY, scale: nextScale, rotation: nextRot }
              : t
          )
        );
      } else if (gesture.item.kind === "stamp") {
        setStamps((prev) =>
          prev.map((s) =>
            s.id === gesture.item.id
              ? { ...s, x: nextX, y: nextY, scale: nextScale, rotation: nextRot }
              : s
          )
        );
      }
      return;
    }

    if (gesture && gesture.type === "transform") {
      gesture.moved = true;
      const { handle, startBox, startPt, item } = gesture;

      if (handle === "move") {
        const rawX = startBox.x + (pt.x - startPt.x);
        const rawY = startBox.y + (pt.y - startPt.y);
        const snapped = computeSnapPosition(rawX, rawY, 8);
        setSnapGuides({ x: snapped.snapX, y: snapped.snapY });

        if (item.kind === "image") {
          setImages((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, x: snapped.x, y: snapped.y } : i))
          );
        } else if (item.kind === "text") {
          setTexts((prev) =>
            prev.map((t) => (t.id === item.id ? { ...t, x: snapped.x, y: snapped.y } : t))
          );
        } else if (item.kind === "stamp") {
          setStamps((prev) =>
            prev.map((s) => (s.id === item.id ? { ...s, x: snapped.x, y: snapped.y } : s))
          );
        }
        return;
      }

      if (handle === "rotate") {
        const rawAngle = Math.atan2(pt.y - startBox.y, pt.x - startBox.x) + Math.PI / 2;
        const nextRot = snapAngle(rawAngle, e.shiftKey);
        if (item.kind === "image") {
          setImages((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, rotation: nextRot } : i))
          );
        } else if (item.kind === "text") {
          setTexts((prev) =>
            prev.map((t) => (t.id === item.id ? { ...t, rotation: nextRot } : t))
          );
        } else if (item.kind === "stamp") {
          setStamps((prev) =>
            prev.map((s) => (s.id === item.id ? { ...s, rotation: nextRot } : s))
          );
        }
        return;
      }

      if (handle === "nw" || handle === "ne" || handle === "se" || handle === "sw") {
        const initDist = Math.max(8, Math.hypot(startPt.x - startBox.x, startPt.y - startBox.y));
        const currDist = Math.max(4, Math.hypot(pt.x - startBox.x, pt.y - startBox.y));
        const nextScale = clamp(startBox.scale * (currDist / initDist), 0.15, 6);

        if (item.kind === "image") {
          setImages((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, scale: nextScale } : i))
          );
        } else if (item.kind === "text") {
          setTexts((prev) =>
            prev.map((t) => (t.id === item.id ? { ...t, scale: nextScale } : t))
          );
        } else if (item.kind === "stamp") {
          setStamps((prev) =>
            prev.map((s) => (s.id === item.id ? { ...s, scale: nextScale } : s))
          );
        }
        return;
      }

      if (handle.startsWith("crop-") && item.kind === "image" && gesture.startImage) {
        const initImg = gesture.startImage;
        const localStart = worldToLocal(startPt.x, startPt.y, startBox);
        const localNow = worldToLocal(pt.x, pt.y, startBox);
        const fracDx = (localNow.x - localStart.x) / Math.max(10, startBox.width);
        const fracDy = (localNow.y - localStart.y) / Math.max(10, startBox.height);

        let nx = initImg.crop.x;
        let ny = initImg.crop.y;
        let nw = initImg.crop.w;
        let nh = initImg.crop.h;
        let localShiftX = 0;
        let localShiftY = 0;

        if (handle === "crop-e") {
          const dw = clamp(
            fracDx * initImg.crop.w,
            -(initImg.crop.w - 0.15),
            1 - initImg.crop.x - initImg.crop.w
          );
          nw = initImg.crop.w + dw;
          localShiftX = ((nw - initImg.crop.w) / initImg.crop.w) * (initImg.width / 2);
        } else if (handle === "crop-w") {
          const dxCrop = clamp(fracDx * initImg.crop.w, -initImg.crop.x, initImg.crop.w - 0.15);
          nx = initImg.crop.x + dxCrop;
          nw = initImg.crop.w - dxCrop;
          localShiftX = (dxCrop / initImg.crop.w) * (initImg.width / 2);
        } else if (handle === "crop-s") {
          const dh = clamp(
            fracDy * initImg.crop.h,
            -(initImg.crop.h - 0.15),
            1 - initImg.crop.y - initImg.crop.h
          );
          nh = initImg.crop.h + dh;
          localShiftY = ((nh - initImg.crop.h) / initImg.crop.h) * (initImg.height / 2);
        } else if (handle === "crop-n") {
          const dyCrop = clamp(fracDy * initImg.crop.h, -initImg.crop.y, initImg.crop.h - 0.15);
          ny = initImg.crop.y + dyCrop;
          nh = initImg.crop.h - dyCrop;
          localShiftY = (dyCrop / initImg.crop.h) * (initImg.height / 2);
        }

        const newW = initImg.width * (nw / initImg.crop.w);
        const newH = initImg.height * (nh / initImg.crop.h);
        const cos = Math.cos(initImg.rotation);
        const sin = Math.sin(initImg.rotation);
        const sx = localShiftX * initImg.scale;
        const sy = localShiftY * initImg.scale;
        const worldCenterX = initImg.x + (sx * cos - sy * sin);
        const worldCenterY = initImg.y + (sx * sin + sy * cos);

        setImages((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  x: worldCenterX,
                  y: worldCenterY,
                  width: newW,
                  height: newH,
                  crop: { x: nx, y: ny, w: nw, h: nh },
                }
              : i
          )
        );
        return;
      }
    }

    if (isDrawingRef.current && shapeOriginRef.current && activeTool === "figure") {
      shapeCurrentRef.current = pt;
      shapeShiftRef.current = e.shiftKey;
      renderObjectsLayer();
      return;
    }

    if (!isDrawingRef.current || !smootherRef.current) return;
    const inkCanvas = inkCanvasMapRef.current.get(activeInkLayerId);
    const inkCtx = inkCanvas?.getContext("2d", { willReadFrequently: true });
    if (!inkCanvas || !inkCtx) return;

    if (strokeGuardRef.current) {
      const d = Math.hypot(
        pt.x - strokeGuardRef.current.startPt.x,
        pt.y - strokeGuardRef.current.startPt.y
      );
      if (d > strokeGuardRef.current.maxDist) strokeGuardRef.current.maxDist = d;
    }

    const native = e.nativeEvent;
    const coalesced =
      typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const eventsToProcess = coalesced.length > 0 ? coalesced : [native];

    const isErasing = activeTool === "eraser";
    const strokeStyle: BrushStyle | "eraser" = isErasing ? "eraser" : effectiveBrushStyle;
    const allStamps = [];

    for (const cev of eventsToProcess) {
      const cpt = clientToCanvasPt(cev.clientX, cev.clientY);
      const inputPt: StrokeInputPoint = {
        x: cpt.x,
        y: cpt.y,
        time: cev.timeStamp || Date.now(),
        pressure: cev.pressure,
        pointerType: cev.pointerType,
      };
      const segStamps = smootherRef.current.addPoint(inputPt);
      for (let i = 0; i < segStamps.length; i++) {
        allStamps.push(segStamps[i]);
      }
    }

    if (allStamps.length > 0) {
      renderStampsToContext(inkCtx, allStamps, strokeStyle, mainColor, isErasing, {
        subColorHex: effectiveToneSubHex,
        eraserStyle: isErasing ? eraserStyle : "hard",
      });
    }
  };

  const handleStagePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId);
    setSnapGuides({ x: false, y: false });
    strokeGuardRef.current = null;

    const gesture = gestureRef.current;
    if (gesture) {
      if (gesture.type === "viewport-pan" || gesture.type === "viewport-pinch") {
        gestureRef.current = null;
        return;
      }
      const wasMoved = gesture.moved;
      gestureRef.current = null;
      if (wasMoved) pushUndoSnapshot();
      return;
    }

    if (!isDrawingRef.current) return;

    const inkCanvas = inkCanvasMapRef.current.get(activeInkLayerId);
    const inkCtx = inkCanvas?.getContext("2d", { willReadFrequently: true });

    if (
      shapeOriginRef.current &&
      shapeCurrentRef.current &&
      activeTool === "figure" &&
      inkCtx
    ) {
      drawShape(
        inkCtx,
        figureShape,
        shapeOriginRef.current,
        shapeCurrentRef.current,
        brushSize,
        mainColor,
        {
          fillMode: figureFillMode,
          shiftConstrain: shapeShiftRef.current,
          toneStyle: inkTexture,
          subColorHex: effectiveToneSubHex,
        }
      );
      shapeOriginRef.current = null;
      shapeCurrentRef.current = null;
      renderObjectsLayer();
    } else if (smootherRef.current && inkCtx) {
      const isErasing = activeTool === "eraser";
      const strokeStyle: BrushStyle | "eraser" = isErasing ? "eraser" : effectiveBrushStyle;
      const endStamps = smootherRef.current.finishStroke();
      if (endStamps.length > 0) {
        renderStampsToContext(inkCtx, endStamps, strokeStyle, mainColor, isErasing, {
          subColorHex: effectiveToneSubHex,
          eraserStyle: isErasing ? eraserStyle : "hard",
        });
      }
      smootherRef.current = null;
    }

    isDrawingRef.current = false;
    setIsDrawingActive(false);
    pushUndoSnapshot();
    setTimeout(() => refreshEInkPreview(), 0);
  };

  const handleStageDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const pt = clientToCanvasPt(e.clientX, e.clientY);
    const hit = findTopObjectAtPoint(pt.x, pt.y);
    if (hit?.kind === "text") {
      setActiveTool("text");
      setSelectedItem(hit);
      setTimeout(() => {
        textInputRef.current?.focus();
        textInputRef.current?.select();
      }, 20);
    }
  };

  // Tracing Sheet Operations (Up to 4 Sheets)
  const handleAddInkLayer = () => {
    if (inkLayers.length >= MAX_INK_LAYERS) return;
    const newId = makeId("ink");
    const newLayer: InkLayerItem = {
      id: newId,
      name: `Sheet ${inkLayers.length + 1}`,
      visible: true,
      locked: false,
    };
    const idx = inkLayers.findIndex((l) => l.id === activeInkLayerId);
    const insertAt = idx >= 0 ? idx + 1 : inkLayers.length;
    const next = [...inkLayers];
    next.splice(insertAt, 0, newLayer);

    const snaps: InkLayerSnapshot[] = next.map((l) => ({
      ...l,
      data:
        l.id === newId
          ? new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT)
          : readLayerImageData(l.id),
    }));

    setInkLayers(next);
    setActiveInkLayerId(newId);
    pushUndoSnapshot({ inkLayers: snaps, activeInkLayerId: newId });
    setStatusAnnouncement(`Added ${newLayer.name}`);
  };

  const handleMergeDownInkLayer = () => {
    const idx = inkLayers.findIndex((l) => l.id === activeInkLayerId);
    if (idx <= 0) return;
    const top = inkLayers[idx];
    const below = inkLayers[idx - 1];
    if (top.locked || below.locked) {
      setStatusAnnouncement("Unlock both sheets before merging.");
      return;
    }

    const topCanvas = inkCanvasMapRef.current.get(top.id);
    const belowCanvas = inkCanvasMapRef.current.get(below.id);
    const belowCtx = belowCanvas?.getContext("2d", { willReadFrequently: true });
    if (topCanvas && belowCtx) {
      belowCtx.drawImage(topCanvas, 0, 0);
    }

    const next = inkLayers.filter((l) => l.id !== top.id);
    const snaps: InkLayerSnapshot[] = next.map((l) => ({
      ...l,
      data: readLayerImageData(l.id),
    }));

    setInkLayers(next);
    setActiveInkLayerId(below.id);
    pushUndoSnapshot({ inkLayers: snaps, activeInkLayerId: below.id });
    setStatusAnnouncement(`Combined ${top.name} onto ${below.name}`);
  };

  const handleMoveInkLayer = (dir: "up" | "down") => {
    const idx = inkLayers.findIndex((l) => l.id === activeInkLayerId);
    if (idx === -1) return;
    const target = dir === "up" ? idx + 1 : idx - 1;
    if (target < 0 || target >= inkLayers.length) return;
    const next = [...inkLayers];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    setInkLayers(next);
    const snaps: InkLayerSnapshot[] = next.map((l) => ({
      ...l,
      data: readLayerImageData(l.id),
    }));
    pushUndoSnapshot({ inkLayers: snaps });
  };

  const handleClearActiveInkLayer = () => {
    const layer = inkLayers.find((l) => l.id === activeInkLayerId);
    if (!layer) return;
    if (layer.locked) {
      setStatusAnnouncement(`Sheet "${layer.name}" is locked.`);
      return;
    }
    const c = inkCanvasMapRef.current.get(layer.id);
    c?.getContext("2d", { willReadFrequently: true })?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    pushUndoSnapshot();
    setTimeout(() => refreshEInkPreview(), 0);
    setStatusAnnouncement(`Wiped ${layer.name} clean`);
  };

  const handleDeleteActiveInkLayer = () => {
    if (inkLayers.length <= 1) return;
    const idx = inkLayers.findIndex((l) => l.id === activeInkLayerId);
    if (idx === -1) return;
    const removed = inkLayers[idx];
    const next = inkLayers.filter((l) => l.id !== removed.id);
    const nextActive = next[Math.max(0, idx - 1)]?.id ?? next[0].id;
    const snaps: InkLayerSnapshot[] = next.map((l) => ({
      ...l,
      data: readLayerImageData(l.id),
    }));
    setInkLayers(next);
    setActiveInkLayerId(nextActive);
    pushUndoSnapshot({ inkLayers: snaps, activeInkLayerId: nextActive });
    setStatusAnnouncement(`Tossed ${removed.name}`);
  };

  const handleToggleInkLayerVisible = (id: string) => {
    setInkLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)));
  };

  const handleToggleInkLayerLocked = (id: string) => {
    setInkLayers((prev) => prev.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l)));
  };

  const handleRenameInkLayer = (id: string, name: string) => {
    const next = inkLayers.map((l) => (l.id === id ? { ...l, name } : l));
    setInkLayers(next);
    const snaps: InkLayerSnapshot[] = next.map((l) => ({
      ...l,
      data: readLayerImageData(l.id),
    }));
    pushUndoSnapshot({ inkLayers: snaps });
  };

  // Image Cutout Actions
  const handleUpdateImage = (id: string, patch: Partial<ImageLayer>, recordUndo = false) => {
    const next = images.map((img) => (img.id === id ? { ...img, ...patch } : img));
    setImages(next);
    if (recordUndo) {
      pushUndoSnapshot({ images: next });
    }
  };

  const handleApplyCollageLayout = (layout: CollageLayoutId) => {
    const next = computeCollageLayout(images, layout);
    setImages(next);
    setIsCroppingImage(false);
    pushUndoSnapshot({ images: next });
  };

  const handleApplyImageAspectCrop = (id: string, aspect: number | "reset") => {
    const next = images.map((img) => {
      if (img.id !== id) return img;
      if (aspect === "reset") {
        const natAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
        const area = img.width * img.height;
        const newH = Math.sqrt(area / natAspect);
        const newW = newH * natAspect;
        return {
          ...img,
          width: newW,
          height: newH,
          crop: { x: 0, y: 0, w: 1, h: 1 },
        };
      }
      const natAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      let cx = 0;
      let cy = 0;
      let cw = 1;
      let ch = 1;
      if (natAspect > aspect) {
        cw = aspect / natAspect;
        cx = (1 - cw) / 2;
      } else {
        ch = natAspect / aspect;
        cy = (1 - ch) / 2;
      }
      const diag = Math.hypot(img.width, img.height);
      const newH = diag / Math.sqrt(aspect * aspect + 1);
      const newW = newH * aspect;
      return {
        ...img,
        width: newW,
        height: newH,
        crop: { x: cx, y: cy, w: cw, h: ch },
      };
    });
    setImages(next);
    pushUndoSnapshot({ images: next });
  };

  const handleDuplicateImage = (id: string) => {
    const src = images.find((i) => i.id === id);
    if (!src) return;
    const copy: ImageLayer = {
      ...src,
      id: makeId("img"),
      x: src.x + 24,
      y: src.y + 18,
      crop: { ...src.crop },
    };
    const next = [...images, copy];
    setImages(next);
    setSelectedItem({ kind: "image", id: copy.id });
    pushUndoSnapshot({ images: next });
  };

  // Label Actions
  const handleAddNewText = () => {
    const content = draftText.trim() || "Love note!";
    const offset = (texts.length % 4) * 20;
    const layer: TextLayer = {
      id: makeId("txt"),
      text: content,
      x: CANVAS_WIDTH / 2 + offset,
      y: CANVAS_HEIGHT / 2 + offset,
      fontSize: draftFontSize,
      scale: 1,
      rotation: 0,
      color: mainColor,
      font: draftFont,
      backdrop: draftBackdrop,
    };
    const next = [...texts, layer];
    setTexts(next);
    setObjectsVisible(true);
    setDraftText("");
    setSelectedItem({ kind: "text", id: layer.id });
    pushUndoSnapshot({ texts: next });
  };

  const handleChangeDraftText = (val: string) => {
    if (selectedText) {
      const next = texts.map((t) => (t.id === selectedText.id ? { ...t, text: val } : t));
      setTexts(next);
    } else {
      setDraftText(val);
    }
  };

  const handleChangeDraftFont = (font: TextFont) => {
    setDraftFont(font);
    if (selectedText) {
      const next = texts.map((t) => (t.id === selectedText.id ? { ...t, font } : t));
      setTexts(next);
      pushUndoSnapshot({ texts: next });
    }
  };

  const handleChangeDraftBackdrop = (backdrop: TextBackdrop) => {
    setDraftBackdrop(backdrop);
    if (selectedText) {
      const next = texts.map((t) => (t.id === selectedText.id ? { ...t, backdrop } : t));
      setTexts(next);
      pushUndoSnapshot({ texts: next });
    }
  };

  const handleChangeDraftFontSize = (size: number, commit = false) => {
    setDraftFontSize(size);
    if (selectedText) {
      const next = texts.map((t) => (t.id === selectedText.id ? { ...t, fontSize: size } : t));
      setTexts(next);
      if (commit) pushUndoSnapshot({ texts: next });
    }
  };

  // Rubber Stamp Actions
  const handlePlaceStamp = (stampId: StampId) => {
    const offset = (stamps.length % 5) * 26 - 40;
    const layer: StampLayer = {
      id: makeId("st"),
      stampId,
      x: CANVAS_WIDTH / 2 + offset,
      y: CANVAS_HEIGHT / 2 + (offset % 30),
      size: 76,
      scale: 1,
      rotation: 0,
      color: mainColor,
    };
    const next = [...stamps, layer];
    setStamps(next);
    setObjectsVisible(true);
    setSelectedItem({ kind: "stamp", id: layer.id });
    pushUndoSnapshot({ stamps: next });
  };

  const handleRotateSelectedStamp = (deltaRad: number) => {
    if (!selectedStamp) return;
    const next = stamps.map((s) =>
      s.id === selectedStamp.id ? { ...s, rotation: s.rotation + deltaRad } : s
    );
    setStamps(next);
    pushUndoSnapshot({ stamps: next });
  };

  const handleScaleSelectedStamp = (scale: number, commit = false) => {
    if (!selectedStamp) return;
    const next = stamps.map((s) => (s.id === selectedStamp.id ? { ...s, scale } : s));
    setStamps(next);
    if (commit) pushUndoSnapshot({ stamps: next });
  };

  // Stationery Change
  const handleChangeTemplate = (id: TemplateId) => {
    setPaperVisible(true);
    setTemplateId(id);
    pushUndoSnapshot({ templateId: id });
  };

  // Build Composite Ink PNG Data URL
  const buildCompositeInkDataUrl = (): string => {
    const merged = document.createElement("canvas");
    merged.width = CANVAS_WIDTH;
    merged.height = CANVAS_HEIGHT;
    const ctx = merged.getContext("2d");
    if (!ctx) return "";

    if (crispUnderlayCanvasRef.current) ctx.drawImage(crispUnderlayCanvasRef.current, 0, 0);
    for (const layer of inkLayers) {
      if (!layer.visible) continue;
      const layerCanvas = inkCanvasMapRef.current.get(layer.id);
      if (layerCanvas) ctx.drawImage(layerCanvas, 0, 0);
    }
    if (objectsVisible && objectsCanvasRef.current) {
      ctx.drawImage(objectsCanvasRef.current, 0, 0);
    }
    return merged.toDataURL("image/png");
  };

  // Send Postcard to Frame(s)
  const handleSendNote = async () => {
    setErrorBanner(null);
    setIsSending(true);
    try {
      const preSend = cloneSnapshot();
      const backgroundDataUrl =
        photosVisible && images.length > 0 && bgCanvasRef.current
          ? bgCanvasRef.current.toDataURL("image/png")
          : null;
      const inkDataUrl = buildCompositeInkDataUrl();

      const payload = {
        recipient: selectedRecipient,
        inkDataUrl,
        backgroundDataUrl,
        ditherAlgorithm: ditherAlgo,
        exposure: 1.0,
        contrast: 1.0,
        caption: caption.trim() || undefined,
        sender: "Web Studio",
      };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (pin) headers["X-Pin"] = pin;

      const res = await fetch("/api/notes", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to send postcard" }));
        setErrorBanner(err.error || "Failed to send postcard. Check PIN or connection.");
        return;
      }

      const result = await res.json();
      await fetchState();

      preSendSnapshotRef.current = preSend;
      setCanRestoreSent(true);

      // Reset desk cleanly for the next postcard
      for (const layer of sceneRef.current.inkLayers) {
        inkCanvasMapRef.current
          .get(layer.id)
          ?.getContext("2d", { willReadFrequently: true })
          ?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }
      const baseLayers = createDefaultInkLayers();
      setInkLayers(baseLayers);
      setActiveInkLayerId("ink-lineart");
      setImages([]);
      setTexts([]);
      setStamps([]);
      setTemplateId("blank");
      setSelectedItem(null);
      setIsCroppingImage(false);
      setCaption("");
      try {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // Ignore storage error
      }
      pushUndoSnapshot({
        inkLayers: baseLayers.map((l) => ({ ...l, data: new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT) })),
        activeInkLayerId: "ink-lineart",
        images: [],
        texts: [],
        stamps: [],
        templateId: "blank",
      });

      const targetIds: string[] = result.recipients || [];
      const targetedDevices = (state?.devices || []).filter((d) =>
        targetIds.includes(d.device_id)
      );
      const wakeEstimates = targetedDevices
        .map(estimateDeviceWakeMinutes)
        .filter((m): m is number => m !== null);
      const minWake = wakeEstimates.length > 0 ? Math.min(...wakeEstimates) : null;

      const targetLabel =
        selectedRecipient === "all"
          ? targetedDevices.length === 2
            ? "both desk frames"
            : `all ${targetedDevices.length || state?.devices.length || ""} frames`
          : targetedDevices[0]?.display_name || "the frame";

      const wakeText =
        minWake === null
          ? "Press KEY on the frame for an instant refresh, or wait for the ~15m wake cycle."
          : minWake === 0
          ? "Frame wake-up is due now (or press KEY for instant refresh)."
          : `Next wake in ~${minWake}m (or press KEY for instant refresh).`;

      setSendSuccessBanner(`Postcard mailed to ${targetLabel}! ${wakeText}`);
    } catch (err) {
      console.error("Send note error:", err);
      setErrorBanner("Network error while sending postcard to server.");
    } finally {
      setIsSending(false);
    }
  };

  const handleRestoreLastSent = () => {
    if (!preSendSnapshotRef.current) return;
    applySnapshot(preSendSnapshotRef.current);
    pushUndoSnapshot(preSendSnapshotRef.current);
    setCanRestoreSent(false);
    setSendSuccessBanner(null);
  };

  // Re-send Note
  const handleResend = async (noteId: string) => {
    setErrorBanner(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (pin) headers["X-Pin"] = pin;

      const res = await fetch(`/api/notes/${noteId}/resend`, {
        method: "POST",
        headers,
        body: JSON.stringify({ recipient: selectedRecipient }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to send postcard again" }));
        setErrorBanner(err.error || "Invalid PIN or failed to send postcard again.");
        return;
      }

      await fetchState();
      setCanRestoreSent(false);
      setSendSuccessBanner(
        `Postcard queued again for ${formatRecipientFriendly(selectedRecipient)}!`
      );
    } catch (err) {
      console.error("Resend error:", err);
      setErrorBanner("Failed to send postcard again.");
    }
  };

  // Remix Reply onto Coloring + Reply Ink sheets above postcard
  const handleRemixNote = async (noteId: string) => {
    setErrorBanner(null);
    try {
      const src = `/api/notes/${noteId}/preview.png`;
      const imgEl = await loadImageElement(src);
      imageCacheRef.current.set(src, imgEl);

      const remixLayer: ImageLayer = {
        id: makeId("remix"),
        src,
        naturalWidth: imgEl.naturalWidth || CANVAS_WIDTH,
        naturalHeight: imgEl.naturalHeight || CANVAS_HEIGHT,
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT / 2,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        scale: 1,
        rotation: 0,
        flipX: false,
        brightness: 1.0,
        contrast: 1.0,
        frameStyle: "none",
        crop: { x: 0, y: 0, w: 1, h: 1 },
      };

      for (const layer of sceneRef.current.inkLayers) {
        inkCanvasMapRef.current
          .get(layer.id)
          ?.getContext("2d", { willReadFrequently: true })
          ?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }

      const remixSheets: InkLayerItem[] = [
        { id: "ink-color", name: "Coloring", visible: true, locked: false },
        { id: "ink-reply", name: "Reply Ink", visible: true, locked: false },
      ];
      setInkLayers(remixSheets);
      setActiveInkLayerId("ink-reply");
      setImages([remixLayer]);
      setTexts([]);
      setStamps([]);
      setTemplateId("blank");
      setSelectedItem(null);
      setIsCroppingImage(false);
      setActiveTool("pen");

      pushUndoSnapshot({
        inkLayers: remixSheets.map((l) => ({
          ...l,
          data: new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT),
        })),
        activeInkLayerId: "ink-reply",
        images: [remixLayer],
        texts: [],
        stamps: [],
        templateId: "blank",
      });

      await closeTopLayer(scrapbookDialogRef.current);
      setStatusAnnouncement("Loaded postcard onto desk for reply");
    } catch (err) {
      console.error("Remix error:", err);
      setErrorBanner("Could not load postcard onto desk for reply.");
    }
  };

  // Confirm & Delete Note
  const confirmDeleteNote = (noteId: string) => {
    setNoteToDelete(noteId);
    deleteDialogRef.current?.showModal();
  };

  const executeDeleteNote = async () => {
    if (!noteToDelete) return;
    const id = noteToDelete;
    await closeTopLayer(deleteDialogRef.current);
    setNoteToDelete(null);
    setErrorBanner(null);
    try {
      const headers: Record<string, string> = {};
      if (pin) headers["X-Pin"] = pin;

      const res = await fetch(`/api/notes/${id}`, { method: "DELETE", headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to delete postcard" }));
        setErrorBanner(err.error || "Could not delete postcard. Check Studio PIN.");
        return;
      }
      await fetchState();
    } catch (err) {
      console.error("Delete error:", err);
      setErrorBanner("Network error while deleting postcard.");
    }
  };

  // Simulate Frame Poll
  const handleSimulatePoll = async (deviceId: string, ifNoneMatch?: string | null) => {
    setSimulatingDevice(deviceId);
    setSimulationResult(null);
    try {
      const res = await fetch(`/api/devices/${deviceId}/simulate-poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ifNoneMatch,
          batteryPct: Math.floor(75 + Math.random() * 20),
          batteryMv: 4080,
          temperatureC: 22.2,
          humidityPct: 47.0,
        }),
      });
      const data = await res.json();
      setSimulationResult({
        deviceId,
        text: `${data.statusText} (ETag: ${data.etag})`,
      });
      await fetchState();
    } catch (err) {
      console.error("Simulate poll failed:", err);
    } finally {
      setSimulatingDevice(null);
    }
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setStatusAnnouncement("Firmware URL copied");
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      setStatusAnnouncement("Copy failed");
    }
  };

  const formatTimeAgo = (iso?: string | null) => {
    const ms = parseSqliteUtcMs(iso);
    if (ms === null) return "Waiting for first wake-up";
    const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (sec < 60) return "Just now";
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return new Date(ms).toLocaleDateString();
  };

  const formatRecipientFriendly = (recipient: string) => {
    if (recipient === "all") {
      const count = state?.devices?.length || 2;
      if (count === 2) return "Both Frames";
      if (count > 2) return `All ${count} Frames`;
      return state?.devices?.[0]?.display_name.replace(" Desk Frame", "") || "Frame";
    }
    const found = state?.devices.find((d) => d.device_id === recipient);
    return found ? found.display_name.replace(" Desk Frame", "") : recipient;
  };

  const devicesList = state?.devices || [];
  const onlineDevicesCount = devicesList.filter((d) => {
    const ms = parseSqliteUtcMs(d.last_check_in);
    return ms !== null && Date.now() - ms < 3600 * 1000;
  }).length;

  const selectedBox = useMemo(
    () => (selectedItem ? getBoxForItem(selectedItem) : null),
    [selectedItem, getBoxForItem]
  );
  const selectedCorners = useMemo(
    () => (selectedBox ? getLayerCorners(selectedBox) : null),
    [selectedBox]
  );
  const selectedRotHandle = useMemo(
    () => (selectedBox ? getRotationHandlePos(selectedBox) : null),
    [selectedBox]
  );

  const stageCursorClass = spaceHeld
    ? "cursor-grab active:cursor-grabbing"
    : activeTool === "pen" ||
      activeTool === "eraser" ||
      activeTool === "figure" ||
      activeTool === "fill"
    ? "cursor-crosshair"
    : "cursor-default";

  const wellManualHeight = Math.min(Math.max(280, CANVAS_HEIGHT * fitScale + 28), 520);

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <a
        href="#studio-canvas-stage"
        className="visually-hidden focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-[#25467a] focus:px-3 focus:py-1.5 focus:text-xs focus:font-bold focus:text-white focus:shadow-lg"
      >
        Skip to postcard canvas
      </a>

      <p role="status" aria-live="polite" className="visually-hidden">
        {statusAnnouncement}
      </p>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) addImageFiles(files);
          e.target.value = "";
        }}
        className="visually-hidden"
      />

      {/* TOP COMPACT POSTCARD HEADER */}
      <PostcardHeader
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClearAll={handleClearAll}
        showEInkPreview={showEInkPreview}
        onToggleEInkPreview={() => setShowEInkPreview((v) => !v)}
        notesCount={state?.notes.length || 0}
        onOpenScrapbook={() => scrapbookDialogRef.current?.showModal()}
        devicesList={devicesList}
        onlineDevicesCount={onlineDevicesCount}
        onOpenAdmin={() => adminDialogRef.current?.showModal()}
        selectedRecipient={selectedRecipient}
        onChangeRecipient={setSelectedRecipient}
        webPinRequired={Boolean(state?.config.webPinRequired)}
        pin={pin}
        onChangePin={setPin}
        isSending={isSending}
        onSendNote={handleSendNote}
      />

      {/* Gentle Notifications */}
      <div aria-live="polite" className="mx-auto w-full max-w-[1200px] px-3 pt-2 lg:px-5">
        {errorBanner && (
          <div
            role="alert"
            className="mb-2 flex items-center justify-between gap-2 rounded-2xl border-2 border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-800 shadow-sm"
          >
            <span className="flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{errorBanner}</span>
            </span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              aria-label="Dismiss error"
              className="rounded-lg p-1 hover:bg-rose-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {sendSuccessBanner && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-900 shadow-sm">
            <span className="flex items-center gap-1.5">
              <Heart className="h-4 w-4 fill-rose-500 text-rose-500 shrink-0" aria-hidden="true" />
              <span>{sendSuccessBanner}</span>
            </span>
            <div className="flex items-center gap-2">
              {canRestoreSent && (
                <button
                  type="button"
                  onClick={handleRestoreLastSent}
                  className="rounded-xl border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-extrabold text-emerald-900 hover:bg-emerald-100"
                >
                  Bring Card Back
                </button>
              )}
              <button
                type="button"
                onClick={() => setSendSuccessBanner(null)}
                aria-label="Dismiss notification"
                className="rounded-lg p-1 hover:bg-emerald-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MAIN COZY STATIONERY & RISO DESK */}
      <main
        id="drawing-studio"
        className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-5 px-3 py-3 lg:flex-row lg:items-start lg:px-5 lg:py-4"
      >
        {/* Left/Center Column: Washi-Taped Postcard + Pencil Case + Note */}
        <div className="flex min-w-0 flex-1 flex-col items-center gap-3.5">
          {/* Postcard Stage Well */}
          <div
            ref={wellRef}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingFile(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsDraggingFile(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingFile(false);
              const dropped = Array.from(e.dataTransfer.files || []);
              if (dropped.length > 0) addImageFiles(dropped);
            }}
            className={`relative flex w-full items-center justify-center rounded-3xl p-3 ${
              zoomMode === "manual" ? "overflow-hidden border border-dashed border-[var(--card-border)] bg-[#f4ede0]/60" : ""
            } ${isDraggingFile ? "ring-4 ring-[#25467a]/35 bg-[#eef3fb]/60" : ""}`}
            style={{
              height: zoomMode === "manual" ? `${wellManualHeight}px` : undefined,
            }}
          >
            {/* Floating E-Ink Peek Pill */}
            {showEInkPreview && (
              <div className="pointer-events-none absolute left-4 top-3 z-20 rounded-full bg-[#25467a] px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow">
                E-Ink Peek Active
              </div>
            )}

            {/* Physical Postcard Paper + Washi Tape Corners */}
            <div
              className="relative shrink-0 rounded-2xl shadow-[0_14px_34px_rgba(68,54,39,0.16),0_3px_0_var(--card-shadow)] ring-1 ring-[#d8cebc]"
              style={{
                width: `${CANVAS_WIDTH * effectiveZoom}px`,
                height: `${CANVAS_HEIGHT * effectiveZoom}px`,
                transform:
                  panOffset.x !== 0 || panOffset.y !== 0
                    ? `translate(${panOffset.x}px, ${panOffset.y}px)`
                    : undefined,
              }}
            >
              <div
                aria-hidden="true"
                className="washi-tape-amber absolute -left-3 -top-2 z-20 h-4 w-16 -rotate-12 rounded-sm"
              />
              <div
                aria-hidden="true"
                className="washi-tape-rose absolute -right-3 -top-2 z-20 h-4 w-16 rotate-12 rounded-sm"
              />

              <div
                ref={stageRef}
                id="studio-canvas-stage"
                role="application"
                tabIndex={0}
                aria-label="800 by 480 pixel Spectra 6 postcard drawing canvas"
                onPointerDown={handleStagePointerDown}
                onPointerMove={handleStagePointerMove}
                onPointerUp={handleStagePointerUp}
                onPointerCancel={handleStagePointerUp}
                onPointerLeave={() => setHoverPoint(null)}
                onDoubleClick={handleStageDoubleClick}
                className={`relative h-full w-full overflow-hidden rounded-2xl bg-[#e8e4d9] select-none touch-none ${stageCursorClass}`}
              >
                {/* Layer 0: Photos Background */}
                <canvas
                  ref={bgCanvasRef}
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  style={{ imageRendering: effectiveZoom >= 1.5 ? "pixelated" : "auto" }}
                />

                {/* Layer 1: Stationery Template & Crisp Polaroid/Stamp Cutout Mats */}
                <canvas
                  ref={crispUnderlayCanvasRef}
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  style={{ imageRendering: effectiveZoom >= 1.5 ? "pixelated" : "auto" }}
                />

                {/* Layer 2..N: Tracing Sheets (e.g. Coloring beneath Lineart) */}
                {inkLayers.map((layer) => (
                  <canvas
                    key={layer.id}
                    ref={getInkCanvasRefCallback(layer.id)}
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    className={`pointer-events-none absolute inset-0 h-full w-full ${
                      layer.visible ? "opacity-100" : "opacity-0"
                    }`}
                    style={{ imageRendering: effectiveZoom >= 1.5 ? "pixelated" : "auto" }}
                  />
                ))}

                {/* Layer N+1: Stickers & Labels + Live Shape Preview */}
                <canvas
                  ref={objectsCanvasRef}
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  style={{ imageRendering: effectiveZoom >= 1.5 ? "pixelated" : "auto" }}
                />

                {/* Layer N+2: Live E-Ink Quantized Peek Overlay */}
                <canvas
                  ref={eInkPreviewCanvasRef}
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-150 ${
                    showEInkPreview && !isDrawingActive ? "opacity-100" : "opacity-0"
                  }`}
                  style={{ imageRendering: effectiveZoom >= 1.5 ? "pixelated" : "auto" }}
                />

                {/* Interactive Handles & Crisp Brush Nib Ring */}
                <svg
                  viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                >
                  {snapGuides.x && (
                    <line
                      x1={CANVAS_WIDTH / 2}
                      y1={0}
                      x2={CANVAS_WIDTH / 2}
                      y2={CANVAS_HEIGHT}
                      stroke="#25467a"
                      strokeWidth={1.5}
                      strokeDasharray="6 4"
                    />
                  )}
                  {snapGuides.y && (
                    <line
                      x1={0}
                      y1={CANVAS_HEIGHT / 2}
                      x2={CANVAS_WIDTH}
                      y2={CANVAS_HEIGHT / 2}
                      stroke="#25467a"
                      strokeWidth={1.5}
                      strokeDasharray="6 4"
                    />
                  )}

                  {selectedBox && selectedCorners && selectedRotHandle && (
                    <g>
                      <polygon
                        points={selectedCorners.map((c) => `${c.x},${c.y}`).join(" ")}
                        fill="none"
                        stroke={isCroppingImage ? "#b45309" : "#25467a"}
                        strokeWidth={2}
                        strokeDasharray={isCroppingImage ? "5 4" : undefined}
                      />

                      {isCroppingImage && selectedItem?.kind === "image" ? (
                        [
                          {
                            x: (selectedCorners[0].x + selectedCorners[1].x) / 2,
                            y: (selectedCorners[0].y + selectedCorners[1].y) / 2,
                          },
                          {
                            x: (selectedCorners[1].x + selectedCorners[2].x) / 2,
                            y: (selectedCorners[1].y + selectedCorners[2].y) / 2,
                          },
                          {
                            x: (selectedCorners[2].x + selectedCorners[3].x) / 2,
                            y: (selectedCorners[2].y + selectedCorners[3].y) / 2,
                          },
                          {
                            x: (selectedCorners[3].x + selectedCorners[0].x) / 2,
                            y: (selectedCorners[3].y + selectedCorners[0].y) / 2,
                          },
                        ].map((ep, idx) => (
                          <circle
                            key={idx}
                            cx={ep.x}
                            cy={ep.y}
                            r={7}
                            fill="#fef3c7"
                            stroke="#b45309"
                            strokeWidth={2.5}
                          />
                        ))
                      ) : (
                        <>
                          <line
                            x1={(selectedCorners[0].x + selectedCorners[1].x) / 2}
                            y1={(selectedCorners[0].y + selectedCorners[1].y) / 2}
                            x2={selectedRotHandle.x}
                            y2={selectedRotHandle.y}
                            stroke="#25467a"
                            strokeWidth={2}
                          />
                          <circle
                            cx={selectedRotHandle.x}
                            cy={selectedRotHandle.y}
                            r={8}
                            fill="#ffffff"
                            stroke="#25467a"
                            strokeWidth={2.5}
                          />
                          {selectedCorners.map((c, idx) => (
                            <rect
                              key={idx}
                              x={c.x - 6}
                              y={c.y - 6}
                              width={12}
                              height={12}
                              rx={3}
                              fill="#ffffff"
                              stroke="#25467a"
                              strokeWidth={2.5}
                            />
                          ))}
                        </>
                      )}
                    </g>
                  )}

                  {hoverPoint &&
                    !spaceHeld &&
                    (activeTool === "pen" ||
                      activeTool === "eraser" ||
                      activeTool === "figure") && (
                      <circle
                        cx={hoverPoint.x}
                        cy={hoverPoint.y}
                        r={Math.max(2, brushSize / 2)}
                        fill="none"
                        stroke={activeTool === "eraser" ? "#9e2a1f" : mainColor}
                        strokeWidth={1.5 / Math.max(0.5, effectiveZoom)}
                        strokeDasharray={activeTool === "eraser" ? "3 2" : undefined}
                        opacity={0.85}
                      />
                    )}
                </svg>

                {isDraggingFile && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#25467a]/25 backdrop-blur-[1px]">
                    <div className="rounded-2xl border-2 border-dashed border-white bg-[#25467a]/95 px-5 py-2.5 text-xs font-extrabold text-white shadow-lg">
                      Drop photo(s) onto your postcard!
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Quiet Bottom-Right Zoom Pill */}
            <div className="absolute bottom-2 right-2 z-20 flex items-center gap-0.5 rounded-full border border-[var(--card-border)] bg-[#fffdf9]/90 px-1.5 py-0.5 text-[11px] font-bold text-stone-700 shadow-sm backdrop-blur-sm">
              <button
                type="button"
                onClick={handleZoomOut}
                aria-label="Zoom out"
                title="Zoom out (-)"
                className="rounded-full p-1 hover:bg-[#f5efe4]"
              >
                <Minus className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleZoomFit}
                title="Reset zoom to fit desk (0)"
                className="rounded-full px-1.5 py-0.5 font-mono text-[10px] hover:bg-[#f5efe4]"
              >
                {zoomMode === "fit" && Math.abs(fitScale - 1) < 0.02
                  ? "100%"
                  : `${Math.round(effectiveZoom * 100)}%`}
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                aria-label="Zoom in"
                title="Zoom in (+)"
                className="rounded-full p-1 hover:bg-[#f5efe4]"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* TACTILE PENCIL CASE DOCK */}
          <PencilCaseDock
            activeTool={activeTool}
            onSelectTool={(t) => {
              setActiveTool(t);
              if (
                t === "pen" ||
                t === "eraser" ||
                t === "figure" ||
                t === "fill" ||
                t === "paper"
              ) {
                setSelectedItem(null);
                setIsCroppingImage(false);
              }
            }}
            brushSize={brushSize}
            onChangeBrushSize={setBrushSize}
            penFeel={penFeel}
            onChangePenFeel={setPenFeel}
            inkTexture={inkTexture}
            hasMixActive={selectedMixId !== null}
            onSwitchToSolid={() => handleChangeInkTexture("solid")}
            eraserStyle={eraserStyle}
            onChangeEraserStyle={setEraserStyle}
            onClearActiveInkLayer={handleClearActiveInkLayer}
            figureShape={figureShape}
            onChangeFigureShape={setFigureShape}
            figureFillMode={figureFillMode}
            onChangeFigureFillMode={setFigureFillMode}
            fillReference={fillReference}
            onChangeFillReference={setFillReference}
            selectedItem={selectedItem}
            images={images}
            selectedImage={selectedImage}
            isCroppingImage={isCroppingImage}
            onToggleCropImage={() => setIsCroppingImage((v) => !v)}
            onAddPhotosClick={() => fileInputRef.current?.click()}
            onApplyCollageLayout={handleApplyCollageLayout}
            onUpdateImage={handleUpdateImage}
            onApplyImageAspectCrop={handleApplyImageAspectCrop}
            onDuplicateImage={handleDuplicateImage}
            onDeleteSelected={handleDeleteSelected}
            ditherAlgo={ditherAlgo}
            onChangeDitherAlgo={setDitherAlgo}
            selectedText={selectedText}
            draftText={draftText}
            draftFont={draftFont}
            draftBackdrop={draftBackdrop}
            draftFontSize={draftFontSize}
            textInputRef={textInputRef}
            onChangeDraftText={handleChangeDraftText}
            onChangeDraftFont={handleChangeDraftFont}
            onChangeDraftBackdrop={handleChangeDraftBackdrop}
            onChangeDraftFontSize={handleChangeDraftFontSize}
            onAddNewText={handleAddNewText}
            selectedStamp={selectedStamp}
            onPlaceStamp={handlePlaceStamp}
            onRotateSelectedStamp={handleRotateSelectedStamp}
            onScaleSelectedStamp={handleScaleSelectedStamp}
            templateId={templateId}
            onChangeTemplate={handleChangeTemplate}
          />

          {/* Warm Scrapbook Caption Note (single instance) */}
          <div className="mx-auto flex w-full max-w-[820px] items-center gap-2 rounded-2xl border-2 border-[var(--card-border)] bg-[var(--card-surface)] px-3.5 py-2 shadow-[0_3px_0_var(--card-shadow)]">
            <label
              htmlFor="postcard-caption"
              className="shrink-0 text-[11px] font-extrabold uppercase tracking-wide text-[#6b6359]"
            >
              Back of Card
            </label>
            <input
              id="postcard-caption"
              type="text"
              maxLength={80}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Optional little keepsake title for your scrapbook..."
              className="min-w-0 flex-1 bg-transparent text-xs font-bold text-stone-900 placeholder:font-medium placeholder:text-stone-400 focus:outline-none"
            />
          </div>
        </div>

        {/* Right Side Cards: Ink Pots & Tracing Sheets */}
        <aside
          aria-label="Ink palette and tracing sheets"
          className="w-full space-y-4 lg:w-[276px] shrink-0"
        >
          <InkPaletteCard
            mainColor={mainColor}
            selectedMixId={selectedMixId}
            inkTexture={inkTexture}
            onSelectPureColor={handleSelectPureColor}
            onSelectOpticalMix={handleSelectOpticalMix}
            onChangeInkTexture={handleChangeInkTexture}
          />

          <TracingSheetsCard
            inkLayers={inkLayers}
            activeInkLayerId={activeInkLayerId}
            onSelectInkLayer={setActiveInkLayerId}
            onAddInkLayer={handleAddInkLayer}
            onMoveInkLayer={handleMoveInkLayer}
            onMergeDownInkLayer={handleMergeDownInkLayer}
            onClearActiveInkLayer={handleClearActiveInkLayer}
            onDeleteActiveInkLayer={handleDeleteActiveInkLayer}
            onToggleInkLayerVisible={handleToggleInkLayerVisible}
            onToggleInkLayerLocked={handleToggleInkLayerLocked}
            onRenameInkLayer={handleRenameInkLayer}
            objectsVisible={objectsVisible}
            onToggleObjectsVisible={() => setObjectsVisible((v) => !v)}
            paperVisible={paperVisible}
            onTogglePaperVisible={() => setPaperVisible((v) => !v)}
            templateId={templateId}
            onOpenPaperTool={() => setActiveTool("paper")}
            images={images}
            texts={texts}
            stamps={stamps}
          />
        </aside>
      </main>

      {/* =====================================================================
          SCRAPBOOK GALLERY DIALOG
         ===================================================================== */}
      <ScrapbookDialog
        dialogRef={scrapbookDialogRef}
        notes={state?.notes || []}
        selectedRecipientLabel={formatRecipientFriendly(selectedRecipient)}
        showHardwareLut={showHardwareLut}
        onToggleAllHardwareLut={() => {
          const anyOn = Object.values(showHardwareLut).some(Boolean);
          const next: Record<string, boolean> = {};
          state?.notes.forEach((n) => {
            next[n.id] = !anyOn;
          });
          setShowHardwareLut(next);
        }}
        formatRecipientFriendly={formatRecipientFriendly}
        onRemix={handleRemixNote}
        onResend={handleResend}
        onConfirmDelete={confirmDeleteNote}
        onClose={() => closeTopLayer(scrapbookDialogRef.current)}
      />

      {/* =====================================================================
          FRAMES & SETTINGS DIALOG (Warm Craft Theme)
         ===================================================================== */}
      <dialog
        ref={adminDialogRef}
        id="admin-settings-dialog"
        {...({ closedby: "any" } as any)}
        aria-labelledby="admin-dialog-title"
        className="m-auto w-[min(94vw,48rem)] rounded-3xl border-2 border-[var(--card-border)] bg-[#fffdf9] p-0 text-stone-900 shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--card-border)] bg-[#f7f1e6] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#25467a] text-white shadow-sm"
              aria-hidden="true"
            >
              <Sliders className="h-4 w-4" />
            </div>
            <div>
              <h2 id="admin-dialog-title" className="text-sm font-extrabold text-stone-900">
                Desk Frames &amp; Photo Dithering
              </h2>
              <p className="text-[11px] text-[#6b6359]">
                E-paper frame status, firmware check-in URLs &amp; photo print settings
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchState}
              disabled={isLoading}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-white px-2.5 py-1 text-xs font-bold text-stone-800 hover:bg-[#f5efe4]"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => closeTopLayer(adminDialogRef.current)}
              aria-label="Close Frames and Settings"
              className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-xl border border-[var(--card-border)] bg-white p-1.5 text-stone-700 hover:bg-[#f5efe4]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="max-h-[76vh] space-y-5 overflow-y-auto bg-[#faf6ef] p-5">
          <section aria-labelledby="admin-devices-heading">
            <div className="mb-3 flex items-center justify-between">
              <h3
                id="admin-devices-heading"
                className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-[#6b6359]"
              >
                <Wifi className="h-4 w-4 text-[#25467a]" aria-hidden="true" />
                Connected Desk Frames ({devicesList.length})
              </h3>
              <span className="text-xs font-semibold text-[#6b6359]">
                Spectra 6 • 800×480 • 15m wake cycle
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {devicesList.map((device) => {
                const fullPollUrl = `${window.location.origin}/api/frame/${device.device_id}`;
                const isSimulating = simulatingDevice === device.device_id;
                const checkMs = parseSqliteUtcMs(device.last_check_in);
                const hasRecentCheckIn = checkMs !== null && Date.now() - checkMs < 3600 * 1000;

                return (
                  <div
                    key={device.device_id}
                    className="flex flex-col justify-between rounded-2xl border-2 border-[var(--card-border)] bg-[#fffdf9] p-4 shadow-[0_3px_0_var(--card-shadow)]"
                  >
                    <div>
                      <div className="flex items-start justify-between border-b border-[var(--card-border)] pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-extrabold text-stone-900">
                              {device.display_name}
                            </h4>
                            <code className="rounded bg-[#f5efe4] px-1.5 py-0.5 text-[11px] font-mono text-[#6b6359]">
                              {device.device_id}
                            </code>
                          </div>
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-[#6b6359]">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${
                                hasRecentCheckIn ? "bg-emerald-500" : "bg-amber-400"
                              }`}
                              aria-hidden="true"
                            />
                            Last check-in: {formatTimeAgo(device.last_check_in)}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 rounded-full border border-[var(--card-border)] bg-[#faf6ef] px-2.5 py-1">
                          <Battery
                            className={`h-3.5 w-3.5 ${
                              (device.battery_pct ?? 100) > 40 ? "text-emerald-600" : "text-amber-600"
                            }`}
                            aria-hidden="true"
                          />
                          <span className="text-xs font-bold text-stone-800">
                            {device.battery_pct !== null && device.battery_pct !== undefined
                              ? `${device.battery_pct}%`
                              : "USB"}
                          </span>
                        </div>
                      </div>

                      <div className="relative mt-3 aspect-[5/3] overflow-hidden rounded-xl border border-[var(--card-border)] bg-[#e8e4d9]">
                        <img
                          src={
                            device.active_note_id
                              ? `/api/notes/${device.active_note_id}/preview.png`
                              : `/api/frame/${device.device_id}?t=${Date.now()}`
                          }
                          alt={`Active display on ${device.display_name}`}
                          width={800}
                          height={480}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                        <div className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-0.5 font-mono text-[10px] text-white">
                          ETag: {device.active_etag || "welcome"}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between text-xs text-[#6b6359]">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Thermometer className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />
                            {device.temperature_c ? `${device.temperature_c.toFixed(1)}°C` : "--"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Droplets className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                            {device.humidity_pct ? `${device.humidity_pct.toFixed(1)}%` : "--"}
                          </span>
                        </div>
                        {device.sleep_duration_s && (
                          <span className="flex items-center gap-1 text-[11px]">
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            Sleep: {Math.round(device.sleep_duration_s / 60)}m
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 border-t border-[var(--card-border)] pt-3">
                      <p className="mb-1.5 text-[11px] font-bold text-[#6b6359]">
                        ESP32 Firmware URL:
                      </p>
                      <div className="flex items-center gap-1.5">
                        <code className="flex-1 truncate select-all overflow-hidden rounded-lg border border-[var(--card-border)] bg-[#faf6ef] px-2 py-1 text-[11px] font-mono text-stone-800">
                          {fullPollUrl}
                        </code>
                        <button
                          type="button"
                          onClick={() => handleCopyUrl(fullPollUrl)}
                          aria-label={`Copy firmware URL for ${device.display_name}`}
                          className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-[var(--card-border)] bg-white px-2 py-1 text-xs font-bold text-stone-700 hover:bg-[#f5efe4]"
                        >
                          {copiedUrl === fullPollUrl ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSimulatePoll(device.device_id, device.active_etag)}
                          disabled={isSimulating}
                          aria-label={`Simulate hardware check-in for ${device.display_name}`}
                          className="inline-flex min-h-[30px] items-center gap-1 rounded-lg bg-stone-800 px-2.5 py-1 text-xs font-bold text-white hover:bg-stone-900 disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${isSimulating ? "animate-spin" : ""}`}
                            aria-hidden="true"
                          />
                          <span>Simulate</span>
                        </button>
                      </div>

                      {simulationResult && simulationResult.deviceId === device.device_id && (
                        <div className="mt-2 rounded-lg bg-[#f5efe4] p-2 text-xs font-mono text-stone-800">
                          {simulationResult.text}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section
            aria-labelledby="admin-pipeline-heading"
            className="rounded-2xl border-2 border-[var(--card-border)] bg-[#fffdf9] p-4 shadow-[0_3px_0_var(--card-shadow)]"
          >
            <h3
              id="admin-pipeline-heading"
              className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-[#6b6359]"
            >
              <Wand2 className="h-4 w-4 text-[#25467a]" aria-hidden="true" />
              Photo Print Dithering
            </h3>

            <p className="mb-2 text-xs text-[#6b6359]">
              Controls how imported photo cutouts blend onto the 6 e-paper pigments (hand-drawn lines, Riso halftones, labels, and stamps stay razor-crisp).
            </p>
            <div
              role="group"
              aria-label="Photo dithering algorithm"
              className="inline-flex rounded-xl border border-[var(--card-border)] bg-[#f5efe4] p-1"
            >
              {(["floyd", "atkinson", "bayer", "nearest"] as DitherAlgo[]).map((algo) => (
                <button
                  key={algo}
                  type="button"
                  aria-pressed={ditherAlgo === algo}
                  onClick={() => setDitherAlgo(algo)}
                  className={`min-h-[30px] rounded-lg px-3 py-1 text-xs font-bold capitalize transition ${
                    ditherAlgo === algo
                      ? "bg-[#25467a] text-white shadow-sm"
                      : "text-stone-700 hover:bg-white"
                  }`}
                >
                  {algo}
                </button>
              ))}
            </div>
          </section>
        </div>
      </dialog>

      {/* =====================================================================
          DELETE SCRAPBOOK POSTCARD CONFIRMATION DIALOG
         ===================================================================== */}
      <dialog
        ref={deleteDialogRef}
        id="delete-note-dialog"
        {...({ closedby: "any" } as any)}
        aria-labelledby="delete-dialog-title"
        className="m-auto w-[min(90vw,24rem)] rounded-3xl border-2 border-[var(--card-border)] bg-[#fffdf9] p-6 text-stone-900 shadow-xl"
      >
        <h2 id="delete-dialog-title" className="text-base font-extrabold text-stone-900">
          Toss this postcard?
        </h2>
        <p className="mt-1.5 text-xs text-[#6b6359]">
          This removes the doodle from your shared Postcard Scrapbook.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => closeTopLayer(deleteDialogRef.current)}
            className="min-h-[36px] rounded-xl border border-[var(--card-border)] bg-white px-4 py-1.5 text-xs font-bold text-stone-700 hover:bg-[#f5efe4]"
          >
            Keep It
          </button>
          <button
            type="button"
            onClick={executeDeleteNote}
            className="min-h-[36px] rounded-xl bg-rose-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-rose-700"
          >
            Delete Postcard
          </button>
        </div>
      </dialog>
    </div>
  );
}
