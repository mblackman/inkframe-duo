import React from "react";
import { Droplet, Sparkles } from "lucide-react";
import type { OpticalMixSwatch } from "../types";
import { OPTICAL_MIX_SWATCHES, SPECTRA_PALETTE } from "../engine/palette-swatches";

export type InkTextureMode = "solid" | "tone25" | "halftone" | "tone75";

export interface InkPaletteCardProps {
  mainColor: string;
  selectedMixId: string | null;
  inkTexture: InkTextureMode;
  onSelectPureColor: (hex: string) => void;
  onSelectOpticalMix: (swatch: OpticalMixSwatch) => void;
  onChangeInkTexture: (texture: InkTextureMode) => void;
}

export const InkPaletteCard: React.FC<InkPaletteCardProps> = ({
  mainColor,
  selectedMixId,
  inkTexture,
  onSelectPureColor,
  onSelectOpticalMix,
  onChangeInkTexture,
}) => {
  const selectedMix = selectedMixId
    ? OPTICAL_MIX_SWATCHES.find((sw) => sw.id === selectedMixId) ?? null
    : null;
  const activePureName =
    SPECTRA_PALETTE.find((c) => c.hex === mainColor)?.name ?? mainColor;

  const activeChipStyle: React.CSSProperties = selectedMix
    ? {
        backgroundImage: `repeating-conic-gradient(${selectedMix.primaryHex} 0% 25%, ${selectedMix.secondaryHex} 0% 50%)`,
        backgroundSize: "6px 6px",
      }
    : inkTexture !== "solid"
    ? {
        backgroundImage: `radial-gradient(${mainColor} 42%, #faf6ef 44%)`,
        backgroundSize: "6px 6px",
      }
    : { backgroundColor: mainColor };

  const textureChoices: Array<{ id: InkTextureMode; label: string }> = selectedMix
    ? [
        { id: "tone25", label: "Light 25%" },
        { id: "halftone", label: "Classic 50%" },
        { id: "tone75", label: "Rich 75%" },
      ]
    : [
        { id: "solid", label: "Solid" },
        { id: "halftone", label: "Polka Dots" },
        { id: "tone25", label: "Fine Mist" },
      ];

  return (
    <section
      aria-labelledby="ink-pots-heading"
      className="rounded-2xl border-2 border-[var(--card-border)] bg-[var(--card-surface)] p-3.5 shadow-[0_3px_0_var(--card-shadow)]"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Droplet className="h-4 w-4 text-[#9e2a1f]" aria-hidden="true" />
          <h2 id="ink-pots-heading" className="text-xs font-extrabold uppercase tracking-wider text-stone-800">
            Riso Ink Pots
          </h2>
        </div>

        <span className="rounded-full bg-[#f5efe4] px-2 py-0.5 text-[10px] font-bold text-[#6b6359]">
          Spectra 6
        </span>
      </div>

      {/* Active Ink Pill */}
      <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-[var(--card-border)] bg-[#faf6ef] px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-4 w-4 shrink-0 rounded-md border border-stone-400/70 shadow-sm"
            style={activeChipStyle}
          />
          <span className="truncate text-xs font-extrabold text-stone-900">
            {selectedMix ? selectedMix.label : activePureName}
          </span>
        </div>
        <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold text-stone-600 border border-[var(--card-border)]">
          {selectedMix ? "Riso Mix" : inkTexture === "solid" ? "Pure Ink" : "Halftone"}
        </span>
      </div>

      {/* 6 Pure Ink Pots */}
      <div className="mb-3">
        <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-[#6b6359]">
          Pure Ink Pots (1–6)
        </p>
        <div role="group" aria-label="Pure Spectra 6 ink pots" className="grid grid-cols-6 gap-1.5">
          {SPECTRA_PALETTE.map((color, idx) => {
            const isSelected = !selectedMixId && mainColor === color.hex;
            return (
              <button
                key={color.name}
                type="button"
                aria-label={`${color.name} ink pot (Key ${idx + 1})`}
                title={`${color.name} (Key ${idx + 1})`}
                aria-pressed={isSelected}
                onClick={() => onSelectPureColor(color.hex)}
                className={`spring-pot relative h-8 w-full rounded-xl border-2 ${
                  isSelected
                    ? "border-[#25467a] ring-2 ring-[#25467a]/35 z-10 shadow-md"
                    : "border-stone-400/50 shadow-sm"
                }`}
                style={{ backgroundColor: color.hex }}
              >
                {isSelected && (
                  <span
                    className={`mx-auto block h-2 w-2 rounded-full ${
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
      </div>

      {/* 12 Riso Halftone Mix Swatches */}
      <div className="mb-3">
        <p className="mb-1.5 flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wide text-[#6b6359]">
          <Sparkles className="h-3 w-3 text-amber-600" aria-hidden="true" />
          <span>Riso Halftone Swatches</span>
        </p>
        <div
          role="group"
          aria-label="Riso optical halftone mixes"
          className="grid grid-cols-6 gap-1.5"
        >
          {OPTICAL_MIX_SWATCHES.map((sw) => {
            const isActiveMix = selectedMixId === sw.id;
            const bgPattern =
              sw.density === "tone25"
                ? `radial-gradient(${sw.primaryHex} 30%, ${sw.secondaryHex} 32%)`
                : sw.density === "tone75"
                ? `radial-gradient(${sw.secondaryHex} 30%, ${sw.primaryHex} 32%)`
                : `repeating-conic-gradient(${sw.primaryHex} 0% 25%, ${sw.secondaryHex} 0% 50%)`;

            return (
              <button
                key={sw.id}
                type="button"
                aria-label={sw.label}
                title={sw.label}
                aria-pressed={isActiveMix}
                onClick={() => onSelectOpticalMix(sw)}
                className={`spring-pot h-7 w-full rounded-lg border-2 ${
                  isActiveMix
                    ? "border-[#25467a] ring-2 ring-[#25467a]/35 z-10 shadow-md"
                    : "border-stone-400/50 shadow-sm"
                }`}
                style={{
                  backgroundImage: bgPattern,
                  backgroundSize: "6px 6px",
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Simple 3-Way Texture Pill */}
      <div>
        <div
          role="group"
          aria-label="Ink texture"
          className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--card-border)] bg-[#f5efe4] p-1"
        >
          {textureChoices.map((choice) => {
            const pressed = inkTexture === choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                aria-pressed={pressed}
                onClick={() => onChangeInkTexture(choice.id)}
                className={`rounded-lg py-1.5 text-[11px] font-bold transition ${
                  pressed
                    ? "bg-[#25467a] text-white shadow-sm"
                    : "text-stone-700 hover:bg-white/80"
                }`}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
