import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Send,
  RotateCcw,
  Undo2,
  Redo2,
  Trash2,
  Battery,
  Thermometer,
  Droplets,
  Clock,
  Copy,
  Check,
  RefreshCw,
  Sliders,
  Sparkles,
  Wifi,
  Eraser,
  BookOpen,
  X,
  Heart,
  ChevronDown,
  Wand2,
  Move,
  PenTool,
  Type,
  Stamp as StampIcon,
  FileText,
  ImagePlus,
  Eye,
  Reply,
  AlertCircle,
} from "lucide-react";
import type {
  BrushStyle,
  CollageLayoutId,
  ColorOption,
  DeviceItem,
  DitherAlgo,
  DrawMode,
  ImageLayer,
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
  snapAngle,
  worldToLocal,
  type HandleKind,
  type TransformableBox,
} from "./engine/transforms";
import { quantizeAndDitherRgba } from "./engine/dither";
import {
  drawImageLayerFrameCrisp,
  drawStamp,
  drawStationeryTemplate,
  drawTextLayer,
  measureTextLayerBounds,
} from "./engine/templates";
import { StudioToolbars } from "./components/StudioToolbars";

const DRAFT_STORAGE_KEY = "inkframe-studio-draft-v1";
const MAX_UNDO = 25;

const SPECTRA_PALETTE: ColorOption[] = [
  { name: "Ink Black", hex: "#1e1e1e" },
  { name: "Paper White", hex: "#e8e4d9", isWhite: true },
  { name: "Crimson Red", hex: "#9e2a1f" },
  { name: "Sunbeam Yellow", hex: "#d9b82c" },
  { name: "Forest Green", hex: "#2d6a3e" },
  { name: "Cobalt Blue", hex: "#25467a" },
];

const BRUSH_SIZES = [
  { label: "Fine", size: 3, dot: 5 },
  { label: "Medium", size: 6, dot: 8 },
  { label: "Bold", size: 12, dot: 12 },
  { label: "Chubby", size: 24, dot: 16 },
];

interface StudioSnapshot {
  ink: ImageData;
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
    };

function hexToRgba(hex: string): [number, number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b, 255];
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

