import React from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Circle,
  Coffee,
  CopyPlus,
  Crop,
  Eraser,
  FlipHorizontal2,
  Heart,
  ImagePlus,
  Maximize2,
  MessageCircle,
  Minus,
  PaintBucket,
  PenTool,
  Plus,
  RotateCcw,
  RotateCw,
  Square,
  Stamp as StampIcon,
  Star,
  Sun,
  Cloud,
  Trash2,
  Type,
  Cat,
  Mail,
} from "lucide-react";
import type {
  BrushStyle,
  CollageLayoutId,
  DitherAlgo,
  DrawMode,
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

export interface StudioToolbarsProps {
  activeTool: ToolMode;
  selectedItem: SelectedItem;
  brushStyle: BrushStyle;
  onChangeBrushStyle: (style: BrushStyle) => void;
  drawMode: DrawMode;
  onChangeDrawMode: (mode: DrawMode) => void;
  currentColor: string;
  // Image inspector props
  images: ImageLayer[];
  selectedImage: ImageLayer | null;
  isCroppingImage: boolean;
  onToggleCropImage: () => void;
  onAddPhotosClick: () => void;
  onApplyCollageLayout: (layout: CollageLayoutId) => void;
  onUpdateImage: (id: string, patch: Partial<ImageLayer>, recordUndo?: boolean) => void;
  onCommitImageChange: () => void;
  onApplyImageAspectCrop: (id: string, aspect: number | "reset") => void;
  onFillCanvasImage: (id: string) => void;
  onReorderImage: (id: string, dir: "forward" | "backward") => void;
  onDuplicateImage: (id: string) => void;
  onDeleteSelected: () => void;
  ditherAlgo: DitherAlgo;
  onChangeDitherAlgo: (algo: DitherAlgo) => void;
  // Text inspector props
  selectedText: TextLayer | null;
  draftText: string;
  draftFont: TextFont;
  draftBackdrop: TextBackdrop;
  textInputRef: React.RefObject<HTMLTextAreaElement>;
  onChangeDraftText: (text: string) => void;
  onChangeDraftFont: (font: TextFont) => void;
  onChangeDraftBackdrop: (backdrop: TextBackdrop) => void;
  onAddNewText: (initialText?: string) => void;
  // Stamp tray props
  selectedStamp: StampLayer | null;
  onPlaceStamp: (stampId: StampId) => void;
  onRotateSelectedStamp: (deltaRad: number) => void;
  // Paper template props
  templateId: TemplateId;
  onChangeTemplate: (id: TemplateId) => void;
}

function StampPreviewIcon({ id }: { id: StampId }) {
  const cls = "h-4 w-4";
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

export const StudioToolbars: React.FC<StudioToolbarsProps> = ({
  activeTool,
  selectedItem,
  brushStyle,
  onChangeBrushStyle,
  drawMode,
  onChangeDrawMode,
  images,
  selectedImage,
  isCroppingImage,
  onToggleCropImage,
  onAddPhotosClick,
  onApplyCollageLayout,
  onUpdateImage,
  onCommitImageChange,
  onApplyImageAspectCrop,
  onFillCanvasImage,
  onReorderImage,
  onDuplicateImage,
  onDeleteSelected,
  ditherAlgo,
  onChangeDitherAlgo,
  selectedText,
  draftText,
  draftFont,
  draftBackdrop,
  textInputRef,
  onChangeDraftText,
  onChangeDraftFont,
  onChangeDraftBackdrop,
  onAddNewText,
  selectedStamp,
  onPlaceStamp,
  onRotateSelectedStamp,
  templateId,
  onChangeTemplate,
}) => {
  // 1. Selected Image Inspector
  if (selectedItem?.kind === "image" && selectedImage) {
    return (
      <div
        role="region"
        aria-label="Selected photo inspector"
        className="mb-3 rounded-2xl border border-stone-200/90 bg-stone-50/90 p-3 text-xs shadow-sm space-y-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="px-1.5 font-extrabold uppercase tracking-wider text-stone-500 text-[11px]">
              Photo
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdateImage(
                  selectedImage.id,
                  { rotation: selectedImage.rotation - Math.PI / 2 },
                  true
                )
              }
              title="Rotate 90° left"
              className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 font-bold text-stone-700 hover:bg-stone-100"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>-90°</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateImage(
                  selectedImage.id,
                  { rotation: selectedImage.rotation + Math.PI / 2 },
                  true
                )
              }
              title="Rotate 90° right"
              className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 font-bold text-stone-700 hover:bg-stone-100"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>+90°</span>
            </button>
            <button
              type="button"
              aria-pressed={selectedImage.flipX}
              onClick={() =>
                onUpdateImage(
                  selectedImage.id,
                  { flipX: !selectedImage.flipX },
                  true
                )
              }
              className={`inline-flex min-h-[30px] items-center gap-1 rounded-lg border px-2 py-1 font-bold transition ${
                selectedImage.flipX
                  ? "border-[#25467a] bg-[#25467a] text-white"
                  : "border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
              }`}
            >
              <FlipHorizontal2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Flip</span>
            </button>
            <button
              type="button"
              onClick={() => onFillCanvasImage(selectedImage.id)}
              className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 font-bold text-stone-700 hover:bg-stone-100"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Fill Canvas</span>
            </button>
            <button
              type="button"
              aria-pressed={isCroppingImage}
              onClick={onToggleCropImage}
              className={`inline-flex min-h-[30px] items-center gap-1 rounded-lg border px-2.5 py-1 font-bold transition ${
                isCroppingImage
                  ? "border-amber-600 bg-amber-100 text-amber-950"
                  : "border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
              }`}
            >
              <Crop className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isCroppingImage ? "Done Trim" : "Trim Crop"}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => onReorderImage(selectedImage.id, "backward")}
              aria-label="Send photo backward"
              title="Send Backward"
              className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 font-bold text-stone-700 hover:bg-stone-100"
            >
              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onReorderImage(selectedImage.id, "forward")}
              aria-label="Bring photo forward"
              title="Bring Forward"
              className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 font-bold text-stone-700 hover:bg-stone-100"
            >
              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onDuplicateImage(selectedImage.id)}
              aria-label="Duplicate photo"
              title="Duplicate"
              className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 font-bold text-stone-700 hover:bg-stone-100"
            >
              <CopyPlus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onDeleteSelected}
              aria-label="Remove selected photo"
              className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1 font-bold text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Remove</span>
            </button>
          </div>
        </div>

        {/* Row 2: Frame style, Aspect crop presets, Collage Layouts, Add Photos */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200/70 pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-stone-500">Frame:</span>
            {(
              [
                { id: "none", label: "Clean" },
                { id: "polaroid", label: "Polaroid" },
                { id: "stamp", label: "Stamp" },
              ] as Array<{ id: FrameStyle; label: string }>
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={selectedImage.frameStyle === f.id}
                onClick={() =>
                  onUpdateImage(selectedImage.id, { frameStyle: f.id }, true)
                }
                className={`min-h-[28px] rounded-lg px-2 py-0.5 text-[11px] font-bold transition ${
                  selectedImage.frameStyle === f.id
                    ? "bg-stone-900 text-white"
                    : "bg-white border border-stone-200 text-stone-700 hover:bg-stone-100"
                }`}
              >
                {f.label}
              </button>
            ))}

            <span className="ml-1 text-[11px] font-bold text-stone-500">Crop:</span>
            {(
              [
                { label: "Full", aspect: "reset" },
                { label: "5:3", aspect: 5 / 3 },
                { label: "1:1", aspect: 1 },
                { label: "4:3", aspect: 4 / 3 },
                { label: "3:4", aspect: 3 / 4 },
              ] as Array<{ label: string; aspect: number | "reset" }>
            ).map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() =>
                  onApplyImageAspectCrop(selectedImage.id, preset.aspect)
                }
                className="min-h-[28px] rounded-lg border border-stone-200 bg-white px-2 py-0.5 text-[11px] font-bold text-stone-700 hover:bg-stone-100"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] font-bold text-stone-500">Layout:</span>
            {(
              [
                { id: "full", label: "Full" },
                { id: "split", label: "Grid" },
                { id: "scatter", label: "Polaroids" },
                { id: "strip", label: "Strip" },
              ] as Array<{ id: CollageLayoutId; label: string }>
            ).map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onApplyCollageLayout(l.id)}
                className="min-h-[28px] rounded-lg border border-stone-200 bg-white px-2 py-0.5 text-[11px] font-bold text-stone-700 hover:bg-stone-100"
              >
                {l.label}
              </button>
            ))}
            <button
              type="button"
              onClick={onAddPhotosClick}
              className="inline-flex min-h-[28px] items-center gap-1 rounded-lg bg-[#25467a] px-2.5 py-0.5 text-[11px] font-bold text-white hover:bg-[#1e3a66]"
            >
              <ImagePlus className="h-3 w-3" aria-hidden="true" />
              <span>+ Photos</span>
            </button>
          </div>
        </div>

        {/* Row 3: Brightness, Contrast, Dither Algorithm */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200/70 pt-2">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[11px] font-bold text-stone-700">
              <span>Bright</span>
              <input
                type="range"
                min={0.5}
                max={1.6}
                step={0.05}
                value={selectedImage.brightness}
                onChange={(e) =>
                  onUpdateImage(
                    selectedImage.id,
                    { brightness: Number(e.target.value) },
                    false
                  )
                }
                onMouseUp={onCommitImageChange}
                onTouchEnd={onCommitImageChange}
                className="h-1.5 w-24 accent-[#25467a]"
              />
              <span className="w-8 tabular-nums text-stone-500">
                {Math.round(selectedImage.brightness * 100)}%
              </span>
            </label>

            <label className="flex items-center gap-2 text-[11px] font-bold text-stone-700">
              <span>Contrast</span>
              <input
                type="range"
                min={0.5}
                max={1.8}
                step={0.05}
                value={selectedImage.contrast}
                onChange={(e) =>
                  onUpdateImage(
                    selectedImage.id,
                    { contrast: Number(e.target.value) },
                    false
                  )
                }
                onMouseUp={onCommitImageChange}
                onTouchEnd={onCommitImageChange}
                className="h-1.5 w-24 accent-[#25467a]"
              />
              <span className="w-8 tabular-nums text-stone-500">
                {Math.round(selectedImage.contrast * 100)}%
              </span>
            </label>
          </div>

          <div
            role="group"
            aria-label="Photo dithering algorithm"
            className="flex items-center gap-1 rounded-xl bg-stone-200/70 p-0.5"
          >
            <span className="px-1.5 text-[10px] font-extrabold uppercase text-stone-600">
              Dither
            </span>
            {(["floyd", "atkinson", "bayer", "nearest"] as DitherAlgo[]).map(
              (algo) => (
                <button
                  key={algo}
                  type="button"
                  aria-pressed={ditherAlgo === algo}
                  onClick={() => onChangeDitherAlgo(algo)}
                  className={`min-h-[26px] rounded-lg px-2 py-0.5 text-[11px] font-bold capitalize transition ${
                    ditherAlgo === algo
                      ? "bg-white text-stone-900 shadow-sm"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  {algo}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2. Text Inspector / Creator
  if (selectedItem?.kind === "text" || activeTool === "text") {
    const activeTextValue = selectedText ? selectedText.text : draftText;
    const activeFont = selectedText ? selectedText.font : draftFont;
    const activeBackdrop = selectedText ? selectedText.backdrop : draftBackdrop;

    return (
      <div
        role="region"
        aria-label="Text tool controls"
        className="mb-3 flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-stone-200/90 bg-stone-50/90 p-3 text-xs shadow-sm"
      >
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[220px]">
          <Type className="h-4 w-4 text-[#25467a] shrink-0" aria-hidden="true" />
          <label htmlFor="canvas-text-input" className="visually-hidden">
            Text label content
          </label>
          <textarea
            id="canvas-text-input"
            ref={textInputRef}
            rows={1}
            placeholder="Type postcard note (Enter for new line)..."
            value={activeTextValue}
            onChange={(e) => onChangeDraftText(e.target.value)}
            className="min-h-[34px] flex-1 min-w-[180px] resize-y rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-900 placeholder:text-stone-400"
          />
          <button
            type="button"
            onClick={() => onAddNewText()}
            className="inline-flex min-h-[34px] items-center gap-1 rounded-xl bg-[#25467a] px-3 py-1 font-bold text-white shadow-sm hover:bg-[#1e3a66]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{selectedText ? "Add Another" : "Place Text"}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "handwritten", label: "Handwritten" },
              { id: "typewriter", label: "Typewriter" },
              { id: "bold", label: "Bold" },
              { id: "pixel", label: "Mono" },
            ] as Array<{ id: TextFont; label: string }>
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={activeFont === f.id}
              onClick={() => onChangeDraftFont(f.id)}
              className={`min-h-[30px] rounded-lg px-2 py-1 text-[11px] font-bold transition ${
                activeFont === f.id
                  ? "bg-stone-900 text-white"
                  : "border border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
              }`}
            >
              {f.label}
            </button>
          ))}

          <div className="mx-0.5 h-4 w-px bg-stone-300" aria-hidden="true" />

          {(
            [
              { id: "none", label: "No Bg" },
              { id: "pill-light", label: "Paper Tag" },
              { id: "pill-dark", label: "Dark Tag" },
            ] as Array<{ id: TextBackdrop; label: string }>
          ).map((b) => (
            <button
              key={b.id}
              type="button"
              aria-pressed={activeBackdrop === b.id}
              onClick={() => onChangeDraftBackdrop(b.id)}
              className={`min-h-[30px] rounded-lg px-2 py-1 text-[11px] font-bold transition ${
                activeBackdrop === b.id
                  ? "bg-[#9e2a1f] text-white"
                  : "border border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
              }`}
            >
              {b.label}
            </button>
          ))}

          {selectedText && (
            <button
              type="button"
              onClick={onDeleteSelected}
              aria-label="Delete selected text"
              className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1 font-bold text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // 3. Stamps Tray (or selected stamp quick actions)
  if (selectedItem?.kind === "stamp" || activeTool === "stamp") {
    return (
      <div
        role="region"
        aria-label="Postcard stamps tray"
        className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-stone-200/90 bg-stone-50/90 p-2.5 text-xs shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 px-1.5 text-[11px] font-extrabold uppercase tracking-wider text-stone-500">
            <StampIcon className="h-3.5 w-3.5 text-[#9e2a1f]" aria-hidden="true" />
            Stamps
          </span>
          {STAMPS.map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => onPlaceStamp(st.id)}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-2.5 py-1 font-bold text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#25467a] hover:text-[#25467a] active:scale-95"
            >
              <StampPreviewIcon id={st.id} />
              <span>{st.label}</span>
            </button>
          ))}
        </div>

        {selectedStamp && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onRotateSelectedStamp(-Math.PI / 4)}
              aria-label="Rotate stamp left"
              className="inline-flex min-h-[30px] items-center rounded-lg border border-stone-200 bg-white px-2 py-1 font-bold text-stone-700 hover:bg-stone-100"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onRotateSelectedStamp(Math.PI / 4)}
              aria-label="Rotate stamp right"
              className="inline-flex min-h-[30px] items-center rounded-lg border border-stone-200 bg-white px-2 py-1 font-bold text-stone-700 hover:bg-stone-100"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onDeleteSelected}
              aria-label="Delete selected stamp"
              className="inline-flex min-h-[30px] items-center rounded-lg border border-rose-200 bg-white px-2 py-1 font-bold text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    );
  }

  // 4. Stationery Paper Templates Strip
  if (activeTool === "paper") {
    return (
      <div
        role="region"
        aria-label="Stationery templates"
        className="mb-3 flex flex-wrap items-center gap-1.5 rounded-2xl border border-stone-200/90 bg-stone-50/90 p-2.5 text-xs shadow-sm"
      >
        <span className="px-1.5 text-[11px] font-extrabold uppercase tracking-wider text-stone-500">
          Paper &amp; Games
        </span>
        {STATIONERY_TEMPLATES.map((tpl) => {
          const active = templateId === tpl.id;
          return (
            <button
              key={tpl.id}
              type="button"
              aria-pressed={active}
              title={tpl.description}
              onClick={() => onChangeTemplate(tpl.id)}
              className={`min-h-[32px] rounded-xl px-3 py-1 font-bold transition ${
                active
                  ? "bg-[#25467a] text-white shadow-sm"
                  : "border border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
              }`}
            >
              {tpl.label}
            </button>
          );
        })}
      </div>
    );
  }

  // 5. Arrange / Collage Strip (when Arrange is active with no item selected)
  if (activeTool === "arrange") {
    return (
      <div
        role="region"
        aria-label="Collage and object arrange controls"
        className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-stone-200/90 bg-stone-50/90 p-2.5 text-xs shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-stone-700">
            {images.length > 0
              ? "Click any photo, text, or stamp on the postcard to move, scale, or rotate."
              : "Drop photos here, paste from clipboard (⌘V), or add photos to build a collage."}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {images.length > 0 &&
            (
              [
                { id: "full", label: "Full" },
                { id: "split", label: "Grid" },
                { id: "scatter", label: "Polaroids" },
                { id: "strip", label: "Strip" },
              ] as Array<{ id: CollageLayoutId; label: string }>
            ).map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onApplyCollageLayout(l.id)}
                className="min-h-[30px] rounded-lg border border-stone-200 bg-white px-2.5 py-1 font-bold text-stone-700 hover:bg-stone-100"
              >
                {l.label}
              </button>
            ))}

          <button
            type="button"
            onClick={onAddPhotosClick}
            className="inline-flex min-h-[30px] items-center gap-1.5 rounded-xl bg-[#25467a] px-3 py-1 font-bold text-white shadow-sm hover:bg-[#1e3a66]"
          >
            <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>+ Add Photos</span>
          </button>
        </div>
      </div>
    );
  }

  // 6. Eraser or Draw Strip
  if (activeTool === "eraser") {
    return (
      <div
        role="region"
        aria-label="Eraser mode"
        className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-stone-200/90 bg-stone-50/90 px-3.5 py-2.5 text-xs shadow-sm"
      >
        <span className="flex items-center gap-2 font-bold text-stone-700">
          <Eraser className="h-4 w-4 text-stone-600" aria-hidden="true" />
          Eraser removes only hand-drawn ink — photos and stationery underneath stay safe.
        </span>
        <span className="text-[11px] font-semibold text-stone-500">
          Pick any ink color above to resume drawing
        </span>
      </div>
    );
  }

  // Default: Draw Strip (Brush styles + Modes)
  return (
    <div
      role="region"
      aria-label="Brush style and shape tools"
      className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-stone-200/90 bg-stone-50/90 p-2.5 text-xs shadow-sm"
    >
      <div
        role="group"
        aria-label="Brush style"
        className="flex flex-wrap items-center gap-1"
      >
        <span className="px-1.5 text-[11px] font-extrabold uppercase tracking-wider text-stone-500">
          Nib
        </span>
        {(
          [
            { id: "pen", label: "Smooth Pen" },
            { id: "marker", label: "Marker" },
            { id: "calligraphy", label: "Calligraphy" },
            { id: "halftone", label: "Halftone Mix" },
          ] as Array<{ id: BrushStyle; label: string }>
        ).map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={brushStyle === s.id}
            onClick={() => {
              onChangeBrushStyle(s.id);
              if (drawMode === "fill") onChangeDrawMode("freehand");
            }}
            className={`min-h-[30px] rounded-xl px-2.5 py-1 font-bold transition ${
              brushStyle === s.id && drawMode !== "fill"
                ? "bg-stone-900 text-white shadow-sm"
                : "border border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div
        role="group"
        aria-label="Drawing shape or fill mode"
        className="flex flex-wrap items-center gap-1"
      >
        {(
          [
            { id: "freehand", label: "Draw", icon: PenTool },
            { id: "line", label: "Line", icon: Minus },
            { id: "rect", label: "Rect", icon: Square },
            { id: "circle", label: "Circle", icon: Circle },
            { id: "heart", label: "Heart", icon: Heart },
            { id: "fill", label: "Fill", icon: PaintBucket },
          ] as Array<{ id: DrawMode; label: string; icon: React.ComponentType<{ className?: string }> }>
        ).map((m) => {
          const Icon = m.icon;
          const active = drawMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChangeDrawMode(m.id)}
              className={`inline-flex min-h-[30px] items-center gap-1 rounded-xl px-2.5 py-1 font-bold transition ${
                active
                  ? "bg-[#25467a] text-white shadow-sm"
                  : "border border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
