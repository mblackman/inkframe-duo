import React, { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eraser,
  Eye,
  EyeOff,
  FileText,
  Layers,
  Lock,
  Pencil,
  Plus,
  Sticker,
  Trash2,
  Unlock,
} from "lucide-react";
import type { ImageLayer, InkLayerItem, StampLayer, TemplateId, TextLayer } from "../types";
import { STATIONERY_TEMPLATES } from "../engine/templates";

export interface TracingSheetsCardProps {
  inkLayers: InkLayerItem[];
  activeInkLayerId: string;
  onSelectInkLayer: (id: string) => void;
  onAddInkLayer: () => void;
  onMoveInkLayer: (dir: "up" | "down") => void;
  onMergeDownInkLayer: () => void;
  onClearActiveInkLayer: () => void;
  onDeleteActiveInkLayer: () => void;
  onToggleInkLayerVisible: (id: string) => void;
  onToggleInkLayerLocked: (id: string) => void;
  onRenameInkLayer: (id: string, name: string) => void;
  objectsVisible: boolean;
  onToggleObjectsVisible: () => void;
  paperVisible: boolean;
  onTogglePaperVisible: () => void;
  templateId: TemplateId;
  onOpenPaperTool: () => void;
  images: ImageLayer[];
  texts: TextLayer[];
  stamps: StampLayer[];
}

function getSheetHint(layer: InkLayerItem): string {
  if (layer.locked) return "Locked";
  const lower = layer.name.toLowerCase();
  if (lower.includes("lineart") || lower.includes("reply")) return "Outlines";
  if (lower.includes("color")) return "Behind lines";
  return "Sheet";
}