// Feature detection for top-layer exit transitions
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
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [simulatingDevice, setSimulatingDevice] = useState<string | null>(null);
  const [simulationResult, setSimulationResult] = useState<{ deviceId: string; text: string } | null>(null);

  // Composer & Tool State
  const [selectedRecipient, setSelectedRecipient] = useState<string>("all");
  const [activeTool, setActiveTool] = useState<ToolMode>("draw");
  const [brushStyle, setBrushStyle] = useState<BrushStyle>("pen");
  const [drawMode, setDrawMode] = useState<DrawMode>("freehand");
  const [currentColor, setCurrentColor] = useState<string>("#1e1e1e");
  const [brushSize, setBrushSize] = useState<number>(6);
  const [ditherAlgo, setDitherAlgo] = useState<DitherAlgo>("floyd");
  const [showEInkPreview, setShowEInkPreview] = useState<boolean>(false);
  const [caption, setCaption] = useState<string>("");
  const [pin, setPin] = useState<string>("");
  const [showHardwareLut, setShowHardwareLut] = useState<Record<string, boolean>>({});
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);

  // Multi-Layer Canvas Scene State
  const [images, setImages] = useState<ImageLayer[]>([]);
  const [texts, setTexts] = useState<TextLayer[]>([]);
  const [stamps, setStamps] = useState<StampLayer[]>([]);
  const [templateId, setTemplateId] = useState<TemplateId>("blank");
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);
  const [isCroppingImage, setIsCroppingImage] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Text Creator Drafts
  const [draftText, setDraftText] = useState("");
  const [draftFont, setDraftFont] = useState<TextFont>("handwritten");
  const [draftBackdrop, setDraftBackdrop] = useState<TextBackdrop>("none");

  // Interactive Overlay State
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const [isDrawingActive, setIsDrawingActive] = useState(false);
  const [imageCacheVersion, setImageCacheVersion] = useState(0);
  const [canRestoreSent, setCanRestoreSent] = useState(false);

  // Refs
  const stageRef = useRef<HTMLDivElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const crispUnderlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const objectsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eInkPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const adminDialogRef = useRef<HTMLDialogElement | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);

  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const smootherRef = useRef<StrokeSmoother | null>(null);
  const isDrawingRef = useRef(false);
  const shapeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const shapeCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<DragGesture | null>(null);

  const undoStack = useRef<StudioSnapshot[]>([]);
  const redoStack = useRef<StudioSnapshot[]>([]);
  const preSendSnapshotRef = useRef<StudioSnapshot | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Keep latest scene state in refs for synchronous callbacks & undo snapshots
  const sceneRef = useRef({
    images,
    texts,
    stamps,
    templateId,
  });
  sceneRef.current = { images, texts, stamps, templateId };

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

  // Setup native dialog cancel & backdrop dismissal
  useEffect(() => {
    const dialogs = [adminDialogRef.current, deleteDialogRef.current].filter(
      (d): d is HTMLDialogElement => d !== null
    );
    const cleanups: Array<() => void> = [];

    for (const dialog of dialogs) {
      const handleCancel = (e: Event) => {
        e.preventDefault();
        closeTopLayer(dialog);
      };
      dialog.addEventListener("cancel", handleCancel);
      cleanups.push(() => dialog.removeEventListener("cancel", handleCancel));

      if (!("closedBy" in HTMLDialogElement.prototype)) {
        const isOutside = (e: PointerEvent) => {
          const r = dialog.getBoundingClientRect();
          return (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          );
        };
        let pressedOutside = false;
        const onDown = (e: PointerEvent) => {
          pressedOutside = isOutside(e);
        };
        const onUp = (e: PointerEvent) => {
          if (pressedOutside && isOutside(e)) {
            closeTopLayer(dialog);
          }
        };
        dialog.addEventListener("pointerdown", onDown);
        dialog.addEventListener("pointerup", onUp);
        cleanups.push(() => {
          dialog.removeEventListener("pointerdown", onDown);
          dialog.removeEventListener("pointerup", onUp);
        });
      }
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  // Clone helper for snapshots
  const cloneSnapshot = useCallback(
    (override?: Partial<Omit<StudioSnapshot, "ink">> & { ink?: ImageData }): StudioSnapshot | null => {
      const inkCanvas = inkCanvasRef.current;
      if (!inkCanvas) return null;
      const ctx = inkCanvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;

      const cur = sceneRef.current;
      const inkData = override?.ink ?? ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      return {
        ink: new ImageData(new Uint8ClampedArray(inkData.data), CANVAS_WIDTH, CANVAS_HEIGHT),
        images: (override?.images ?? cur.images).map((i) => ({ ...i, crop: { ...i.crop } })),
        texts: (override?.texts ?? cur.texts).map((t) => ({ ...t })),
        stamps: (override?.stamps ?? cur.stamps).map((s) => ({ ...s })),
        templateId: override?.templateId ?? cur.templateId,
      };
    },
    []
  );

  const pushUndoSnapshot = useCallback(
    (override?: Partial<Omit<StudioSnapshot, "ink">> & { ink?: ImageData }) => {
      const snap = cloneSnapshot(override);
      if (!snap) return;
      undoStack.current.push(snap);
      if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
      redoStack.current = [];
      setCanUndo(undoStack.current.length > 1);
      setCanRedo(false);
    },
    [cloneSnapshot]
  );

  const applySnapshot = useCallback((snap: StudioSnapshot) => {
    const inkCanvas = inkCanvasRef.current;
    if (inkCanvas) {
      const ctx = inkCanvas.getContext("2d", { willReadFrequently: true });
      ctx?.putImageData(snap.ink, 0, 0);
    }
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
  }, [applySnapshot]);

  const handleRedo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(next);
    applySnapshot(next);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  }, [applySnapshot]);

  // Initialize Canvas & Restore Local Draft on Mount
  useEffect(() => {
    const inkCanvas = inkCanvasRef.current;
    if (!inkCanvas) return;
    const ctx = inkCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const restoredImages: ImageLayer[] = Array.isArray(parsed.images) ? parsed.images : [];
        const restoredTexts: TextLayer[] = Array.isArray(parsed.texts) ? parsed.texts : [];
        const restoredStamps: StampLayer[] = Array.isArray(parsed.stamps) ? parsed.stamps : [];
        const restoredTemplate: TemplateId = parsed.templateId || "blank";

        setImages(restoredImages);
        setTexts(restoredTexts);
        setStamps(restoredStamps);
        setTemplateId(restoredTemplate);
        if (typeof parsed.caption === "string") setCaption(parsed.caption);
        if (parsed.ditherAlgo) setDitherAlgo(parsed.ditherAlgo);

        if (parsed.inkDataUrl) {
          loadImageElement(parsed.inkDataUrl)
            .then((img) => {
              ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
              ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
              const snap = cloneSnapshot({
                images: restoredImages,
                texts: restoredTexts,
                stamps: restoredStamps,
                templateId: restoredTemplate,
              });
              if (snap) {
                undoStack.current = [snap];
                setCanUndo(false);
                setCanRedo(false);
              }
            })
            .catch(() => {
              pushUndoSnapshot({
                images: restoredImages,
                texts: restoredTexts,
                stamps: restoredStamps,
                templateId: restoredTemplate,
              });
            });
          return;
        }

        const snap = cloneSnapshot({
          images: restoredImages,
          texts: restoredTexts,
          stamps: restoredStamps,
          templateId: restoredTemplate,
        });
        if (snap) {
          undoStack.current = [snap];
          setCanUndo(false);
        }
        return;
      }
    } catch {
      // Ignore malformed draft
    }

    const initial = cloneSnapshot();
    if (initial) {
      undoStack.current = [initial];
    }
  }, [cloneSnapshot, pushUndoSnapshot]);

  // Debounced Local Draft Persistence
  const saveDraftToStorage = useCallback(() => {
    const inkCanvas = inkCanvasRef.current;
    if (!inkCanvas) return;
    try {
      const payload = {
        inkDataUrl: inkCanvas.toDataURL("image/png"),
        images,
        texts,
        stamps,
        templateId,
        caption,
        ditherAlgo,
      };
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore QuotaExceededError gracefully
    }
  }, [images, texts, stamps, templateId, caption, ditherAlgo]);

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

    for (const layer of images) {
      let el = imageCacheRef.current.get(layer.src);
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
  }, [images, imageCacheVersion]);

  // Render Stationery Template & Crisp Polaroid/Stamp Photo Mats
  const renderCrispUnderlay = useCallback(() => {
    const canvas = crispUnderlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawStationeryTemplate(ctx, templateId);

    for (const layer of images) {
      // Clear stationery lines underneath opaque photo apertures
      ctx.save();
      ctx.translate(layer.x, layer.y);
      ctx.rotate(layer.rotation);
      ctx.scale(layer.scale, layer.scale);
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
      ctx.restore();

      // Draw crisp un-dithered photo frame mat if Polaroid or Stamp
      drawImageLayerFrameCrisp(ctx, layer);
    }
  }, [images, templateId]);

  // Render Stamps & Text Objects Layer (+ optional live drag-shape preview)
  const renderObjectsLayer = useCallback(() => {
    const canvas = objectsCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    for (const st of stamps) {
      drawStamp(ctx, st);
    }
    for (const txt of texts) {
      drawTextLayer(ctx, txt);
    }

    if (
      shapeOriginRef.current &&
      shapeCurrentRef.current &&
      activeTool === "draw" &&
      drawMode !== "freehand" &&
      drawMode !== "fill"
    ) {
      drawShape(
        ctx,
        drawMode,
        shapeOriginRef.current,
        shapeCurrentRef.current,
        brushSize,
        currentColor
      );
    }
  }, [stamps, texts, activeTool, drawMode, brushSize, currentColor]);

  // Refresh Live E-Ink Quantized Preview
  const refreshEInkPreview = useCallback(() => {
    if (!showEInkPreview || isDrawingRef.current) return;
    const previewCanvas = eInkPreviewCanvasRef.current;
    const bgCanvas = bgCanvasRef.current;
    const underlayCanvas = crispUnderlayCanvasRef.current;
    const inkCanvas = inkCanvasRef.current;
    const objCanvas = objectsCanvasRef.current;
    if (!previewCanvas || !bgCanvas || !underlayCanvas || !inkCanvas || !objCanvas) return;

    const pCtx = previewCanvas.getContext("2d", { willReadFrequently: true });
    const bgCtx = bgCanvas.getContext("2d", { willReadFrequently: true });
    if (!pCtx || !bgCtx) return;

    const mergedInk = document.createElement("canvas");
    mergedInk.width = CANVAS_WIDTH;
    mergedInk.height = CANVAS_HEIGHT;
    const mCtx = mergedInk.getContext("2d", { willReadFrequently: true });
    if (!mCtx) return;

    mCtx.drawImage(underlayCanvas, 0, 0);
    mCtx.drawImage(inkCanvas, 0, 0);
    mCtx.drawImage(objCanvas, 0, 0);

    const bgRgba =
      images.length > 0
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
    const outImgData = new ImageData(
      new Uint8ClampedArray(outRgba),
      CANVAS_WIDTH,
      CANVAS_HEIGHT
    );
    pCtx.putImageData(outImgData, 0, 0);
  }, [showEInkPreview, images.length, ditherAlgo]);

  useEffect(() => {
    renderBackgroundLayer();
    renderCrispUnderlay();
    renderObjectsLayer();
    const t = setTimeout(() => {
      refreshEInkPreview();
    }, 30);
    return () => clearTimeout(t);
  }, [
    renderBackgroundLayer,
    renderCrispUnderlay,
    renderObjectsLayer,
    refreshEInkPreview,
    canUndo,
    canRedo,
  ]);

  // Clear everything cleanly
  const handleClearAll = useCallback(() => {
    const inkCanvas = inkCanvasRef.current;
    if (inkCanvas) {
      const ctx = inkCanvas.getContext("2d", { willReadFrequently: true });
      ctx?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    const emptyInk = new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
    setImages([]);
    setTexts([]);
    setStamps([]);
    setTemplateId("blank");
    setSelectedItem(null);
    setIsCroppingImage(false);
    pushUndoSnapshot({
      ink: emptyInk,
      images: [],
      texts: [],
      stamps: [],
      templateId: "blank",
    });
  }, [pushUndoSnapshot]);

  // Delete selected item
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
  }, [selectedItem, images, texts, stamps, pushUndoSnapshot]);

  // Global keyboard shortcuts (Undo/Redo, Arrow nudge, Delete, Escape)
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

      if (isTextInput) return;

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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleUndo,
    handleRedo,
    selectedItem,
    handleDeleteSelected,
    images,
    texts,
    stamps,
    pushUndoSnapshot,
  ]);

  // Add multiple image files (from upload, drop, or clipboard paste)
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
            const maxW = existingCount === 0 && validFiles.length === 1 ? 560 : 320;
            const maxH = existingCount === 0 && validFiles.length === 1 ? 380 : 240;
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
        setErrorBanner("Could not read one of the selected images. Try PNG, JPG, or WebP.");
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
    const rect = el.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * CANVAS_WIDTH,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * CANVAS_HEIGHT,
    };
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

  // Hit-test topmost object in stage
  const findTopObjectAtPoint = useCallback(
    (px: number, py: number): NonNullable<SelectedItem> | null => {
      const ctx = objectsCanvasRef.current?.getContext("2d");

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

      return null;
    },
    [images, stamps, texts]
  );

  // Unified Stage Pointer Handlers
  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    const stageEl = stageRef.current;
    if (!stageEl) return;
    stageEl.setPointerCapture(e.pointerId);

    const pt = clientToCanvasPt(e.clientX, e.clientY);
    activePointersRef.current.set(e.pointerId, pt);
    setHoverPoint(pt);

    // Two-finger touch pinch/rotate on selected layer
    if (activePointersRef.current.size === 2 && selectedItem) {
      const box = getBoxForItem(selectedItem);
      if (box) {
        const pts = Array.from(activePointersRef.current.values());
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

    // Object selection / transform handles when not actively drawing/erasing
    const canInteractWithObjects =
      activeTool === "arrange" ||
      activeTool === "text" ||
      activeTool === "stamp" ||
      selectedItem !== null;

    if (canInteractWithObjects && activeTool !== "draw" && activeTool !== "eraser") {
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
            startImage:
              hit.kind === "image" ? images.find((i) => i.id === hit.id) : undefined,
            startText:
              hit.kind === "text" ? texts.find((t) => t.id === hit.id) : undefined,
            startStamp:
              hit.kind === "stamp" ? stamps.find((s) => s.id === hit.id) : undefined,
            moved: false,
          };
        }
        return;
      }

      setSelectedItem(null);
      setIsCroppingImage(false);
      return;
    }

    // Drawing / Erasing modes on inkCanvas
    if (activeTool === "draw" || activeTool === "eraser") {
      setSelectedItem(null);
      setIsCroppingImage(false);
      const inkCanvas = inkCanvasRef.current;
      const inkCtx = inkCanvas?.getContext("2d", { willReadFrequently: true });
      if (!inkCanvas || !inkCtx) return;

      if (activeTool === "draw" && drawMode === "fill") {
        const inkImgData = inkCtx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        const underlayCtx = crispUnderlayCanvasRef.current?.getContext("2d", {
          willReadFrequently: true,
        });
        const boundary = underlayCtx
          ? underlayCtx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).data
          : undefined;

        const changed = floodFillBuffer(
          inkImgData.data,
          CANVAS_WIDTH,
          CANVAS_HEIGHT,
          pt.x,
          pt.y,
          hexToRgba(currentColor),
          boundary
        );
        if (changed) {
          inkCtx.putImageData(inkImgData, 0, 0);
          pushUndoSnapshot();
        }
        return;
      }

      if (activeTool === "draw" && drawMode !== "freehand") {
        isDrawingRef.current = true;
        setIsDrawingActive(true);
        shapeOriginRef.current = pt;
        shapeCurrentRef.current = pt;
        renderObjectsLayer();
        return;
      }

      // Freehand Pen / Marker / Calligraphy / Halftone / Eraser
      isDrawingRef.current = true;
      setIsDrawingActive(true);
      const effectiveStyle = activeTool === "eraser" ? "eraser" : brushStyle;
      const smoother = new StrokeSmoother(brushSize, effectiveStyle);
      smootherRef.current = smoother;
      const startStamps = smoother.startStroke({
        x: pt.x,
        y: pt.y,
        time: e.timeStamp || Date.now(),
        pressure: e.pressure,
        pointerType: e.pointerType,
      });
      renderStampsToContext(
        inkCtx,
        startStamps,
        effectiveStyle,
        currentColor,
        activeTool === "eraser"
      );
    }
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pt = clientToCanvasPt(e.clientX, e.clientY);
    setHoverPoint(pt);

    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, pt);
    }

    // Pinch / two-finger gesture
    const gesture = gestureRef.current;
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

    // Single-pointer transform gesture
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

      if (
        handle === "nw" ||
        handle === "ne" ||
        handle === "se" ||
        handle === "sw"
      ) {
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

      // Interactive Crop Edge Handles for ImageLayer
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
          const dxCrop = clamp(
            fracDx * initImg.crop.w,
            -initImg.crop.x,
            initImg.crop.w - 0.15
          );
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
          const dyCrop = clamp(
            fracDy * initImg.crop.h,
            -initImg.crop.y,
            initImg.crop.h - 0.15
          );
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

    // Active Shape Preview
    if (isDrawingRef.current && shapeOriginRef.current && drawMode !== "freehand" && drawMode !== "fill") {
      shapeCurrentRef.current = pt;
      renderObjectsLayer();
      return;
    }

    // Active Freehand Drawing with Coalesced Events (eliminates gaps on fast motion!)
    if (!isDrawingRef.current || !smootherRef.current) return;
    const inkCanvas = inkCanvasRef.current;
    const inkCtx = inkCanvas?.getContext("2d", { willReadFrequently: true });
    if (!inkCanvas || !inkCtx) return;

    const native = e.nativeEvent;
    const coalesced =
      typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const eventsToProcess = coalesced.length > 0 ? coalesced : [native];

    const effectiveStyle = activeTool === "eraser" ? "eraser" : brushStyle;
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
      renderStampsToContext(
        inkCtx,
        allStamps,
        effectiveStyle,
        currentColor,
        activeTool === "eraser"
      );
    }
  };

  const handleStagePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId);
    setSnapGuides({ x: false, y: false });

    if (gestureRef.current) {
      const wasMoved = gestureRef.current.moved;
      gestureRef.current = null;
      if (wasMoved) {
        pushUndoSnapshot();
      }
      return;
    }

    if (!isDrawingRef.current) return;

    const inkCanvas = inkCanvasRef.current;
    const inkCtx = inkCanvas?.getContext("2d", { willReadFrequently: true });

    if (
      shapeOriginRef.current &&
      shapeCurrentRef.current &&
      activeTool === "draw" &&
      drawMode !== "freehand" &&
      drawMode !== "fill" &&
      inkCtx
    ) {
      drawShape(
        inkCtx,
        drawMode,
        shapeOriginRef.current,
        shapeCurrentRef.current,
        brushSize,
        currentColor
      );
      shapeOriginRef.current = null;
      shapeCurrentRef.current = null;
      renderObjectsLayer();
    } else if (smootherRef.current && inkCtx) {
      const endStamps = smootherRef.current.finishStroke();
      if (endStamps.length > 0) {
        renderStampsToContext(
          inkCtx,
          endStamps,
          activeTool === "eraser" ? "eraser" : brushStyle,
          currentColor,
          activeTool === "eraser"
        );
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

  // Color pot click handler (recolors selected text/stamp, or switches brush color & resumes draw)
  const handleSelectColorPot = (hex: string) => {
    setCurrentColor(hex);
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
    if (activeTool === "eraser") {
      setActiveTool("draw");
    }
  };

  // Image toolbar actions
  const handleUpdateImage = (
    id: string,
    patch: Partial<ImageLayer>,
    recordUndo = false
  ) => {
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

  const handleFillCanvasImage = (id: string) => {
    const next = images.map((img) => {
      if (img.id !== id) return img;
      const aspect =
        (img.naturalWidth * img.crop.w) / Math.max(1, img.naturalHeight * img.crop.h);
      const w = CANVAS_WIDTH / CANVAS_HEIGHT > aspect ? CANVAS_WIDTH : CANVAS_HEIGHT * aspect;
      const h = CANVAS_WIDTH / CANVAS_HEIGHT > aspect ? CANVAS_WIDTH / aspect : CANVAS_HEIGHT;
      return {
        ...img,
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT / 2,
        width: w,
        height: h,
        scale: 1,
        rotation: 0,
        frameStyle: "none" as const,
      };
    });
    setImages(next);
    pushUndoSnapshot({ images: next });
  };

  const handleReorderImage = (id: string, dir: "forward" | "backward") => {
    const idx = images.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const target = dir === "forward" ? idx + 1 : idx - 1;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
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

  // Text toolbar actions
  const handleAddNewText = (initialText?: string) => {
    const content = (initialText ?? draftText).trim() || "Love note!";
    const offset = (texts.length % 4) * 20;
    const layer: TextLayer = {
      id: makeId("txt"),
      text: content,
      x: CANVAS_WIDTH / 2 + offset,
      y: CANVAS_HEIGHT / 2 + offset,
      fontSize: 32,
      scale: 1,
      rotation: 0,
      color: currentColor,
      font: draftFont,
      backdrop: draftBackdrop,
    };
    const next = [...texts, layer];
    setTexts(next);
    setDraftText("");
    setSelectedItem({ kind: "text", id: layer.id });
    pushUndoSnapshot({ texts: next });
  };

  const handleChangeDraftText = (val: string) => {
    if (selectedText) {
      const next = texts.map((t) => (t.id === selectedText.id ? { ...t, text: val } : t));
      setTexts(next);
      // Avoid flooding undo stack on every keystroke; draft persists via autosave
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

  // Stamp placement
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
      color: currentColor,
    };
    const next = [...stamps, layer];
    setStamps(next);
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

  // Stationery change
  const handleChangeTemplate = (id: TemplateId) => {
    setTemplateId(id);
    pushUndoSnapshot({ templateId: id });
  };

  // Build composite ink PNG data URL for export
  const buildCompositeInkDataUrl = (): string => {
    const merged = document.createElement("canvas");
    merged.width = CANVAS_WIDTH;
    merged.height = CANVAS_HEIGHT;
    const ctx = merged.getContext("2d");
    if (!ctx) return "";

    if (crispUnderlayCanvasRef.current) ctx.drawImage(crispUnderlayCanvasRef.current, 0, 0);
    if (inkCanvasRef.current) ctx.drawImage(inkCanvasRef.current, 0, 0);
    if (objectsCanvasRef.current) ctx.drawImage(objectsCanvasRef.current, 0, 0);
    return merged.toDataURL("image/png");
  };

  // Send Note to Frame(s)
  const handleSendNote = async () => {
    setErrorBanner(null);
    setIsSending(true);
    try {
      const preSend = cloneSnapshot();
      const backgroundDataUrl =
        images.length > 0 && bgCanvasRef.current
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
        const err = await res.json().catch(() => ({ error: "Failed to beam note" }));
        setErrorBanner(err.error || "Failed to beam postcard. Check PIN or connection.");
        return;
      }

      const result = await res.json();
      await fetchState();

      if (preSend) {
        preSendSnapshotRef.current = preSend;
        setCanRestoreSent(true);
      }

      // Reset studio cleanly for next note
      const inkCanvas = inkCanvasRef.current;
      if (inkCanvas) {
        inkCanvas.getContext("2d", { willReadFrequently: true })?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }
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
        ink: new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT),
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
          ? "Press KEY on the frame for instant refresh, or wait for its ~15m wake cycle."
          : minWake === 0
          ? "Frame wake-up is due now (or press KEY on frame for instant refresh)."
          : `Next wake in ~${minWake}m (or press KEY on frame for instant refresh).`;

      setSendSuccessBanner(`Postcard queued for ${targetLabel}! ✨ ${wakeText}`);
    } catch (err) {
      console.error("Send note error:", err);
      setErrorBanner("Network error while beaming postcard to server.");
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

  // Re-send Note (targets currently selected recipient pill!)
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
        const err = await res.json().catch(() => ({ error: "Failed to re-send postcard" }));
        setErrorBanner(err.error || "Invalid PIN or failed to re-send postcard.");
        return;
      }

      await fetchState();
      setCanRestoreSent(false);
      setSendSuccessBanner(
        `Postcard queued again for ${formatRecipientFriendly(selectedRecipient)}! ✨ Press KEY on frame or wait for next wake cycle.`
      );
    } catch (err) {
      console.error("Resend error:", err);
      setErrorBanner("Failed to re-send postcard.");
    }
  };

  // Remix / Reply: loads note preview onto canvas at 1:1 with zero re-dither drift
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

      const inkCanvas = inkCanvasRef.current;
      if (inkCanvas) {
        inkCanvas.getContext("2d", { willReadFrequently: true })?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }

      setImages([remixLayer]);
      setTexts([]);
      setStamps([]);
      setTemplateId("blank");
      setSelectedItem(null);
      setIsCroppingImage(false);
      setActiveTool("draw");
      setDrawMode("freehand");

      pushUndoSnapshot({
        ink: new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT),
        images: [remixLayer],
        texts: [],
        stamps: [],
        templateId: "blank",
      });

      document.getElementById("drawing-studio")?.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      console.error("Remix error:", err);
      setErrorBanner("Could not load postcard into studio for remix.");
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

  // Copy URL helper
  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
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
      if (count === 2) return "Both Frames ✨";
      if (count > 2) return `All ${count} Frames ✨`;
      return state?.devices?.[0]?.display_name.replace(" Desk Frame", "") || "Frame";
    }
    const found = state?.devices.find((d) => d.device_id === recipient);
    return found ? found.display_name.replace(" Desk Frame", "") : recipient;
  };

  const devicesList = state?.devices || [];
  const allRecipientsLabel =
    devicesList.length === 2
      ? "✨ Both Frames"
      : `✨ All ${devicesList.length || 2} Frames`;

  const onlineDevicesCount = devicesList.filter((d) => {
    const ms = parseSqliteUtcMs(d.last_check_in);
    return ms !== null && Date.now() - ms < 3600 * 1000;
  }).length;

  // Compute SVG overlay selection geometry
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

  return (
    <div className="min-h-screen text-stone-900 pb-20">
      <a
        href="#drawing-studio"
        className="visually-hidden focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:bg-[#25467a] focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white focus:shadow-lg"
      >
        Skip to drawing canvas
      </a>

      {/* Compact, Cheerful Studio Header */}
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#faf6ef]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 -rotate-3 items-center justify-center rounded-2xl bg-[#25467a] text-white shadow-md transition-transform hover:rotate-3"
              aria-hidden="true"
            >
              <Sparkles className="h-5 w-5 text-amber-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-extrabold tracking-tight text-stone-900 sm:text-xl">
                  InkFrame Duo
                </h1>
                <span className="hidden rounded-full bg-amber-100/90 px-2.5 py-0.5 text-[11px] font-bold text-amber-900 border border-amber-300/60 sm:inline-block">
                  Postcard Studio
                </span>
              </div>
              <p className="text-xs font-medium text-stone-500">
                Doodle notes, photo collages &amp; desk games for your Spectra 6 frames
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => adminDialogRef.current?.showModal()}
              className="group inline-flex min-h-[38px] items-center gap-2 rounded-full border border-stone-300/90 bg-white px-3.5 py-1.5 text-xs font-bold text-stone-700 shadow-sm transition hover:border-stone-400 hover:bg-stone-50 active:scale-95"
              aria-haspopup="dialog"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  onlineDevicesCount > 0 ? "bg-emerald-500" : "bg-amber-400"
                }`}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">
                {devicesList.length || 2} {devicesList.length === 1 ? "Frame" : "Frames"}
              </span>
              <Sliders
                className="h-3.5 w-3.5 text-stone-500 transition-transform group-hover:rotate-12"
                aria-hidden="true"
              />
              <span>Frames &amp; Admin</span>
            </button>
          </div>
        </div>
      </header>

      {/* Polite Live Region for Notifications & Inline Errors */}
      <div aria-live="polite" className="mx-auto max-w-4xl px-4 sm:px-6">
        {errorBanner && (
          <div
            role="alert"
            className="mt-4 flex items-center justify-between rounded-2xl border-2 border-rose-600/25 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900 shadow-sm"
          >
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" aria-hidden="true" />
              {errorBanner}
            </span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="rounded-lg p-1 text-rose-700 hover:bg-rose-100"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {sendSuccessBanner && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-emerald-600/20 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900 shadow-sm">
            <span className="flex items-center gap-2">
              <Heart className="h-4 w-4 fill-rose-500 text-rose-500 shrink-0" aria-hidden="true" />
              {sendSuccessBanner}
            </span>
            <div className="flex items-center gap-2">
              {canRestoreSent && (
                <button
                  type="button"
                  onClick={handleRestoreLastSent}
                  className="rounded-xl border border-emerald-700/30 bg-white px-3 py-1 text-xs font-extrabold text-emerald-900 hover:bg-emerald-100"
                >
                  Restore to Canvas
                </button>
              )}
              <button
                type="button"
                onClick={() => setSendSuccessBanner(null)}
                className="rounded-lg p-1 text-emerald-700 hover:bg-emerald-100"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Content: Postcard Drawing Desk */}
      <main id="drawing-studio" tabIndex={-1} className="mx-auto max-w-4xl px-4 pt-5 sm:px-6">
        <section
          aria-label="Postcard Drawing Desk"
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
            if (dropped.length > 0) {
              addImageFiles(dropped);
            }
          }}
          className={`relative mb-10 rounded-[2rem] border-2 bg-white p-4 shadow-[0_12px_36px_-12px_rgba(28,25,23,0.1)] transition-colors sm:p-7 ${
            isDraggingFile ? "border-[#25467a] bg-blue-50/40" : "border-stone-200/90"
          }`}
        >
          {/* Decorative Washi Tape */}
          <div
            aria-hidden="true"
            className="washi-tape pointer-events-none absolute -top-3 left-1/2 h-6 w-32 -translate-x-1/2 -rotate-2 rounded-sm"
          />

          {/* Top Bar: Recipient Pills + Live E-Ink Toggle + Undo/Redo/Clear */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
            <div
              role="group"
              aria-label="Choose postcard recipient"
              className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-stone-100/90 p-1.5"
            >
              <span className="px-2 text-xs font-extrabold uppercase tracking-wider text-stone-500">
                To:
              </span>
              {devicesList.length !== 1 && (
                <button
                  type="button"
                  aria-pressed={selectedRecipient === "all"}
                  onClick={() => setSelectedRecipient("all")}
                  className={`min-h-[34px] rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all ${
                    selectedRecipient === "all"
                      ? "bg-[#25467a] text-white shadow-sm scale-[1.02]"
                      : "text-stone-700 hover:bg-white/80"
                  }`}
                >
                  {allRecipientsLabel}
                </button>
              )}
              {devicesList.map((d) => {
                const shortName = d.display_name.replace(" Desk Frame", "");
                const isSelected =
                  selectedRecipient === d.device_id ||
                  (devicesList.length === 1 && selectedRecipient === "all");
                const checkMs = parseSqliteUtcMs(d.last_check_in);
                const isOnline = checkMs !== null && Date.now() - checkMs < 3600 * 1000;
                return (
                  <button
                    key={d.device_id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedRecipient(d.device_id)}
                    className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all ${
                      isSelected
                        ? "bg-[#25467a] text-white shadow-sm scale-[1.02]"
                        : "text-stone-700 hover:bg-white/80"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isOnline ? "bg-emerald-400" : "bg-amber-400"
                      }`}
                      aria-hidden="true"
                    />
                    <span>🖼️ {shortName}</span>
                  </button>
                );
              })}
            </div>

            {/* Right Controls: Live E-Ink Preview Toggle + Undo/Redo/Clear */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-pressed={showEInkPreview}
                onClick={() => setShowEInkPreview((v) => !v)}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-2xl border px-3 py-1.5 text-xs font-bold transition ${
                  showEInkPreview
                    ? "border-[#25467a] bg-[#25467a] text-white shadow-sm"
                    : "border-stone-200 bg-stone-100/90 text-stone-700 hover:bg-white"
                }`}
              >
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                <span>E-Ink Preview</span>
              </button>

              <div className="flex items-center gap-1 rounded-2xl bg-stone-100/90 p-1">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  aria-label="Undo last action"
                  title="Undo (⌘Z)"
                  className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded-xl p-1.5 text-stone-700 transition hover:bg-white hover:shadow-sm active:scale-95 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Undo2 className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  aria-label="Redo action"
                  title="Redo (⌘⇧Z)"
                  className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded-xl p-1.5 text-stone-700 transition hover:bg-white hover:shadow-sm active:scale-95 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Redo2 className="h-4 w-4" aria-hidden="true" />
                </button>
                <div className="mx-0.5 h-4 w-px bg-stone-300/80" aria-hidden="true" />
                <button
                  type="button"
                  onClick={handleClearAll}
                  aria-label="Clear entire postcard"
                  className="inline-flex min-h-[34px] items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-white hover:shadow-sm active:scale-95"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Clear</span>
                </button>
              </div>
            </div>
          </div>

          {/* Primary Palette & Studio Tool Bar */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-stone-200/80 bg-[#faf6ef]/80 px-3 py-2">
            {/* All 6 Spectra Pigments + Separated Eraser */}
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Spectra 6 ink colors"
                className="flex flex-wrap items-center gap-1.5"
              >
                {SPECTRA_PALETTE.map((color) => {
                  const isSelected =
                    (selectedText?.color ?? selectedStamp?.color ?? currentColor) === color.hex &&
                    activeTool !== "eraser";
                  return (
                    <button
                      key={color.name}
                      type="button"
                      aria-label={color.name}
                      title={color.name}
                      aria-pressed={isSelected}
                      onClick={() => handleSelectColorPot(color.hex)}
                      className={`group relative flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150 ${
                        isSelected
                          ? "-translate-y-0.5 scale-110 shadow-md ring-2 ring-[#25467a] ring-offset-2"
                          : "hover:-translate-y-0.5 hover:scale-105 shadow-sm"
                      }`}
                      style={{
                        backgroundColor: color.hex,
                        border: color.isWhite
                          ? "2px solid #78716c"
                          : "2px solid rgba(255,255,255,0.85)",
                      }}
                    >
                      {isSelected && (
                        <span
                          className={`h-2 w-2 rounded-full ${
                            color.isWhite || color.name.includes("Yellow")
                              ? "bg-stone-900"
                              : "bg-white"
                          }`}
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mx-0.5 h-5 w-px bg-stone-300/70" aria-hidden="true" />

              {/* Tool Mode Switcher */}
              <div
                role="group"
                aria-label="Studio tools"
                className="flex flex-wrap items-center gap-0.5 rounded-xl bg-white p-1 border border-stone-200/80 shadow-sm"
              >
                {(
                  [
                    { id: "draw", label: "Draw", icon: PenTool },
                    { id: "eraser", label: "Eraser", icon: Eraser },
                    { id: "arrange", label: "Arrange", icon: Move },
                    { id: "text", label: "Text", icon: Type },
                    { id: "stamp", label: "Stamps", icon: StampIcon },
                    { id: "paper", label: "Paper", icon: FileText },
                  ] as Array<{
                    id: ToolMode;
                    label: string;
                    icon: React.ComponentType<{ className?: string }>;
                  }>
                ).map((t) => {
                  const Icon = t.icon;
                  const active = activeTool === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setActiveTool(t.id);
                        if (t.id === "draw" || t.id === "eraser" || t.id === "paper") {
                          setSelectedItem(null);
                          setIsCroppingImage(false);
                        }
                      }}
                      className={`inline-flex min-h-[30px] items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold transition ${
                        active
                          ? "bg-[#25467a] text-white shadow-sm"
                          : "text-stone-700 hover:bg-stone-100"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="hidden sm:inline">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Brush Size Selector (shown in Draw / Eraser) or Quick Add Photos */}
            <div className="flex items-center gap-1.5">
              {(activeTool === "draw" || activeTool === "eraser") && (
                <div
                  role="group"
                  aria-label="Brush thickness"
                  className="flex items-center gap-0.5 rounded-xl bg-white p-1 border border-stone-200/80 shadow-sm"
                >
                  {BRUSH_SIZES.map((b) => {
                    const isSelected = brushSize === b.size;
                    return (
                      <button
                        key={b.size}
                        type="button"
                        aria-label={`${b.label} nib (${b.size}px)`}
                        aria-pressed={isSelected}
                        onClick={() => setBrushSize(b.size)}
                        className={`flex min-h-[30px] items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold transition ${
                          isSelected
                            ? "bg-stone-900 text-white shadow-sm"
                            : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                        }`}
                      >
                        <span
                          className="inline-block rounded-full bg-current"
                          style={{ width: `${b.dot}px`, height: `${b.dot}px` }}
                          aria-hidden="true"
                        />
                        <span className="hidden lg:inline">{b.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-2.5 py-1 text-xs font-bold text-stone-800 shadow-sm transition hover:bg-stone-50 active:scale-95"
              >
                <ImagePlus className="h-3.5 w-3.5 text-[#25467a]" aria-hidden="true" />
                <span>+ Photos</span>
              </button>
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
            </div>
          </div>

          {/* Contextual Sub-Toolbar */}
          <StudioToolbars
            activeTool={activeTool}
            selectedItem={selectedItem}
            brushStyle={brushStyle}
            onChangeBrushStyle={setBrushStyle}
            drawMode={drawMode}
            onChangeDrawMode={setDrawMode}
            currentColor={currentColor}
            images={images}
            selectedImage={selectedImage}
            isCroppingImage={isCroppingImage}
            onToggleCropImage={() => setIsCroppingImage((v) => !v)}
            onAddPhotosClick={() => fileInputRef.current?.click()}
            onApplyCollageLayout={handleApplyCollageLayout}
            onUpdateImage={handleUpdateImage}
            onCommitImageChange={() => pushUndoSnapshot()}
            onApplyImageAspectCrop={handleApplyImageAspectCrop}
            onFillCanvasImage={handleFillCanvasImage}
            onReorderImage={handleReorderImage}
            onDuplicateImage={handleDuplicateImage}
            onDeleteSelected={handleDeleteSelected}
            ditherAlgo={ditherAlgo}
            onChangeDitherAlgo={setDitherAlgo}
            selectedText={selectedText}
            draftText={draftText}
            draftFont={draftFont}
            draftBackdrop={draftBackdrop}
            textInputRef={textInputRef}
            onChangeDraftText={handleChangeDraftText}
            onChangeDraftFont={handleChangeDraftFont}
            onChangeDraftBackdrop={handleChangeDraftBackdrop}
            onAddNewText={handleAddNewText}
            selectedStamp={selectedStamp}
            onPlaceStamp={handlePlaceStamp}
            onRotateSelectedStamp={handleRotateSelectedStamp}
            templateId={templateId}
            onChangeTemplate={handleChangeTemplate}
          />

          {/* Physical Desk Frame Bezel & Multi-Layer 800x480 Canvas Stage */}
          <div className="relative mx-auto w-full max-w-[800px] rounded-[1.5rem] bg-stone-800 p-2.5 shadow-[0_14px_30px_-8px_rgba(28,25,23,0.35),inset_0_2px_4px_rgba(255,255,255,0.15)] sm:p-4">
            <div
              ref={stageRef}
              role="application"
              aria-label="800 by 480 pixel interactive postcard studio canvas"
              onPointerDown={handleStagePointerDown}
              onPointerMove={handleStagePointerMove}
              onPointerUp={handleStagePointerUp}
              onPointerCancel={handleStagePointerUp}
              onPointerLeave={() => setHoverPoint(null)}
              onDoubleClick={handleStageDoubleClick}
              className={`relative overflow-hidden rounded-xl bg-[#e8e4d9] aspect-[5/3] select-none shadow-inner touch-none ${
                activeTool === "draw" || activeTool === "eraser"
                  ? "cursor-crosshair"
                  : "cursor-default"
              }`}
            >
              {/* Layer 0: Background Paper + Multi-Image Photo Layer */}
              <canvas
                ref={bgCanvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />

              {/* Layer 1: Stationery Templates & Crisp Photo Mats */}
              <canvas
                ref={crispUnderlayCanvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />

              {/* Layer 2: Freehand Ink, Shapes, Flood Fills & Eraser */}
              <canvas
                ref={inkCanvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />

              {/* Layer 3: Draggable Stamps, Text Labels & Drag-Shape Preview */}
              <canvas
                ref={objectsCanvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />

              {/* Layer 4: Live Quantized Spectra 6 E-Ink Preview */}
              <canvas
                ref={eInkPreviewCanvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-100 ${
                  showEInkPreview && !isDrawingActive ? "opacity-100" : "opacity-0"
                }`}
              />

              {/* Layer 5: SVG Snap Guides, Transform Handles & Brush Ring Cursor */}
              <svg
                viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                className="pointer-events-none absolute inset-0 h-full w-full"
              >
                {/* Magnetic Center Snap Guides */}
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

                {/* Selection Box, Scale Corner Handles & Rotation Handle */}
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
                      // 4 Edge Crop Handles
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
                        {/* Lollipop Rotation Stem & Knob */}
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

                        {/* 4 Corner Scale Handles */}
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

                {/* Exact-Sized Brush / Eraser Nib Preview Cursor */}
                {hoverPoint &&
                  (activeTool === "draw" || activeTool === "eraser") &&
                  drawMode !== "fill" && (
                    <circle
                      cx={hoverPoint.x}
                      cy={hoverPoint.y}
                      r={Math.max(2, brushSize / 2)}
                      fill="none"
                      stroke={activeTool === "eraser" ? "#9e2a1f" : currentColor}
                      strokeWidth={1.5}
                      strokeDasharray={activeTool === "eraser" ? "3 2" : undefined}
                      opacity={0.85}
                    />
                  )}
              </svg>

              {/* Drag-and-Drop Overlay */}
              {isDraggingFile && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#25467a]/20 backdrop-blur-[1px]">
                  <div className="rounded-2xl border-2 border-dashed border-white bg-[#25467a]/90 px-6 py-3 text-sm font-extrabold text-white shadow-lg">
                    Drop photo(s) onto your postcard!
                  </div>
                </div>
              )}
            </div>

            {/* Subtle Frame Bezel Label */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-2 text-[11px] font-medium text-stone-400">
              <span>
                Spectra 6 Paper Canvas (800×480)
                {images.length > 0 ? ` • ${images.length} photo${images.length > 1 ? "s" : ""}` : ""}
                {showEInkPreview ? " • Live 6-Color E-Ink Preview" : ""}
              </span>
              <span>
                {activeTool === "eraser"
                  ? "Eraser active (ink only)"
                  : selectedItem
                  ? "Drag to move • Corners to scale • Top knob to rotate (Hold Shift for 15° snap)"
                  : "Draw smoothly, drag/paste photos, or add stamps & templates"}
              </span>
            </div>
          </div>

          {/* Bottom Action Bar: Scrapbook Archive Title + PIN + Beam CTA */}
          <div className="mt-6 flex flex-col gap-4 border-t border-stone-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center">
                <label htmlFor="postcard-caption" className="visually-hidden">
                  Archive title for Scrapbook (web only, optional)
                </label>
                <input
                  id="postcard-caption"
                  type="text"
                  placeholder="Archive title for Scrapbook (web only, optional)..."
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  className="min-h-[42px] w-72 max-w-full rounded-2xl border border-stone-200 bg-stone-50/60 px-3.5 py-2 text-xs font-medium text-stone-800 placeholder:text-stone-400 focus:bg-white"
                />
              </div>

              {state?.config.webPinRequired && (
                <div>
                  <label htmlFor="studio-pin" className="visually-hidden">
                    Studio Access PIN
                  </label>
                  <input
                    id="studio-pin"
                    type="password"
                    placeholder="PIN"
                    autoComplete="current-password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="min-h-[42px] w-24 rounded-2xl border border-stone-300 bg-white px-3 py-2 text-xs font-mono"
                  />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleSendNote}
              disabled={isSending}
              className="inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-2xl bg-[#9e2a1f] px-7 py-3 text-sm font-extrabold text-white shadow-[0_6px_20px_-4px_rgba(158,42,31,0.5)] transition-all hover:-translate-y-0.5 hover:bg-[#832118] active:translate-y-0 active:scale-95 disabled:opacity-50"
            >
              <Send className={`h-4 w-4 ${isSending ? "animate-bounce" : ""}`} aria-hidden="true" />
              <span>{isSending ? "Beaming to Frame..." : "Beam to Frame!"}</span>
            </button>
          </div>
        </section>

        {/* Secondary Disclosure: Scrapbook Flipbook Archive */}
        <section aria-labelledby="scrapbook-heading" className="mt-8">
          <details
            className="group rounded-3xl border border-stone-200/90 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-6"
            open
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-800"
                  aria-hidden="true"
                >
                  <BookOpen className="h-4 w-4" />
                </div>
                <div>
                  <h2 id="scrapbook-heading" className="text-base font-extrabold text-stone-900">
                    Postcard Scrapbook ({state?.notes.length || 0})
                  </h2>
                  <p className="text-xs text-stone-500">
                    Past doodles &amp; memories • Remix onto canvas to reply, or beam straight to{" "}
                    {formatRecipientFriendly(selectedRecipient)}
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-600 group-hover:bg-stone-200/70">
                <span>Toggle</span>
                <ChevronDown
                  className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180"
                  aria-hidden="true"
                />
              </span>
            </summary>

            <div className="mt-6">
              {state?.notes && state.notes.length > 0 ? (
                <ul role="list" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {state.notes.map((note, idx) => {
                    const showTheoretical = showHardwareLut[note.id] ?? false;
                    const noteDate = new Date(note.created_at);
                    const tiltClass =
                      idx % 3 === 0
                        ? "hover:-rotate-1"
                        : idx % 3 === 1
                        ? "hover:rotate-1"
                        : "hover:-rotate-0.5";

                    return (
                      <li
                        key={note.id}
                        className={`group/card flex flex-col justify-between rounded-2xl border border-stone-200/90 bg-[#fdfcf9] p-3.5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md ${tiltClass}`}
                      >
                        <div>
                          <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-100 aspect-[5/3] relative">
                            <img
                              src={`/api/notes/${note.id}/${showTheoretical ? "device" : "preview"}.png`}
                              alt={
                                note.caption
                                  ? `Postcard: ${note.caption}`
                                  : `Postcard sent to ${note.recipient}`
                              }
                              width={800}
                              height={480}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          </div>

                          {note.caption && (
                            <p className="mt-2.5 text-xs font-bold text-stone-800 line-clamp-1">
                              “{note.caption}”
                            </p>
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-2.5">
                          <div>
                            <span className="inline-block rounded-lg bg-stone-100 px-2 py-0.5 text-[11px] font-bold text-stone-700">
                              To: {formatRecipientFriendly(note.recipient)}
                            </span>
                            <p className="mt-0.5 text-[11px] text-stone-400">
                              {noteDate.toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}{" "}
                              at{" "}
                              {noteDate.toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleRemixNote(note.id)}
                              title="Load onto canvas to reply or play next turn"
                              aria-label={`Remix or reply to postcard from ${noteDate.toLocaleDateString()}`}
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-xl border border-stone-200 bg-white px-2.5 py-1 text-xs font-bold text-[#25467a] shadow-sm transition hover:border-[#25467a] hover:bg-blue-50/50 active:scale-95"
                            >
                              <Reply className="h-3 w-3" aria-hidden="true" />
                              <span>Remix</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResend(note.id)}
                              title={`Beam again to ${formatRecipientFriendly(selectedRecipient)}`}
                              aria-label={`Beam postcard again to ${formatRecipientFriendly(selectedRecipient)}`}
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-xl border border-stone-200 bg-white px-2.5 py-1 text-xs font-bold text-stone-700 shadow-sm transition hover:border-[#25467a] hover:text-[#25467a] active:scale-95"
                            >
                              <RotateCcw className="h-3 w-3" aria-hidden="true" />
                              <span>Beam</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => confirmDeleteNote(note.id)}
                              aria-label={`Delete postcard from ${noteDate.toLocaleDateString()}`}
                              className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-xl p-1.5 text-stone-400 transition hover:bg-rose-50 hover:text-rose-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="rounded-2xl border-2 border-dashed border-stone-200 bg-stone-50/50 p-10 text-center">
                  <Sparkles className="mx-auto mb-2 h-6 w-6 text-amber-500" aria-hidden="true" />
                  <p className="text-sm font-bold text-stone-700">
                    Your scrapbook is waiting for its first doodle!
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    Pick a color above and sketch a note to light up a desk frame.
                  </p>
                </div>
              )}
            </div>
          </details>
        </section>
      </main>

      {/* =====================================================================
          FRAMES & STUDIO ADMIN DIALOG
         ===================================================================== */}
      <dialog
        ref={adminDialogRef}
        id="admin-settings-dialog"
        {...({ closedby: "any" } as any)}
        aria-labelledby="admin-dialog-title"
        className="m-auto w-full max-w-3xl rounded-3xl border border-stone-200 bg-[#faf6ef] p-0 text-stone-900 shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200/80 bg-white/90 px-6 py-4 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone-900 text-white"
              aria-hidden="true"
            >
              <Sliders className="h-4 w-4" />
            </div>
            <div>
              <h2 id="admin-dialog-title" className="text-base font-extrabold text-stone-900">
                Frames &amp; Studio Admin
              </h2>
              <p className="text-xs text-stone-500">
                Hardware telemetry, polling endpoints, dithering algorithms &amp; diagnostics
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchState}
              disabled={isLoading}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-bold text-stone-700 shadow-sm hover:bg-stone-50"
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
              aria-label="Close Frames and Studio Admin"
              className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-xl border border-stone-200 bg-white p-1.5 text-stone-600 hover:bg-stone-100"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="max-h-[78vh] overflow-y-auto p-6 space-y-6">
          <section aria-labelledby="admin-devices-heading">
            <div className="mb-3 flex items-center justify-between">
              <h3
                id="admin-devices-heading"
                className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-stone-600"
              >
                <Wifi className="h-4 w-4 text-[#25467a]" aria-hidden="true" />
                Connected E-Paper Displays ({devicesList.length})
              </h3>
              <span className="text-xs text-stone-500">Spectra 6 • 800×480 • 15m wake cycle</span>
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
                    className="flex flex-col justify-between rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
                  >
                    <div>
                      <div className="flex items-start justify-between border-b border-stone-100 pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-stone-900">{device.display_name}</h4>
                            <code className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-mono text-stone-600">
                              {device.device_id}
                            </code>
                          </div>
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-500">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${
                                hasRecentCheckIn ? "bg-emerald-500" : "bg-amber-400"
                              }`}
                              aria-hidden="true"
                            />
                            Last check-in: {formatTimeAgo(device.last_check_in)}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 rounded-full border border-stone-200/80 bg-stone-50 px-2.5 py-1">
                          <Battery
                            className={`h-3.5 w-3.5 ${
                              (device.battery_pct ?? 100) > 40 ? "text-emerald-600" : "text-amber-500"
                            }`}
                            aria-hidden="true"
                          />
                          <span className="text-xs font-bold text-stone-700">
                            {device.battery_pct !== null && device.battery_pct !== undefined
                              ? `${device.battery_pct}%`
                              : "USB"}
                          </span>
                          {device.battery_mv && (
                            <span className="text-[10px] text-stone-400">
                              ({device.battery_mv}mV)
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 overflow-hidden rounded-xl border border-stone-200 bg-stone-100 aspect-[5/3] relative">
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
                        <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-0.5 font-mono text-[10px] text-white">
                          ETag: {device.active_etag || "welcome"}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between text-xs text-stone-600">
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
                          <span className="flex items-center gap-1 text-[11px] text-stone-400">
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            Sleep: {Math.round(device.sleep_duration_s / 60)}m
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 border-t border-stone-100 pt-3">
                      <p className="mb-1.5 text-[11px] font-semibold text-stone-500">
                        ESP32 Firmware Auto-Rotate URL:
                      </p>
                      <div className="flex items-center gap-1.5">
                        <code className="flex-1 overflow-hidden rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-[11px] font-mono text-stone-600 truncate select-all">
                          {fullPollUrl}
                        </code>
                        <button
                          type="button"
                          onClick={() => handleCopyUrl(fullPollUrl)}
                          aria-label={`Copy firmware URL for ${device.display_name}`}
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                        >
                          {copiedUrl === fullPollUrl ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 text-stone-500" aria-hidden="true" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSimulatePoll(device.device_id, device.active_etag)}
                          disabled={isSimulating}
                          aria-label={`Simulate hardware check-in for ${device.display_name}`}
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-stone-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-stone-900 disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${isSimulating ? "animate-spin" : ""}`}
                            aria-hidden="true"
                          />
                          <span>Simulate</span>
                        </button>
                      </div>

                      {simulationResult && simulationResult.deviceId === device.device_id && (
                        <div className="mt-2 rounded-lg bg-stone-100 p-2 text-xs font-mono text-stone-700">
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
            className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
          >
            <h3
              id="admin-pipeline-heading"
              className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-stone-600"
            >
              <Wand2 className="h-4 w-4 text-[#25467a]" aria-hidden="true" />
              Spectra 6 Rendering &amp; Security Settings
            </h3>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-bold text-stone-800">Photo Dithering Algorithm</p>
                <p className="mb-2 text-[11px] text-stone-500">
                  Controls how uploaded photo collages map to the 6 e-paper pigments (hand-drawn strokes, text, and stamps stay un-dithered).
                </p>
                <div
                  role="group"
                  aria-label="Photo dithering algorithm"
                  className="inline-flex rounded-xl bg-stone-100 p-1"
                >
                  {(["floyd", "atkinson", "bayer", "nearest"] as DitherAlgo[]).map((algo) => (
                    <button
                      key={algo}
                      type="button"
                      aria-pressed={ditherAlgo === algo}
                      onClick={() => setDitherAlgo(algo)}
                      className={`min-h-[32px] rounded-lg px-2.5 py-1 text-xs font-bold capitalize transition ${
                        ditherAlgo === algo
                          ? "bg-white text-stone-900 shadow-sm"
                          : "text-stone-600 hover:text-stone-900"
                      }`}
                    >
                      {algo}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-stone-800">Hardware LUT Inspection</p>
                <p className="mb-2 text-[11px] text-stone-500">
                  Toggle Scrapbook previews between natural perceived e-paper colors and raw hardware RGB LUT values.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const anyOn = Object.values(showHardwareLut).some(Boolean);
                    const next: Record<string, boolean> = {};
                    state?.notes.forEach((n) => {
                      next[n.id] = !anyOn;
                    });
                    setShowHardwareLut(next);
                  }}
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-100"
                >
                  <span>
                    {Object.values(showHardwareLut).some(Boolean)
                      ? "Showing Raw Hardware LUT (Switch to Perceived)"
                      : "Showing Perceived Colors (Switch to Raw LUT)"}
                  </span>
                </button>
              </div>
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
        className="m-auto w-full max-w-sm rounded-3xl border border-stone-200 bg-white p-6 text-stone-900 shadow-xl"
      >
        <h2 id="delete-dialog-title" className="text-base font-extrabold text-stone-900">
          Toss this postcard?
        </h2>
        <p className="mt-1.5 text-xs text-stone-600">
          This removes the doodle from your shared Postcard Scrapbook.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => closeTopLayer(deleteDialogRef.current)}
            className="min-h-[38px] rounded-xl border border-stone-200 bg-white px-4 py-2 text-xs font-bold text-stone-700 hover:bg-stone-50"
          >
            Keep It
          </button>
          <button
            type="button"
            onClick={executeDeleteNote}
            className="min-h-[38px] rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-700"
          >
            Delete Postcard
          </button>
        </div>
      </dialog>
    </div>
  );
}
