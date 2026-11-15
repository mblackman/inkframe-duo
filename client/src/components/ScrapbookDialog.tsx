import React from "react";
import { BookOpen, Cpu, Reply, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import type { NoteItem } from "../types";

export interface ScrapbookDialogProps {
  dialogRef: React.RefObject<HTMLDialogElement>;
  notes: NoteItem[];
  selectedRecipientLabel: string;
  showHardwareLut: Record<string, boolean>;
  onToggleAllHardwareLut: () => void;
  formatRecipientFriendly: (recipient: string) => string;
  onRemix: (noteId: string) => void;
  onResend: (noteId: string) => void;
  onConfirmDelete: (noteId: string) => void;
  onClose: () => void;
}

export const ScrapbookDialog: React.FC<ScrapbookDialogProps> = ({
  dialogRef,
  notes,
  selectedRecipientLabel,
  showHardwareLut,
  onToggleAllHardwareLut,
  formatRecipientFriendly,
  onRemix,
  onResend,
  onConfirmDelete,
  onClose,
}) => {
  const anyHardwareLut = Object.values(showHardwareLut).some(Boolean);

  return (
    <dialog
      ref={dialogRef}
      id="scrapbook-gallery-dialog"
      {...({ closedby: "any" } as any)}
      aria-labelledby="scrapbook-dialog-title"
      className="m-auto w-[min(94vw,56rem)] rounded-3xl border-2 border-[var(--card-border)] bg-[#fffdf9] p-0 text-stone-900 shadow-2xl"
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--card-border)] bg-[#f7f1e6] px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-300 bg-amber-100 text-amber-800 shadow-sm"
            aria-hidden="true"
          >
            <BookOpen className="h-4 w-4" />
          </div>
          <div>
            <h2 id="scrapbook-dialog-title" className="text-sm font-extrabold text-stone-900">
              Postcard Scrapbook ({notes.length})
            </h2>
            <p className="text-[11px] text-[#6b6359]">
              Remix any keepsake onto your desk to draw a reply, or send again to{" "}
              {selectedRecipientLabel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {notes.length > 0 && (
            <button
              type="button"
              aria-pressed={anyHardwareLut}
              onClick={onToggleAllHardwareLut}
              className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-bold transition ${
                anyHardwareLut
                  ? "border-[#25467a] bg-[#25467a] text-white"
                  : "border-[var(--card-border)] bg-white text-stone-700 hover:bg-[#f5efe4]"
              }`}
            >
              <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{anyHardwareLut ? "Raw Hardware LUT" : "Natural Preview"}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Postcard Scrapbook"
            className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-xl border border-[var(--card-border)] bg-white p-1.5 text-stone-700 hover:bg-[#f5efe4]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="max-h-[76vh] overflow-y-auto bg-[#faf6ef] p-5">
        {notes.length > 0 ? (
          <ul role="list" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {notes.map((note) => {
              const showTheoretical = showHardwareLut[note.id] ?? false;
              const noteDate = new Date(note.created_at);

              return (
                <li
                  key={note.id}
                  className="relative flex flex-col justify-between rounded-2xl border-2 border-[var(--card-border)] bg-[#fffdf9] p-3 pt-4 shadow-[0_3px_0_var(--card-shadow)]"
                >
                  <div
                    aria-hidden="true"
                    className="washi-tape-amber absolute -top-2.5 left-1/2 h-4 w-20 -translate-x-1/2 -rotate-1 rounded-sm"
                  />

                  <div>
                    <div className="relative aspect-[5/3] overflow-hidden rounded-xl border border-[var(--card-border)] bg-[#e8e4d9]">
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
                      <p className="mt-2 truncate text-xs font-extrabold text-stone-800">
                        “{note.caption}”
                      </p>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--card-border)] pt-2">
                    <div>
                      <span className="inline-block rounded-md bg-[#f5efe4] px-1.5 py-0.5 text-[10px] font-bold text-stone-700">
                        To: {formatRecipientFriendly(note.recipient)}
                      </span>
                      <p className="mt-0.5 text-[10px] text-[#6b6359]">
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
                        onClick={() => onRemix(note.id)}
                        title="Load onto canvas to draw a reply"
                        aria-label={`Remix reply to postcard from ${noteDate.toLocaleDateString()}`}
                        className="inline-flex min-h-[28px] items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[#faf6ef] px-2 py-1 text-[11px] font-bold text-stone-800 hover:bg-[#f0e8d9]"
                      >
                        <Reply className="h-3 w-3" aria-hidden="true" />
                        <span>Remix Reply</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onResend(note.id)}
                        title={`Send again to ${selectedRecipientLabel}`}
                        aria-label={`Send postcard again to ${selectedRecipientLabel}`}
                        className="inline-flex min-h-[28px] items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[#faf6ef] px-2 py-1 text-[11px] font-bold text-stone-800 hover:bg-[#f0e8d9]"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden="true" />
                        <span>Send Again</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onConfirmDelete(note.id)}
                        aria-label={`Delete postcard from ${noteDate.toLocaleDateString()}`}
                        className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded-lg p-1 text-[#6b6359] hover:bg-rose-50 hover:text-rose-600"
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
          <div className="rounded-2xl border-2 border-dashed border-[var(--card-border)] bg-[#fffdf9] p-10 text-center">
            <Sparkles className="mx-auto mb-2 h-7 w-7 text-amber-500" aria-hidden="true" />
            <p className="text-sm font-extrabold text-stone-800">
              Your scrapbook is waiting for its first postcard!
            </p>
            <p className="mt-1 text-xs text-[#6b6359]">
              Doodle something lovely on your desk and press Send Postcard to keep it here.
            </p>
          </div>
        )}
      </div>
    </dialog>
  );
};
