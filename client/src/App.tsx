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
  Layers,
  Sparkles,
  Wifi,
  ExternalLink,
} from "lucide-react";
import type { DeviceItem, NoteItem, SystemState, DitherAlgo, ColorOption } from "./types";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 480;

const SPECTRA_PALETTE: ColorOption[] = [
  { name: "Black", hex: "#1e1e1e" },
  { name: "Red", hex: "#9e2a1f" },
  { name: "Blue", hex: "#25467a" },
  { name: "Green", hex: "#2d6a3e" },
  { name: "Yellow", hex: "#d9b82c" },
  { name: "Eraser", hex: "#e8e4d9", isEraser: true },
];

const BRUSH_SIZES = [
  { label: "Fine", size: 3 },
  { label: "Medium", size: 6 },
  { label: "Bold", size: 12 },
  { label: "Marker", size: 24 },
];

export default function App() {
  const [state, setState] = useState<SystemState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
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

  // Canvas Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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

  // Set default recipient once devices load
  useEffect(() => {
    if (state?.devices && state.devices.length > 0 && selectedRecipient === "all") {
      // Keep "all" or select first
    }
  }, [state]);

  // Initialize Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    // Clear with transparent layer
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

  const handleUndo = () => {
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
  };

  const handleRedo = () => {
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
  };

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
    if (!canvas) return { x: 0, y: 0 };
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

    // Quadratic Bézier midpoint curve
    const midX = (prev.x + current.x) / 2;
    const midY = (prev.y + current.y) / 2;

    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
    ctx.stroke();

    lastPoint.current = current;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
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

      // Success
      await fetchState();
      handleClear();
      setCaption("");
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
      }
    } catch (err) {
      console.error("Resend error:", err);
    }
  };

  // Delete Note
  const handleDeleteNote = async (noteId: string) => {
    if (!confirm("Are you sure you want to delete this note from the archive?")) return;
    try {
      const res = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
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
    if (!iso) return "Never checked in";
    const date = new Date(iso);
    const sec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (sec < 60) return "Just now";
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="min-h-screen bg-[#f7f5f0] text-stone-900 pb-16">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#f7f5f0]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#25467a] text-white shadow-sm">
              <Sparkles className="h-5 w-5 text-amber-300" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-stone-900">InkFrame Duo</h1>
              <p className="text-xs font-medium text-stone-500">
                E-Paper Note Studio & Multi-Device Coordination Hub
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchState}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50 active:scale-95"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        {/* Device Coordination Grid */}
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wifi className="h-4 w-4 text-[#25467a]" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-stone-600">
                Connected E-Paper Displays ({state?.devices?.length || 0})
              </h2>
            </div>
            <span className="text-xs text-stone-500">
              Auto-polls every 15m • Spectra 6 (800×480)
            </span>
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
                  className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-start justify-between border-b border-stone-100 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-stone-900">{device.display_name}</h3>
                          <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs font-mono font-medium text-stone-600">
                            {device.device_id}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-stone-500 flex items-center gap-1.5">
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${
                              hasRecentCheckIn ? "bg-emerald-500" : "bg-amber-400"
                            }`}
                          />
                          Last check-in: {formatTimeAgo(device.last_check_in)}
                        </p>
                      </div>

                      {/* Battery Badge */}
                      <div className="flex items-center gap-1 rounded-full bg-stone-50 px-2.5 py-1 border border-stone-200/80">
                        <Battery
                          className={`h-3.5 w-3.5 ${
                            (device.battery_pct ?? 100) > 40 ? "text-emerald-600" : "text-amber-500"
                          }`}
                        />
                        <span className="text-xs font-bold text-stone-700">
                          {device.battery_pct !== null && device.battery_pct !== undefined
                            ? `${device.battery_pct}%`
                            : "USB / Standby"}
                        </span>
                        {device.battery_mv && (
                          <span className="text-[10px] text-stone-400">
                            ({device.battery_mv} mV)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Live Preview Frame */}
                    <div className="mt-3 overflow-hidden rounded-xl border border-stone-200 bg-stone-100 aspect-[5/3] relative group">
                      <img
                        src={
                          device.active_note_id
                            ? `/api/notes/${device.active_note_id}/preview.png`
                            : `/api/frame/${device.device_id}?t=${Date.now()}`
                        }
                        alt={`Display on ${device.display_name}`}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-0.5 font-mono text-[10px] text-white">
                        ETag: {device.active_etag || "pending"}
                      </div>
                    </div>

                    {/* Sensor Telemetry */}
                    <div className="mt-3 flex items-center justify-between text-xs text-stone-600">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Thermometer className="h-3.5 w-3.5 text-rose-500" />
                          {device.temperature_c ? `${device.temperature_c.toFixed(1)}°C` : "--"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Droplets className="h-3.5 w-3.5 text-blue-500" />
                          {device.humidity_pct ? `${device.humidity_pct.toFixed(1)}%` : "--"}
                        </span>
                      </div>
                      {device.sleep_duration_s && (
                        <span className="flex items-center gap-1 text-[11px] text-stone-400">
                          <Clock className="h-3 w-3" />
                          Sleep: {Math.round(device.sleep_duration_s / 60)}m
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions & Auto Rotate URL */}
                  <div className="mt-4 border-t border-stone-100 pt-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 overflow-hidden rounded-lg bg-stone-50 px-2.5 py-1.5 text-[11px] font-mono text-stone-600 border border-stone-200 truncate select-all">
                        {fullPollUrl}
                      </div>
                      <button
                        onClick={() => handleCopyUrl(fullPollUrl)}
                        title="Copy Auto Rotate URL for frame settings"
                        className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 active:scale-95"
                      >
                        {copiedUrl === fullPollUrl ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5 text-stone-500" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleSimulatePoll(device.device_id, device.active_etag)}
                        disabled={isSimulating}
                        title="Simulate device waking up and polling"
                        className="flex items-center gap-1 rounded-lg bg-stone-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-stone-900 active:scale-95 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isSimulating ? "animate-spin" : ""}`} />
                        <span>Simulate</span>
                      </button>
                    </div>

                    {simulationResult && simulationResult.deviceId === device.device_id && (
                      <div className="mt-2 rounded-md bg-stone-100 p-2 text-xs font-mono text-stone-700">
                        Poll Result: {simulationResult.text}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 800x480 Dual-Layer Note Studio */}
        <section className="mb-10 rounded-3xl border border-stone-200/80 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-4">
            <div>
              <h2 className="text-lg font-bold text-stone-900">Note Composer</h2>
              <p className="text-xs text-stone-500">
                Dual-layer pipeline: crisp un-dithered strokes overlaid on dithered Spectra 6 photos
              </p>
            </div>

            {/* Recipient Selection */}
            <div className="flex items-center gap-1.5 bg-stone-100 p-1 rounded-xl">
              <span className="text-xs font-bold text-stone-500 px-2">Send to:</span>
              <button
                type="button"
                onClick={() => setSelectedRecipient("all")}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                  selectedRecipient === "all"
                    ? "bg-[#25467a] text-white shadow-sm"
                    : "text-stone-700 hover:bg-stone-200/70"
                }`}
              >
                All Frames
              </button>
              {state?.devices.map((d) => (
                <button
                  key={d.device_id}
                  type="button"
                  onClick={() => setSelectedRecipient(d.device_id)}
                  className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                    selectedRecipient === d.device_id
                      ? "bg-[#25467a] text-white shadow-sm"
                      : "text-stone-700 hover:bg-stone-200/70"
                  }`}
                >
                  {d.display_name.replace(" Desk Frame", "")}
                </button>
              ))}
            </div>
          </div>

          {/* Canvas Toolbar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            {/* 6 Native Spectra Colors */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-stone-500">Ink:</span>
              <div className="flex items-center gap-1.5 bg-stone-100 p-1 rounded-xl">
                {SPECTRA_PALETTE.map((color) => {
                  const isSelected = currentColor === color.hex;
                  return (
                    <button
                      key={color.name}
                      type="button"
                      onClick={() => setCurrentColor(color.hex)}
                      title={color.name}
                      className={`relative flex h-7 w-7 items-center justify-center rounded-lg transition-transform ${
                        isSelected ? "scale-110 shadow-md ring-2 ring-[#25467a] ring-offset-1" : "hover:scale-105"
                      }`}
                      style={{
                        backgroundColor: color.hex,
                        border: color.name === "Eraser" ? "1px solid #d6d3cb" : "none",
                      }}
                    >
                      {isSelected && (
                        <div
                          className={`h-1.5 w-1.5 rounded-full ${
                            color.name === "Yellow" || color.name === "Eraser"
                              ? "bg-stone-900"
                              : "bg-white"
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Brush Thickness */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-stone-500">Width:</span>
              <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl">
                {BRUSH_SIZES.map((b) => (
                  <button
                    key={b.size}
                    type="button"
                    onClick={() => setBrushSize(b.size)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      brushSize === b.size
                        ? "bg-white text-stone-900 font-bold shadow-sm"
                        : "text-stone-600 hover:text-stone-900"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Undo / Redo / Clear */}
            <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndo}
                title="Undo (Ctrl+Z)"
                className="rounded-lg p-1.5 text-stone-700 hover:bg-white hover:shadow-sm disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={!canRedo}
                title="Redo"
                className="rounded-lg p-1.5 text-stone-700 hover:bg-white hover:shadow-sm disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Redo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleClear}
                title="Clear ink layer"
                className="rounded-lg p-1.5 text-rose-600 hover:bg-white hover:shadow-sm"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Interactive 800x480 Canvas Container */}
          <div className="relative mx-auto w-full max-w-[800px] overflow-hidden rounded-2xl border-4 border-stone-800 bg-[#e8e4d9] shadow-inner aspect-[5/3] select-none cursor-crosshair">
            {/* Background photo preview if uploaded */}
            {bgImage && (
              <img
                src={bgImage}
                alt="Background Layer"
                className="absolute inset-0 h-full w-full object-cover pointer-events-none opacity-90"
              />
            )}

            {/* Drawing Canvas */}
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="absolute inset-0 h-full w-full"
            />
          </div>

          {/* Photo & Dithering Controls */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
            <div className="flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 shadow-sm hover:bg-stone-50 active:scale-95">
                <ImageIcon className="h-4 w-4 text-[#25467a]" />
                <span>{bgImage ? "Replace Photo" : "Upload Background Photo"}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleBgUpload}
                  className="hidden"
                />
              </label>

              {bgImage && (
                <>
                  <div className="flex items-center gap-1 rounded-lg bg-stone-100 p-1">
                    <span className="text-xs font-bold text-stone-500 px-1.5">Dither:</span>
                    {(["floyd", "atkinson", "nearest"] as DitherAlgo[]).map((algo) => (
                      <button
                        key={algo}
                        type="button"
                        onClick={() => setDitherAlgo(algo)}
                        className={`rounded-md px-2 py-0.5 text-xs font-medium capitalize ${
                          ditherAlgo === algo
                            ? "bg-white text-stone-900 font-bold shadow-sm"
                            : "text-stone-600 hover:text-stone-900"
                        }`}
                      >
                        {algo}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setBgImage(null)}
                    className="text-xs font-semibold text-rose-600 hover:underline"
                  >
                    Remove Photo
                  </button>
                </>
              )}
            </div>

            {/* Optional PIN Input if required */}
            {state?.config.webPinRequired && (
              <input
                type="password"
                placeholder="Access PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="w-28 rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-mono"
              />
            )}

            {/* Send Button */}
            <button
              type="button"
              onClick={handleSendNote}
              disabled={isSending}
              className="inline-flex items-center gap-2 rounded-xl bg-[#25467a] px-6 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-[#1a345c] active:scale-95 disabled:opacity-50"
            >
              <Send className={`h-4 w-4 ${isSending ? "animate-pulse" : ""}`} />
              <span>{isSending ? "Processing Spectra 6..." : "Send to Frame"}</span>
            </button>
          </div>
        </section>

        {/* Flipbook History & Re-Send Gallery */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-stone-900">Flipbook Archive</h2>
              <p className="text-xs text-stone-500">
                Shared notes history • Tap re-send to cycle any note back to a desk frame
              </p>
            </div>
            <span className="text-xs font-medium text-stone-500">
              {state?.notes.length || 0} notes archived
            </span>
          </div>

          {state?.notes && state.notes.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {state.notes.map((note) => {
                const showTheoretical = showHardwareLut[note.id] ?? false;
                const noteDate = new Date(note.created_at);

                return (
                  <div
                    key={note.id}
                    className="overflow-hidden rounded-2xl border border-stone-200 bg-white p-3 shadow-sm transition hover:shadow-md"
                  >
                    <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-100 aspect-[5/3] relative">
                      <img
                        src={`/api/notes/${note.id}/${showTheoretical ? "device" : "preview"}.png`}
                        alt={`Note ${note.id}`}
                        className="h-full w-full object-cover"
                      />
                      <button
                        onClick={() =>
                          setShowHardwareLut((prev) => ({
                            ...prev,
                            [note.id]: !prev[note.id],
                          }))
                        }
                        title="Toggle theoretical hardware colors vs perceived preview"
                        className="absolute top-2 right-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm hover:bg-black/80"
                      >
                        {showTheoretical ? "Hardware LUT" : "Perceived"}
                      </button>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <div>
                        <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-bold text-stone-700">
                          To: {note.recipient}
                        </span>
                        <p className="mt-1 text-[11px] text-stone-400">
                          {noteDate.toLocaleDateString()} {noteDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {note.dither_algo}
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleResend(note.id, note.recipient)}
                          title="Re-send to frame"
                          className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Re-Send</span>
                        </button>
                        <button
                          onClick={() => handleDeleteNote(note.id)}
                          title="Delete note"
                          className="rounded-lg p-1 text-stone-400 hover:text-rose-600 hover:bg-stone-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-stone-200 p-8 text-center text-stone-400">
              No notes created yet. Draw your first note above to send to your frames!
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
