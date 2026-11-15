import React, { useRef } from "react";
import {
  ArrowRight,
  Cat,
  CheckCircle2,
  Circle,
  Cloud,
  Coffee,
  CopyPlus,
  Crop,
  Eraser,
  FileText,
  FlipHorizontal2,
  Heart,
  ImagePlus,
  Mail,
  MessageCircle,
  Minus,
  MousePointer2,
  PaintBucket,
  PenTool,
  Plus,
  RotateCcw,
  RotateCw,
  Shapes,
  Square,
  Stamp as StampIcon,
  Star,
  Sun,
  Trash2,
  Type,
} from "lucide-react";
import type {
  CollageLayoutId,
  DitherAlgo,
  EraserStyle,
  FigureFillMode,
  FigureShape,
  FillReferenceMode,
  FrameStyle,
  ImageLayer,
  SelectedItem,
  StampId,
  StampLayer,
  TemplateId,
  TextBackdrop,
  TextFont,
  TextLayer,
  ToolMode,
} from "../types";
import { STAMPS, STATIONERY_TEMPLATES } from "../engine/templates";
import type { InkTextureMode } from "./InkPaletteCard";
import { useToolbarFocusGroup } from "../hooks/useToolbarFocusGroup";

export const NIB_SIZE_PRESETS = [3, 7, 14, 26] as const;

export interface PencilCaseDockProps {
  activeTool: ToolMode;
  onSelectTool: (tool: ToolMode) => void;
  // Brush / Pen / Eraser / Figure
  brushSize: number;
  onChangeBrushSize: (size: number) => void;
  penFeel: "pen" | "pencil";
  onChangePenFeel: (feel: "pen" | "pencil") => void;
  inkTexture: InkTextureMode;
  hasMixActive: boolean;
  onSwitchToSolid: () => void;
  eraserStyle: EraserStyle;
  onChangeEraserStyle: (style: EraserStyle) => void;
  onClearActiveInkLayer: () => void;
  figureShape: FigureShape;
  onChangeFigureShape: (shape: FigureShape) => void;
  figureFillMode: FigureFillMode;
  onChangeFigureFillMode: (mode: FigureFillMode) => void;
  fillReference: FillReferenceMode;
  onChangeFillReference: (mode: FillReferenceMode) => void;
  // Object / Image / Text / Stamp / Paper
  selectedItem: SelectedItem;
  images: ImageLayer[];
  selectedImage: ImageLayer | null;
  isCroppingImage: boolean;
  onToggleCropImage: () => void;
  onAddPhotosClick: () => void;
  onApplyCollageLayout: (layout: CollageLayoutId) => void;
  onUpdateImage: (id: string, patch: Partial<ImageLayer>, recordUndo?: boolean) => void;
  onApplyImageAspectCrop: (id: string, aspect: number | "reset") => void;
  onDuplicateImage: (id: string) => void;
  onDeleteSelected: () => void;
  ditherAlgo: DitherAlgo;
  onChangeDitherAlgo: (algo: DitherAlgo) => void;
  selectedText: TextLayer | null;
  draftText: string;
  draftFont: TextFont;
  draftBackdrop: TextBackdrop;
  draftFontSize: number;
  textInputRef: React.RefObject<HTMLTextAreaElement>;
  onChangeDraftText: (val: string) => void;
  onChangeDraftFont: (font: TextFont) => void;
  onChangeDraftBackdrop: (backdrop: TextBackdrop) => void;
  onChangeDraftFontSize: (size: number, commit?: boolean) => void;
  onAddNewText: () => void;
  selectedStamp: StampLayer | null;
  onPlaceStamp: (stampId: StampId) => void;
  onRotateSelectedStamp: (deltaRad: number) => void;
  onScaleSelectedStamp: (scale: number, commit?: boolean) => void;
  templateId: TemplateId;
  onChangeTemplate: (id: TemplateId) => void;
}

function StampIconSvg({ id }: { id: StampId }) {
  const cls = "h-4 w-4 shrink-0";
  switch (id) {
    case "heart":
      return <Heart className={cls} aria-hidden="true" />;
    case "star":
      return <Star className={cls} aria-hidden="true" />;
    case "coffee":
      return <Coffee className={cls} aria-hidden="true" />;
    case "sun":
      return <Sun className={cls} aria-hidden="true" />;
    case "cloud":
      return <Cloud className={cls} aria-hidden="true" />;
    case "postmark":
      return <Mail className={cls} aria-hidden="true" />;
    case "bubble":
      return <MessageCircle className={cls} aria-hidden="true" />;
    case "cat":
      return <Cat className={cls} aria-hidden="true" />;
    case "arrow":
      return <ArrowRight className={cls} aria-hidden="true" />;
    case "check":
      return <CheckCircle2 className={cls} aria-hidden="true" />;
  }
}