export const TracingSheetsCard: React.FC<TracingSheetsCardProps> = ({
  inkLayers,
  activeInkLayerId,
  onSelectInkLayer,
  onAddInkLayer,
  onMoveInkLayer,
  onMergeDownInkLayer,
  onClearActiveInkLayer,
  onDeleteActiveInkLayer,
  onToggleInkLayerVisible,
  onToggleInkLayerLocked,
  onRenameInkLayer,
  objectsVisible,
  onToggleObjectsVisible,
  paperVisible,
  onTogglePaperVisible,
  templateId,
  onOpenPaperTool,
  images,
  texts,
  stamps,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const activeIdx = inkLayers.findIndex((l) => l.id === activeInkLayerId);
  const activeLayer = activeIdx >= 0 ? inkLayers[activeIdx] : null;
  const canMoveUp = activeIdx >= 0 && activeIdx < inkLayers.length - 1;
  const canMoveDown = activeIdx > 0;
  const canMergeDown =
    activeIdx > 0 && !activeLayer?.locked && !inkLayers[activeIdx - 1]?.locked;
  const canDelete = inkLayers.length > 1;
  const atLimit = inkLayers.length >= 4;

  const reversedSheets = [...inkLayers].reverse();
  const templateLabel =
    STATIONERY_TEMPLATES.find((t) => t.id === templateId)?.label ?? "Blank Paper";
  const stickerCount = stamps.length + texts.length;

  const commitRename = () => {
    if (editingId && draftName.trim()) {
      onRenameInkLayer(editingId, draftName.trim());
    }
    setEditingId(null);
  };

  return (
    <section
      aria-labelledby="tracing-sheets-heading"
      className="rounded-2xl border-2 border-[var(--card-border)] bg-[var(--card-surface)] p-3.5 shadow-[0_3px_0_var(--card-shadow)]"
    >
      {/* Header */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Layers className="h-4 w-4 shrink-0 text-[#25467a]" aria-hidden="true" />
          <h2
            id="tracing-sheets-heading"
            className="whitespace-nowrap text-[11px] font-extrabold uppercase tracking-wide text-stone-800"
          >
            Tracing Sheets
          </h2>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-[#f5efe4] px-1.5 py-0.5 text-[10px] font-bold text-[#6b6359]">
            {inkLayers.length}/4
          </span>
        </div>

        <button
          type="button"
          aria-disabled={atLimit}
          onClick={() => {
            if (!atLimit) onAddInkLayer();
          }}
          title={atLimit ? "Maximum 4 tracing sheets" : "Add a new tracing sheet"}
          className={`inline-flex shrink-0 whitespace-nowrap items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-extrabold transition ${
            atLimit
              ? "border-stone-200 bg-stone-100 text-stone-400 cursor-not-allowed"
              : "border-[#25467a]/30 bg-[#eef3fb] text-[#25467a] hover:bg-[#dfe9f8]"
          }`}
        >
          <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Sheet</span>
        </button>
      </div>

      {/* Tactile Vellum Sheet Cards (top-most first) */}
      <div className="space-y-1.5">
        {reversedSheets.map((layer) => {
          const isActive = layer.id === activeInkLayerId;
          const isEditing = editingId === layer.id;

          return (
            <div
              key={layer.id}
              onClick={() => onSelectInkLayer(layer.id)}
              onDoubleClick={() => {
                setEditingId(layer.id);
                setDraftName(layer.name);
              }}
              className={`group flex cursor-pointer items-center justify-between gap-1.5 rounded-xl border-2 px-2.5 py-2 transition ${
                isActive
                  ? "border-[#25467a] bg-[#eef3fb] shadow-sm"
                  : "border-[var(--card-border)] bg-[#fcf9f2] hover:bg-[#f6efe2]"
              } ${!layer.visible ? "opacity-60" : ""}`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                    isActive
                      ? "border-[#25467a] bg-[#25467a] text-white"
                      : "border-[var(--card-border)] bg-white text-stone-400"
                  }`}
                  aria-hidden="true"
                >
                  <Pencil className="h-3 w-3" />
                </span>

                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                        aria-label="Sheet name"
                        className="w-full rounded border border-[#25467a] bg-white px-1.5 py-0.5 text-xs font-bold text-stone-900"
                      />
                      <button
                        type="button"
                        onClick={commitRename}
                        aria-label="Save sheet name"
                        className="rounded bg-[#25467a] p-0.5 text-white"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-extrabold text-stone-900">
                        {layer.name}
                      </span>
                      <span className="shrink-0 rounded bg-white/80 px-1.5 py-0.5 text-[9px] font-bold text-[#6b6359]">
                        {getSheetHint(layer)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => onToggleInkLayerVisible(layer.id)}
                  aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                  aria-pressed={!layer.visible}
                  title={layer.visible ? "Hide sheet" : "Show sheet"}
                  className="rounded-md p-1 text-stone-600 hover:bg-white"
                >
                  {layer.visible ? (
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onToggleInkLayerLocked(layer.id)}
                  aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
                  aria-pressed={layer.locked}
                  title={layer.locked ? "Unlock sheet" : "Lock sheet"}
                  className={`rounded-md p-1 hover:bg-white ${
                    layer.locked ? "text-amber-700" : "text-stone-400 hover:text-stone-600"
                  }`}
                >
                  {layer.locked ? (
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Compact Sheet Action Row */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1 rounded-xl border border-[var(--card-border)] bg-[#faf6ef] p-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canMoveUp}
            onClick={() => onMoveInkLayer("up")}
            title="Move active sheet higher"
            aria-label="Move active sheet up"
            className="rounded-lg p-1.5 text-stone-700 hover:bg-white disabled:opacity-35 disabled:hover:bg-transparent"
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={!canMoveDown}
            onClick={() => onMoveInkLayer("down")}
            title="Move active sheet lower"
            aria-label="Move active sheet down"
            className="rounded-lg p-1.5 text-stone-700 hover:bg-white disabled:opacity-35 disabled:hover:bg-transparent"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={!canMergeDown}
            onClick={onMergeDownInkLayer}
            title="Combine active sheet into the sheet beneath it"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-stone-700 hover:bg-white disabled:opacity-35 disabled:hover:bg-transparent"
          >
            <Layers className="h-3 w-3" aria-hidden="true" />
            <span>Merge</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClearActiveInkLayer}
            title="Wipe the active sheet clean"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-stone-700 hover:bg-white"
          >
            <Eraser className="h-3 w-3" aria-hidden="true" />
            <span>Wipe</span>
          </button>
          <button
            type="button"
            disabled={!canDelete}
            onClick={onDeleteActiveInkLayer}
            title="Toss active sheet"
            aria-label="Toss active sheet"
            className="rounded-lg p-1.5 text-rose-700 hover:bg-rose-50 disabled:opacity-35 disabled:hover:bg-transparent"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Bottom Quiet Card Extras */}
      <div className="mt-2.5 grid grid-cols-1 gap-1.5 border-t border-[var(--card-border)] pt-2.5">
        <div className="flex items-center justify-between rounded-xl border border-[var(--card-border)] bg-[#faf6ef] px-2.5 py-1.5 text-[11px]">
          <span className="flex items-center gap-1.5 font-bold text-stone-700">
            <Sticker className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
            <span>Stickers &amp; Labels ({stickerCount})</span>
          </span>
          <button
            type="button"
            onClick={onToggleObjectsVisible}
            aria-label={objectsVisible ? "Hide stickers and labels" : "Show stickers and labels"}
            aria-pressed={!objectsVisible}
            className="rounded p-1 text-stone-600 hover:bg-white"
          >
            {objectsVisible ? (
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-[var(--card-border)] bg-[#faf6ef] px-2.5 py-1.5 text-[11px]">
          <button
            type="button"
            onClick={onOpenPaperTool}
            className="flex min-w-0 items-center gap-1.5 text-left font-bold text-stone-700 hover:text-[#25467a]"
            title="Choose postcard stationery"
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-[#25467a]" aria-hidden="true" />
            <span className="truncate">
              {templateLabel}
              {images.length > 0 ? ` · ${images.length} photo${images.length > 1 ? "s" : ""}` : ""}
            </span>
          </button>
          <button
            type="button"
            onClick={onTogglePaperVisible}
            aria-label={paperVisible ? "Hide stationery paper" : "Show stationery paper"}
            aria-pressed={!paperVisible}
            className="shrink-0 rounded p-1 text-stone-600 hover:bg-white"
          >
            {paperVisible ? (
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </section>
  );
};
