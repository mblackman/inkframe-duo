import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Send,
  RotateCcw,
  Undo2,
  Redo2,
  Trash2,
  Image as ImageIcon,
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
  Lock,
  Wand2,
} from "lucide-react";
import type { SystemState, DitherAlgo, ColorOption } from "./types";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 480;

const SPECTRA_PALETTE: ColorOption[] = [
  { name: "Ink Black", hex: "#1e1e1e" },
  { name: "Crimson Red", hex: "#9e2a1f" },
  { name: "Cobalt Blue", hex: "#25467a" },
  { name: "Forest Green", hex: "#2d6a3e" },
  { name: "Sunbeam Yellow", hex: "#d9b82c" },
  { name: "Eraser", hex: "#e8e4d9", isEraser: true },
];

const BRUSH_SIZES = [
  { label: "Fine", size: 3, dot: 5 },
  { label: "Medium", size: 6, dot: 8 },
  { label: "Bold", size: 12, dot: 12 },
  { label: "Chubby", size: 24, dot: 16 },
];

// Feature detection for top-layer exit transitions (modern-web-guidance: animate-to-from-top-layer)
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
  return typeof window !== "undefined" && Boolean(window.CSS?.supports?.("overlay", "auto")) && canTransitionDisplay();
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
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [simulatingDevice, setSimulatingDevice] = useState<string | null>(null);
  const [simulationResult, setSimulationResult] = useState<{ deviceId: string; text: string } | null>(null);

  // Composer State
  const [selectedRecipient, setSelectedRecipient] = useState<string>("all");
  const [currentColor, setCurrentColor] = useState<string>("#1e1e1e");
  const [brushSize, setBrushSize] = useState<number>(6);
  const [ditherAlgo, setDitherAlgo] = useState<DitherAlgo>("floyd");
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [caption, setCaption] = useState<string>("");
  const [pin, setPin] = useState<string>("");
  const [showHardwareLut, setShowHardwareLut] = useState<Record<string, boolean>>({});
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);

  // Dialog & Canvas Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const adminDialogRef = useRef<HTMLDialogElement | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);
  const isDrawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number; time: number } | null>(null);
  const undoStack = useRef<ImageData[]>([]);
  const redoStack = useRef<ImageData[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

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

  // Setup light-dismiss fallback & cancel animation routing for native dialogs
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

      // Fallback for browsers without native <dialog closedby="any">
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

  // Initialize Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    saveCanvasState();
  }, []);

  const saveCanvasState = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const data = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    undoStack.current.push(data);
    if (undoStack.current.length > 25) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(undoStack.current.length > 1);
    setCanRedo(false);
  };

  const handleUndo = useCallback(() => {
    if (undoStack.current.length <= 1) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const current = undoStack.current.pop()!;
    redoStack.current.push(current);
    const previous = undoStack.current[undoStack.current.length - 1];
    ctx.putImageData(previous, 0, 0);

    setCanUndo(undoStack.current.length > 1);
    setCanRedo(true);
  }, []);

  const handleRedo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const next = redoStack.current.pop()!;
    undoStack.current.push(next);
    ctx.putImageData(next, 0, 0);

    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  }, []);

  // Keyboard shortcuts for Undo / Redo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (
          document.activeElement?.tagName === "INPUT" ||
          document.activeElement?.tagName === "TEXTAREA"
        ) {
          return;
        }
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo, handleRedo]);

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    saveCanvasState();
  };

  // Canvas drawing coordinate calculations
  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, time: Date.now() };
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      time: Date.now(),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    isDrawing.current = true;
    const coords = getCanvasCoords(e);
    lastPoint.current = coords;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const isEraser = currentColor === "#e8e4d9";
    ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
    ctx.fillStyle = currentColor;
    ctx.beginPath();
    ctx.arc(coords.x, coords.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || !lastPoint.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const current = getCanvasCoords(e);
    const prev = lastPoint.current;

    // Velocity-based stroke smoothing
    const dx = current.x - prev.x;
    const dy = current.y - prev.y;
    const dt = Math.max(1, current.time - prev.time);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = dist / dt;

    // Subtle natural stroke width dynamics
    const widthFactor = Math.max(0.6, Math.min(1.4, 1.2 - speed * 0.15));
    const effectiveWidth = brushSize * widthFactor;

    const isEraser = currentColor === "#e8e4d9";
    ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = effectiveWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const midX = (prev.x + current.x) / 2;
    const midY = (prev.y + current.y) / 2;

    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
    ctx.stroke();

    lastPoint.current = current;
  };

  const handlePointerUp = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    lastPoint.current = null;
    saveCanvasState();
  };

  // Background Image Upload
  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setBgImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Send Note to Frame(s)
  const handleSendNote = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsSending(true);
    try {
      const inkDataUrl = canvas.toDataURL("image/png");

      const payload = {
        recipient: selectedRecipient,
        inkDataUrl,
        backgroundDataUrl: bgImage,
        ditherAlgorithm: ditherAlgo,
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
        const err = await res.json();
        alert(err.error || "Failed to send note");
        return;
      }

      await fetchState();
      handleClear();
      setCaption("");
      const targetLabel =
        selectedRecipient === "all"
          ? "both desk frames"
          : state?.devices.find((d) => d.device_id === selectedRecipient)?.display_name || "the frame";
      setSendSuccessBanner(`Postcard beamed to ${targetLabel}! ✨`);
      setTimeout(() => setSendSuccessBanner(null), 5000);
    } catch (err) {
      console.error("Send note error:", err);
      alert("Failed to send note to frame.");
    } finally {
      setIsSending(false);
    }
  };

  // Re-send Note
  const handleResend = async (noteId: string, recipient: string) => {
    try {
      const res = await fetch(`/api/notes/${noteId}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient }),
      });
      if (res.ok) {
        await fetchState();
        setSendSuccessBanner("Postcard queued on frame again! ✨");
        setTimeout(() => setSendSuccessBanner(null), 4000);
      }
    } catch (err) {
      console.error("Resend error:", err);
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
    try {
      const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchState();
      }
    } catch (err) {
      console.error("Delete error:", err);
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

  // Format Relative Time
  const formatTimeAgo = (iso?: string | null) => {
    if (!iso) return "Waiting for first wake-up";
    const date = new Date(iso);
    const sec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (sec < 60) return "Just now";
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return date.toLocaleDateString();
  };

  const formatRecipientFriendly = (recipient: string) => {
    if (recipient === "all") return "Every Frame ✨";
    const found = state?.devices.find((d) => d.device_id === recipient);
    return found ? found.display_name.replace(" Desk Frame", "") : recipient;
  };

  const onlineDevicesCount = state?.devices?.filter(
    (d) => d.last_check_in && Date.now() - new Date(d.last_check_in).getTime() < 3600 * 1000
  ).length ?? 0;

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
                Doodle a little love note for the desk frames
              </p>
            </div>
          </div>

          {/* Right Actions: Frame Status Pill + Hidden Admin Menu Trigger */}
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
                {state?.devices?.length || 2} Frames
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

      {/* Polite Live Region for Non-Blocking Postcard Sent Announcements */}
      <div aria-live="polite" className="mx-auto max-w-4xl px-4 sm:px-6">
        {sendSuccessBanner && (
          <div className="mt-4 flex items-center justify-between rounded-2xl border-2 border-emerald-600/20 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900 shadow-sm">
            <span className="flex items-center gap-2">
              <Heart className="h-4 w-4 fill-rose-500 text-rose-500" aria-hidden="true" />
              {sendSuccessBanner}
            </span>
            <button
              type="button"
              onClick={() => setSendSuccessBanner(null)}
              className="rounded-lg p-1 text-emerald-700 hover:bg-emerald-100"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Main Content: Jump Straight into Drawing! */}
      <main id="drawing-studio" tabIndex={-1} className="mx-auto max-w-4xl px-4 pt-5 sm:px-6">
        {/* Hero Drawing Desk Card */}
        <section
          aria-label="Postcard Drawing Desk"
          className="relative mb-10 rounded-[2rem] border-2 border-stone-200/90 bg-white p-4 shadow-[0_12px_36px_-12px_rgba(28,25,23,0.1)] sm:p-7"
        >
          {/* Decorative Washi Tape at Top Center */}
          <div
            aria-hidden="true"
            className="washi-tape pointer-events-none absolute -top-3 left-1/2 h-6 w-32 -translate-x-1/2 -rotate-2 rounded-sm"
          />

          {/* Top Bar: Who gets this postcard? + Undo/Redo/Clear */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div
              role="group"
              aria-label="Choose postcard recipient"
              className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-stone-100/90 p-1.5"
            >
              <span className="px-2 text-xs font-extrabold uppercase tracking-wider text-stone-500">
                To:
              </span>
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
                ✨ Both Frames
              </button>
              {state?.devices.map((d) => {
                const shortName = d.display_name.replace(" Desk Frame", "");
                const isSelected = selectedRecipient === d.device_id;
                return (
                  <button
                    key={d.device_id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedRecipient(d.device_id)}
                    className={`min-h-[34px] rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all ${
                      isSelected
                        ? "bg-[#25467a] text-white shadow-sm scale-[1.02]"
                        : "text-stone-700 hover:bg-white/80"
                    }`}
                  >
                    🖼️ {shortName}
                  </button>
                );
              })}
            </div>

            {/* Quick Undo / Redo / Start Fresh */}
            <div className="flex items-center gap-1 rounded-2xl bg-stone-100/90 p-1.5">
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndo}
                aria-label="Undo last stroke"
                className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded-xl p-1.5 text-stone-700 transition hover:bg-white hover:shadow-sm active:scale-95 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Undo2 className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={!canRedo}
                aria-label="Redo stroke"
                className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded-xl p-1.5 text-stone-700 transition hover:bg-white hover:shadow-sm active:scale-95 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Redo2 className="h-4 w-4" aria-hidden="true" />
              </button>
              <div className="mx-0.5 h-4 w-px bg-stone-300/80" aria-hidden="true" />
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear canvas"
                className="inline-flex min-h-[34px] items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-white hover:shadow-sm active:scale-95"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            </div>
          </div>

          {/* Tactile Color Pot Swatches & Brush Nib Selector */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-stone-200/80 bg-[#faf6ef]/70 px-4 py-3">
            {/* 6 E-Ink Spectra Paint Pots */}
            <div
              role="group"
              aria-label="Spectra 6 ink colors"
              className="flex flex-wrap items-center gap-2.5"
            >
              {SPECTRA_PALETTE.map((color) => {
                const isSelected = currentColor === color.hex;
                return (
                  <button
                    key={color.name}
                    type="button"
                    aria-label={color.name}
                    aria-pressed={isSelected}
                    onClick={() => setCurrentColor(color.hex)}
                    className={`group relative flex h-10 w-10 items-center justify-center rounded-full transition-all duration-150 ${
                      isSelected
                        ? "-translate-y-1 scale-110 shadow-md ring-2 ring-[#25467a] ring-offset-2"
                        : "hover:-translate-y-0.5 hover:scale-105 shadow-sm"
                    }`}
                    style={{
                      backgroundColor: color.hex,
                      border: color.isEraser ? "2px dashed #a8a29e" : "2px solid rgba(255,255,255,0.8)",
                    }}
                  >
                    {color.isEraser ? (
                      <Eraser
                        className={`h-4 w-4 ${
                          isSelected ? "text-stone-900" : "text-stone-600"
                        }`}
                        aria-hidden="true"
                      />
                    ) : (
                      isSelected && (
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            color.name.includes("Yellow") ? "bg-stone-900" : "bg-white"
                          }`}
                          aria-hidden="true"
                        />
                      )
                    )}
                  </button>
                );
              })}
            </div>

            {/* Visual Nib Size Dots */}
            <div
              role="group"
              aria-label="Brush thickness"
              className="flex items-center gap-1.5 rounded-xl bg-white p-1 border border-stone-200/80 shadow-sm"
            >
              {BRUSH_SIZES.map((b) => {
                const isSelected = brushSize === b.size;
                return (
                  <button
                    key={b.size}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setBrushSize(b.size)}
                    className={`flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
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
                    <span>{b.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Physical Desk Frame Bezel & 800x480 Paper Canvas */}
          <div className="relative mx-auto w-full max-w-[800px] rounded-[1.5rem] bg-stone-800 p-2.5 shadow-[0_14px_30px_-8px_rgba(28,25,23,0.35),inset_0_2px_4px_rgba(255,255,255,0.15)] sm:p-4">
            <div className="relative overflow-hidden rounded-xl bg-[#e8e4d9] aspect-[5/3] select-none cursor-crosshair shadow-inner">
              {/* Background photo preview if uploaded */}
              {bgImage && (
                <img
                  src={bgImage}
                  alt="Uploaded background layer"
                  width={800}
                  height={480}
                  className="absolute inset-0 h-full w-full object-cover pointer-events-none opacity-90"
                />
              )}

              {/* Drawing Canvas */}
              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                aria-label="800 by 480 pixel postcard drawing canvas"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className="absolute inset-0 h-full w-full"
              />
            </div>

            {/* Subtle Frame Bezel Label */}
            <div className="mt-2 flex items-center justify-between px-2 text-[11px] font-medium text-stone-400">
              <span>Spectra 6 Paper Canvas (800×480)</span>
              <span>{currentColor === "#e8e4d9" ? "Eraser active" : "Draw with finger, mouse, or stylus"}</span>
            </div>
          </div>

          {/* Bottom Action Bar: Add Photo Backdrop, Caption/Note, and Joyful Send CTA */}
          <div className="mt-6 flex flex-col gap-4 border-t border-stone-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
            {/* Left: Photo Backdrop & OptionalCaption */}
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-2xl border border-stone-300 bg-stone-50/80 px-4 py-2 text-xs font-bold text-stone-700 shadow-sm transition hover:bg-stone-100 active:scale-95">
                <ImageIcon className="h-4 w-4 text-[#25467a]" aria-hidden="true" />
                <span>{bgImage ? "Swap Photo Backdrop" : "Add Photo Backdrop"}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleBgUpload}
                  className="visually-hidden"
                />
              </label>

              {bgImage && (
                <button
                  type="button"
                  onClick={() => setBgImage(null)}
                  className="min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50"
                >
                  Remove Photo
                </button>
              )}

              <div className="flex items-center">
                <label htmlFor="postcard-caption" className="visually-hidden">
                  Postcard title or memo (optional)
                </label>
                <input
                  id="postcard-caption"
                  type="text"
                  placeholder="Add a title or memo (optional)..."
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  className="min-h-[42px] w-56 rounded-2xl border border-stone-200 bg-stone-50/60 px-3.5 py-2 text-xs font-medium text-stone-800 placeholder:text-stone-400 focus:bg-white"
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

            {/* Right: Big Whimsical Send Postcard Button */}
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

        {/* Secondary Disclosure: Scrapbook Flipbook Archive (Clean & Delightful) */}
        <section aria-labelledby="scrapbook-heading" className="mt-8">
          <details className="group rounded-3xl border border-stone-200/90 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-6" open>
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
                    Past doodles &amp; memories • One tap to beam any card back to a frame
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
                          <div className=" overflow-hidden rounded-xl border border-stone-200 bg-stone-100 aspect-[5/3] relative">
                            <img
                              src={`/api/notes/${note.id}/${showTheoretical ? "device" : "preview"}.png`}
                              alt={note.caption ? `Postcard: ${note.caption}` : `Postcard sent to ${note.recipient}`}
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

                        <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-2.5">
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
                              onClick={() => handleResend(note.id, note.recipient)}
                              aria-label={`Re-send postcard from ${noteDate.toLocaleDateString()} to ${note.recipient}`}
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-xl border border-stone-200 bg-white px-2.5 py-1 text-xs font-bold text-stone-700 shadow-sm transition hover:border-[#25467a] hover:text-[#25467a] active:scale-95"
                            >
                              <RotateCcw className="h-3 w-3" aria-hidden="true" />
                              <span>Beam Again</span>
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
                  <p className="text-sm font-bold text-stone-700">Your scrapbook is waiting for its first doodle!</p>
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
          HIDDEN ADMIN & HARDWARE DIALOG (Opened on-demand from Top Menu)
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
          {/* 1. Connected E-Paper Displays */}
          <section aria-labelledby="admin-devices-heading">
            <div className="mb-3 flex items-center justify-between">
              <h3
                id="admin-devices-heading"
                className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-stone-600"
              >
                <Wifi className="h-4 w-4 text-[#25467a]" aria-hidden="true" />
                Connected E-Paper Displays ({state?.devices?.length || 0})
              </h3>
              <span className="text-xs text-stone-500">Spectra 6 • 800×480 • 15m wake cycle</span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {state?.devices.map((device) => {
                const fullPollUrl = `${window.location.origin}/api/frame/${device.device_id}`;
                const isSimulating = simulatingDevice === device.device_id;
                const hasRecentCheckIn =
                  device.last_check_in &&
                  Date.now() - new Date(device.last_check_in).getTime() < 3600 * 1000;

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

                      {/* Live Frame Preview */}
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

                      {/* Sensor Telemetry */}
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

                    {/* Firmware Poll URL & Test Wakeup */}
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

          {/* 2. Advanced Studio & Pipeline Settings */}
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
              {/* Photo Dithering Algorithm */}
              <div>
                <p className="text-xs font-bold text-stone-800">Photo Dithering Algorithm</p>
                <p className="mb-2 text-[11px] text-stone-500">
                  Controls how uploaded photo backdrops map to the 6 e-paper pigments (hand-drawn strokes stay un-dithered).
                </p>
                <div
                  role="group"
                  aria-label="Photo dithering algorithm"
                  className="inline-flex rounded-xl bg-stone-100 p-1"
                >
                  {(["floyd", "atkinson", "nearest"] as DitherAlgo[]).map((algo) => (
                    <button
                      key={algo}
                      type="button"
                      aria-pressed={ditherAlgo === algo}
                      onClick={() => setDitherAlgo(algo)}
                      className={`min-h-[32px] rounded-lg px-3 py-1 text-xs font-bold capitalize transition ${
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

              {/* Scrapbook LUT Inspection Mode */}
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
          NATIVE CONFIRMATION DIALOG FOR DELETING A SCRAPBOOK POSTCARD
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