const PENCIL_CASE_TOOLS: Array<{
  id: ToolMode;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
}> = [
  { id: "pen", label: "Pen", shortcut: "P", icon: <PenTool className="h-4 w-4" aria-hidden="true" /> },
  {
    id: "fill",
    label: "Bucket",
    shortcut: "G",
    icon: <PaintBucket className="h-4 w-4" aria-hidden="true" />,
  },
  {
    id: "figure",
    label: "Shapes",
    shortcut: "U",
    icon: <Shapes className="h-4 w-4" aria-hidden="true" />,
  },
  {
    id: "eraser",
    label: "Eraser",
    shortcut: "E",
    icon: <Eraser className="h-4 w-4" aria-hidden="true" />,
  },
  {
    id: "stamp",
    label: "Stamps",
    shortcut: "S",
    icon: <StampIcon className="h-4 w-4" aria-hidden="true" />,
  },
  {
    id: "text",
    label: "Label",
    shortcut: "T",
    icon: <Type className="h-4 w-4" aria-hidden="true" />,
  },
  {
    id: "arrange",
    label: "Photos",
    shortcut: "V",
    icon: <MousePointer2 className="h-4 w-4" aria-hidden="true" />,
  },
  {
    id: "paper",
    label: "Paper",
    shortcut: "M",
    icon: <FileText className="h-4 w-4" aria-hidden="true" />,
  },
];

