import React, { useRef } from "react";
import {
  BookOpen,
  Eye,
  Heart,
  Lock,
  Redo2,
  RotateCcw,
  Send,
  Sparkles,
  Undo2,
  Wifi,
} from "lucide-react";
import type { DeviceItem } from "../types";
import { useToolbarFocusGroup } from "../hooks/useToolbarFocusGroup";

export interface PostcardHeaderProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClearAll: () => void;
  showEInkPreview: boolean;
  onToggleEInkPreview: () => void;
  notesCount: number;
  onOpenScrapbook: () => void;
  devicesList: DeviceItem[];
  onlineDevicesCount: number;
  onOpenAdmin: () => void;
  selectedRecipient: string;
  onChangeRecipient: (val: string) => void;
  webPinRequired: boolean;
  pin: string;
  onChangePin: (val: string) => void;
  isSending: boolean;
  onSendNote: () => void;
}

export const PostcardHeader: React.FC<PostcardHeaderProps> = ({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClearAll,
  showEInkPreview,
  onToggleEInkPreview,
  notesCount,
  onOpenScrapbook,
  devicesList,
  onlineDevicesCount,
  onOpenAdmin,
  selectedRecipient,
  onChangeRecipient,
  webPinRequired,
  pin,
  onChangePin,
  isSending,
  onSendNote,
}) => {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  useToolbarFocusGroup(toolbarRef);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--card-border)] bg-[#fffdf9]/95 px-3 py-1.5 backdrop-blur-sm lg:px-5">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-2">
        {/* Brand Badge + Compact Desk Actions Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 pr-1">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-xl border-2 border-dashed border-[#9e2a1f]/50 bg-[#fff5f2] text-[#9e2a1f] shadow-sm"
              aria-hidden="true"
            >
              <Heart className="h-4 w-4 fill-[#9e2a1f]" />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-extrabold tracking-tight text-stone-900">
                InkFrame Duo
              </h1>
              <span className="hidden sm:inline-block text-[10px] font-bold text-[#6b6359]">
                Postcard &amp; Riso Desk
              </span>
            </div>
          </div>

          <div
            ref={toolbarRef}
            role="toolbar"
            {...({ focusgroup: "toolbar wrap" } as any)}
            aria-label="Desk actions"
            className="flex items-center gap-1 rounded-xl border border-[var(--card-border)] bg-[var(--card-subtle)] p-1"
          >
            <div role="group" aria-label="History" className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label="Undo (Cmd/Ctrl+Z)"
                aria-disabled={!canUndo}
                title="Undo (⌘Z)"
                onClick={() => {
                  if (canUndo) onUndo();
                }}
                className="inline-flex items-center justify-center rounded-lg px-2 py-1 text-stone-700 hover:bg-white"
              >
                <Undo2 className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Redo (Cmd/Ctrl+Shift+Z)"
                aria-disabled={!canRedo}
                title="Redo (⌘⇧Z)"
                onClick={() => {
                  if (canRedo) onRedo();
                }}
                className="inline-flex items-center justify-center rounded-lg px-2 py-1 text-stone-700 hover:bg-white"
              >
                <Redo2 className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onClearAll}
                title="Start a fresh blank card (Undoable)"
                aria-label="Start a fresh card"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-stone-700 hover:bg-white"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                <span className="hidden md:inline">Fresh Card</span>
              </button>
            </div>

            <span role="separator" aria-orientation="vertical" />

            <div role="group" aria-label="Preview" className="flex items-center">
              <button
                type="button"
                aria-pressed={showEInkPreview}
                onClick={onToggleEInkPreview}
                title="Preview exact Spectra 6 e-paper pigment rendering"
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold text-stone-700 hover:bg-white"
              >
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">E-Ink Peek</span>
              </button>
            </div>
          </div>
        </div>

        {/* Postbox Controls */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={onOpenScrapbook}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-white px-2.5 py-1 text-xs font-bold text-stone-700 shadow-sm hover:bg-[#f7f1e6]"
          >
            <BookOpen className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
            <span className="hidden sm:inline">Scrapbook</span>
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-900">
              {notesCount}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenAdmin}
            aria-label="Open Frames and Settings"
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-white px-2.5 py-1 text-xs font-bold text-stone-700 shadow-sm hover:bg-[#f7f1e6]"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                onlineDevicesCount > 0 ? "bg-emerald-500" : "bg-amber-400"
              }`}
              aria-hidden="true"
            />
            <Wifi className="h-3.5 w-3.5 text-[#25467a]" aria-hidden="true" />
            <span className="hidden sm:inline">Frames</span>
          </button>

          <select
            aria-label="Recipient desk frame"
            value={selectedRecipient}
            onChange={(e) => onChangeRecipient(e.target.value)}
            className="min-h-[34px] rounded-xl border border-[var(--card-border)] bg-white px-2.5 py-1 text-xs font-bold text-stone-800 shadow-sm"
          >
            <option value="all">To: Both Frames</option>
            {devicesList.map((d) => (
              <option key={d.device_id} value={d.device_id}>
                To: {d.display_name.replace(" Desk Frame", "")}
              </option>
            ))}
          </select>

          {webPinRequired && (
            <label className="relative flex items-center">
              <span className="visually-hidden">Studio PIN</span>
              <Lock
                className="pointer-events-none absolute left-2 h-3 w-3 text-stone-500"
                aria-hidden="true"
              />
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => onChangePin(e.target.value)}
                placeholder="PIN"
                aria-label="Studio PIN"
                className="min-h-[34px] w-20 rounded-xl border border-[var(--card-border)] bg-white pl-6 pr-2 text-xs font-bold text-stone-900 shadow-sm"
              />
            </label>
          )}

          <button
            type="button"
            onClick={onSendNote}
            disabled={isSending}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl bg-[#9e2a1f] px-3.5 py-1.5 text-xs font-extrabold text-white shadow-[0_3px_0_#6b1a12] transition hover:bg-[#8b241a] active:translate-y-[1px] disabled:opacity-60"
          >
            {isSending ? (
              <RotateCcw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{isSending ? "Sending..." : "Send Postcard"}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