export const PencilCaseDock: React.FC<PencilCaseDockProps> = ({
  activeTool,
  onSelectTool,
  brushSize,
  onChangeBrushSize,
  penFeel,
  onChangePenFeel,
  inkTexture,
  hasMixActive,
  onSwitchToSolid,
  eraserStyle,
  onChangeEraserStyle,
  onClearActiveInkLayer,
  figureShape,
  onChangeFigureShape,
  figureFillMode,
  onChangeFigureFillMode,
  fillReference,
  onChangeFillReference,
  selectedItem,
  images,
  selectedImage,
  isCroppingImage,
  onToggleCropImage,
  onAddPhotosClick,
  onApplyCollageLayout,
  onUpdateImage,
  onApplyImageAspectCrop,
  onDuplicateImage,
  onDeleteSelected,
  selectedText,
  draftText,
  draftFont,
  draftBackdrop,
  draftFontSize,
  textInputRef,
  onChangeDraftText,
  onChangeDraftFont,
  onChangeDraftBackdrop,
  onChangeDraftFontSize,
  onAddNewText,
  selectedStamp,
  onPlaceStamp,
  onRotateSelectedStamp,
  onScaleSelectedStamp,
  templateId,
  onChangeTemplate,
}) => {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  useToolbarFocusGroup(toolbarRef);

  const showNibDots =
    activeTool === "pen" || activeTool === "eraser" || activeTool === "figure";

  const nibLabels = ["Fine", "Medium", "Marker", "Chunky"];

  return (
    <div className="mx-auto w-full max-w-[820px] rounded-2xl border-2 border-[var(--card-border)] bg-[var(--card-surface)] p-2.5 shadow-[0_4px_0_var(--card-shadow),0_10px_24px_rgba(68,54,39,0.07)]">
      {/* Row 1: Contextual One-Thing-at-a-Time Tray */}
      <div className="mb-2 rounded-xl border border-[#ebe2d2] bg-[#f7f1e6] px-3 py-2">
        {/* NIB DOTS + PEN / ERASER / SHAPE CONTROLS */}
        {showNibDots && (
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-extrabold text-[#6b6359]">Nib</span>
              <div role="group" aria-label="Nib size presets" className="flex items-center gap-1.5">
                {NIB_SIZE_PRESETS.map((size, idx) => {
                  const pressed = brushSize === size;
                  const dotPx = Math.min(18, Math.max(5, Math.round(size * 0.65)));
                  return (
                    <button
                      key={size}
                      type="button"
                      aria-label={`${nibLabels[idx]} nib (${size}px)`}
                      aria-pressed={pressed}
                      title={`${nibLabels[idx]} (${size}px)`}
                      onClick={() => onChangeBrushSize(size)}
                      className={`spring-pot flex h-8 w-8 items-center justify-center rounded-xl border-2 ${
                        pressed
                          ? "border-[#25467a] bg-[#25467a] shadow-sm"
                          : "border-[var(--card-border)] bg-white hover:bg-[#faf6ef]"
                      }`}
                    >
                      <span
                        className={`rounded-full ${pressed ? "bg-white" : "bg-stone-800"}`}
                        style={{ width: `${dotPx}px`, height: `${dotPx}px` }}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {activeTool === "pen" && (
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label="Pen feel"
                  className="inline-flex rounded-xl border border-[var(--card-border)] bg-white p-0.5"
                >
                  {(
                    [
                      { id: "pen", label: "Fountain Pen" },
                      { id: "pencil", label: "Dry Crayon" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={penFeel === opt.id}
                      onClick={() => onChangePenFeel(opt.id)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                        penFeel === opt.id
                          ? "bg-[#25467a] text-white"
                          : "text-stone-700 hover:bg-[#f5efe4]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {(inkTexture !== "solid" || hasMixActive) && (
                  <button
                    type="button"
                    onClick={onSwitchToSolid}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-900 hover:bg-amber-100"
                    title="Reset back to solid pure ink"
                  >
                    <span>Halftone active · Switch to Solid</span>
                  </button>
                )}
              </div>
            )}

            {activeTool === "eraser" && (
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label="Eraser style"
                  className="inline-flex rounded-xl border border-[var(--card-border)] bg-white p-0.5"
                >
                  {(
                    [
                      { id: "hard", label: "Pink Eraser" },
                      { id: "kneaded", label: "Kneaded Lift" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={eraserStyle === opt.id}
                      onClick={() => onChangeEraserStyle(opt.id)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                        eraserStyle === opt.id
                          ? "bg-[#25467a] text-white"
                          : "text-stone-700 hover:bg-[#f5efe4]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={onClearActiveInkLayer}
                  className="rounded-xl border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-50"
                >
                  Wipe Sheet
                </button>
              </div>
            )}

            {activeTool === "figure" && (
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label="Shape stencil"
                  className="inline-flex items-center gap-1 rounded-xl border border-[var(--card-border)] bg-white p-0.5"
                >
                  {(
                    [
                      { id: "line", label: "Line", icon: <Minus className="h-3.5 w-3.5" /> },
                      { id: "rect", label: "Box", icon: <Square className="h-3.5 w-3.5" /> },
                      { id: "circle", label: "Circle", icon: <Circle className="h-3.5 w-3.5" /> },
                      { id: "heart", label: "Heart", icon: <Heart className="h-3.5 w-3.5" /> },
                      { id: "star", label: "Star", icon: <Star className="h-3.5 w-3.5" /> },
                    ] as Array<{ id: FigureShape; label: string; icon: React.ReactNode }>
                  ).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-label={s.label}
                      title={s.label}
                      aria-pressed={figureShape === s.id}
                      onClick={() => onChangeFigureShape(s.id)}
                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold ${
                        figureShape === s.id
                          ? "bg-[#25467a] text-white"
                          : "text-stone-700 hover:bg-[#f5efe4]"
                      }`}
                    >
                      {s.icon}
                      <span className="hidden sm:inline">{s.label}</span>
                    </button>
                  ))}
                </div>

                <div
                  role="group"
                  aria-label="Shape style"
                  className="inline-flex rounded-xl border border-[var(--card-border)] bg-white p-0.5"
                >
                  {(
                    [
                      { id: "stroke", label: "Outline" },
                      { id: "fill", label: "Filled" },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      aria-pressed={figureFillMode === mode.id}
                      onClick={() => onChangeFigureFillMode(mode.id)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                        figureFillMode === mode.id
                          ? "bg-[#25467a] text-white"
                          : "text-stone-700 hover:bg-[#f5efe4]"
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* PAINT BUCKET TRAY */}
        {activeTool === "fill" && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-extrabold text-[#6b6359]">Bucket Fill</span>
              <div
                role="group"
                aria-label="Fill boundary sheets"
                className="inline-flex rounded-xl border border-[var(--card-border)] bg-white p-0.5"
              >
                <button
                  type="button"
                  aria-pressed={fillReference === "all"}
                  onClick={() => onChangeFillReference("all")}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                    fillReference === "all"
                      ? "bg-[#25467a] text-white"
                      : "text-stone-700 hover:bg-[#f5efe4]"
                  }`}
                >
                  Stops at All Lines
                </button>
                <button
                  type="button"
                  aria-pressed={fillReference === "active-ink"}
                  onClick={() => onChangeFillReference("active-ink")}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                    fillReference === "active-ink"
                      ? "bg-[#25467a] text-white"
                      : "text-stone-700 hover:bg-[#f5efe4]"
                  }`}
                >
                  This Sheet Only
                </button>
              </div>
            </div>
            <p className="text-[11px] font-medium text-[#6b6359]">
              Tip: Select &lsquo;Coloring&rsquo; sheet to fill neatly behind your Lineart!
            </p>
          </div>
        )}

        {/* RUBBER STAMPS TRAY */}
        {activeTool === "stamp" && (
          <div className="space-y-2">
            <div className="tray-scroller gap-1.5 pb-0.5">
              {STAMPS.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => onPlaceStamp(st.id)}
                  className="spring-pot inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-white px-2.5 py-1.5 text-[11px] font-bold text-stone-800 shadow-sm hover:border-[#25467a]/50 hover:bg-[#eef3fb]"
                >
                  <StampIconSvg id={st.id} />
                  <span>{st.label}</span>
                </button>
              ))}
            </div>

            {selectedStamp && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e5dac6] pt-1.5 text-[11px]">
                <span className="font-bold text-stone-700">Selected stamp:</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      onScaleSelectedStamp(Math.max(0.35, selectedStamp.scale - 0.15), true)
                    }
                    className="rounded-lg border border-[var(--card-border)] bg-white px-2 py-1 font-bold text-stone-700 hover:bg-[#f5efe4]"
                  >
                    Smaller
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onScaleSelectedStamp(Math.min(3.0, selectedStamp.scale + 0.15), true)
                    }
                    className="rounded-lg border border-[var(--card-border)] bg-white px-2 py-1 font-bold text-stone-700 hover:bg-[#f5efe4]"
                  >
                    Bigger
                  </button>
                  <button
                    type="button"
                    onClick={() => onRotateSelectedStamp(-Math.PI / 12)}
                    aria-label="Tilt stamp left"
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-white px-2 py-1 font-bold text-stone-700 hover:bg-[#f5efe4]"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    <span>Tilt</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRotateSelectedStamp(Math.PI / 12)}
                    aria-label="Tilt stamp right"
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-white px-2 py-1 font-bold text-stone-700 hover:bg-[#f5efe4]"
                  >
                    <RotateCw className="h-3 w-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={onDeleteSelected}
                    className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 font-bold text-white hover:bg-rose-700"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TYPEWRITER / LABEL TRAY */}
        {activeTool === "text" && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <textarea
                id="canvas-text-input"
                ref={textInputRef}
                rows={1}
                aria-label="Typewriter label text"
                value={selectedText ? selectedText.text : draftText}
                onChange={(e) => onChangeDraftText(e.target.value)}
                placeholder="Write a note, fortune, or postcard greeting..."
                className="min-h-[34px] min-w-[180px] flex-1 resize-none rounded-xl border border-[var(--card-border)] bg-white px-3 py-1.5 text-xs font-semibold text-stone-900"
              />
              {selectedText ? (
                <button
                  type="button"
                  onClick={onDeleteSelected}
                  className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Remove</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onAddNewText}
                  className="rounded-xl bg-[#25467a] px-3 py-1.5 text-xs font-extrabold text-white hover:bg-[#1e3a66]"
                >
                  Place Label
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div
                role="group"
                aria-label="Label font style"
                className="inline-flex flex-wrap rounded-xl border border-[var(--card-border)] bg-white p-0.5"
              >
                {(["handwritten", "typewriter", "bold", "pixel"] as TextFont[]).map((f) => {
                  const active = (selectedText?.font ?? draftFont) === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onChangeDraftFont(f)}
                      className={`rounded-lg px-2 py-1 capitalize font-bold ${
                        active ? "bg-[#25467a] text-white" : "text-stone-700 hover:bg-[#f5efe4]"
                      }`}
                    >
                      {f}
                    </button>
                  );
                })}
              </div>

              <div
                role="group"
                aria-label="Label size"
                className="inline-flex rounded-xl border border-[var(--card-border)] bg-white p-0.5"
              >
                {[
                  { label: "S", size: 22 },
                  { label: "M", size: 32 },
                  { label: "L", size: 46 },
                ].map((sz) => {
                  const curr = selectedText?.fontSize ?? draftFontSize;
                  const active = Math.abs(curr - sz.size) <= 4;
                  return (
                    <button
                      key={sz.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onChangeDraftFontSize(sz.size, true)}
                      className={`rounded-lg px-2 py-1 font-extrabold ${
                        active ? "bg-[#25467a] text-white" : "text-stone-700 hover:bg-[#f5efe4]"
                      }`}
                    >
                      {sz.label}
                    </button>
                  );
                })}
              </div>

              <div
                role="group"
                aria-label="Label tag backdrop"
                className="inline-flex rounded-xl border border-[var(--card-border)] bg-white p-0.5"
              >
                {(
                  [
                    { id: "none", label: "Clean" },
                    { id: "pill-light", label: "Paper Tag" },
                    { id: "pill-dark", label: "Ink Tag" },
                  ] as Array<{ id: TextBackdrop; label: string }>
                ).map((b) => {
                  const active = (selectedText?.backdrop ?? draftBackdrop) === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onChangeDraftBackdrop(b.id)}
                      className={`rounded-lg px-2 py-1 font-bold ${
                        active ? "bg-[#25467a] text-white" : "text-stone-700 hover:bg-[#f5efe4]"
                      }`}
                    >
                      {b.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* PHOTOS & CUTOUTS TRAY */}
        {activeTool === "arrange" && (
          <div className="space-y-2 text-[11px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={onAddPhotosClick}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#25467a] px-3 py-1.5 text-xs font-extrabold text-white hover:bg-[#1e3a66]"
                >
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add Photo(s)</span>
                </button>

                {images.length >= 2 && (
                  <div
                    role="group"
                    aria-label="Photo collage layout"
                    className="inline-flex flex-wrap rounded-xl border border-[var(--card-border)] bg-white p-0.5"
                  >
                    {(
                      [
                        { id: "split", label: "Split" },
                        { id: "scatter", label: "Polaroid Scatter" },
                        { id: "strip", label: "Photo Strip" },
                        { id: "full", label: "Full" },
                      ] as Array<{ id: CollageLayoutId; label: string }>
                    ).map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => onApplyCollageLayout(l.id)}
                        className="rounded-lg px-2 py-1 font-bold text-stone-700 hover:bg-[#f5efe4]"
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {!selectedImage && selectedItem && (
                <div className="flex items-center gap-1.5">
                  {selectedStamp && (
                    <>
                      <button
                        type="button"
                        onClick={() => onRotateSelectedStamp(-Math.PI / 12)}
                        className="rounded-lg border border-[var(--card-border)] bg-white px-2 py-1 font-bold text-stone-700"
                      >
                        Tilt ↺
                      </button>
                      <button
                        type="button"
                        onClick={() => onRotateSelectedStamp(Math.PI / 12)}
                        className="rounded-lg border border-[var(--card-border)] bg-white px-2 py-1 font-bold text-stone-700"
                      >
                        Tilt ↻
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={onDeleteSelected}
                    className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 font-bold text-white hover:bg-rose-700"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                </div>
              )}

              {!selectedItem && images.length === 0 && (
                <span className="font-medium text-[#6b6359]">
                  Add a photo cutout, or click any stamp or label on your card to move &amp; tilt it!
                </span>
              )}
            </div>

            {selectedImage && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-[#e5dac6] pt-1.5">
                <div
                  role="group"
                  aria-label="Photo cutout frame"
                  className="inline-flex rounded-xl border border-[var(--card-border)] bg-white p-0.5"
                >
                  {(
                    [
                      { id: "none", label: "Clean" },
                      { id: "polaroid", label: "Polaroid" },
                      { id: "stamp", label: "Postage" },
                    ] as Array<{ id: FrameStyle; label: string }>
                  ).map((fr) => (
                    <button
                      key={fr.id}
                      type="button"
                      aria-pressed={selectedImage.frameStyle === fr.id}
                      onClick={() => onUpdateImage(selectedImage.id, { frameStyle: fr.id }, true)}
                      className={`rounded-lg px-2 py-1 font-bold ${
                        selectedImage.frameStyle === fr.id
                          ? "bg-[#25467a] text-white"
                          : "text-stone-700 hover:bg-[#f5efe4]"
                      }`}
                    >
                      {fr.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  aria-pressed={isCroppingImage}
                  onClick={onToggleCropImage}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-bold ${
                    isCroppingImage
                      ? "border-amber-600 bg-amber-600 text-white"
                      : "border-[var(--card-border)] bg-white text-stone-700 hover:bg-[#f5efe4]"
                  }`}
                >
                  <Crop className="h-3 w-3" aria-hidden="true" />
                  <span>{isCroppingImage ? "Done Crop" : "Crop"}</span>
                </button>

                {isCroppingImage && (
                  <button
                    type="button"
                    onClick={() => onApplyImageAspectCrop(selectedImage.id, "reset")}
                    className="rounded-lg border border-[var(--card-border)] bg-white px-2 py-1 font-bold text-stone-700 hover:bg-[#f5efe4]"
                  >
                    Reset Crop
                  </button>
                )}

                <button
                  type="button"
                  aria-pressed={selectedImage.flipX}
                  onClick={() =>
                    onUpdateImage(selectedImage.id, { flipX: !selectedImage.flipX }, true)
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-white px-2 py-1 font-bold text-stone-700 hover:bg-[#f5efe4]"
                >
                  <FlipHorizontal2 className="h-3 w-3" aria-hidden="true" />
                  <span>Flip</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onUpdateImage(
                      selectedImage.id,
                      { brightness: Math.max(0.5, Number((selectedImage.brightness - 0.12).toFixed(2))) },
                      true
                    )
                  }
                  className="rounded-lg border border-[var(--card-border)] bg-white px-2 py-1 font-bold text-stone-700 hover:bg-[#f5efe4]"
                >
                  Darker
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateImage(
                      selectedImage.id,
                      { brightness: Math.min(1.6, Number((selectedImage.brightness + 0.12).toFixed(2))) },
                      true
                    )
                  }
                  className="rounded-lg border border-[var(--card-border)] bg-white px-2 py-1 font-bold text-stone-700 hover:bg-[#f5efe4]"
                >
                  Brighter
                </button>

                <button
                  type="button"
                  onClick={() => onDuplicateImage(selectedImage.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-white px-2 py-1 font-bold text-stone-700 hover:bg-[#f5efe4]"
                >
                  <CopyPlus className="h-3 w-3" aria-hidden="true" />
                  <span>Copy</span>
                </button>

                <button
                  type="button"
                  onClick={onDeleteSelected}
                  className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 font-bold text-white hover:bg-rose-700"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  <span>Remove</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* STATIONERY PAPER TRAY */}
        {activeTool === "paper" && (
          <div className="tray-scroller gap-1.5 pb-0.5">
            {STATIONERY_TEMPLATES.map((tpl) => {
              const active = templateId === tpl.id;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChangeTemplate(tpl.id)}
                  title={tpl.description}
                  className={`spring-pot shrink-0 rounded-xl border-2 px-3 py-1.5 text-left transition ${
                    active
                      ? "border-[#25467a] bg-[#25467a] text-white shadow-sm"
                      : "border-[var(--card-border)] bg-white text-stone-800 hover:bg-[#faf6ef]"
                  }`}
                >
                  <div className="text-[11px] font-extrabold">{tpl.label}</div>
                  <div
                    className={`text-[9px] ${active ? "text-blue-100" : "text-[#6b6359]"}`}
                  >
                    {tpl.description}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Row 2: Tactile Springy Pencil Case Toolbar */}
      <div
        ref={toolbarRef}
        role="toolbar"
        {...({ focusgroup: "toolbar wrap" } as any)}
        aria-label="Postcard drawing tools"
        className="tray-scroller sm:flex-wrap sm:justify-center gap-1.5 px-1 pb-0.5 pt-1"
      >
        {PENCIL_CASE_TOOLS.map((tool) => {
          const pressed = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              aria-pressed={pressed}
              title={`${tool.label} (${tool.shortcut})`}
              onClick={() => onSelectTool(tool.id)}
              className={`spring-tool inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-extrabold ${
                pressed
                  ? "bg-[#25467a] text-white shadow-md"
                  : "border-[var(--card-border)] bg-[#fcf9f2] text-stone-800 hover:bg-[#f5efe4]"
              }`}
            >
              {tool.icon}
              <span>{tool.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
