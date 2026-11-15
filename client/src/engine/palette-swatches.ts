import type { ColorOption, OpticalMixSwatch } from "../types";
import { SPECTRA_PERCEIVED_COLORS, findNearestPerceivedColorIndex } from "./dither";

export const SPECTRA_PALETTE: ColorOption[] = [
  { name: "Ink Black", hex: "#1e1e1e" },
  { name: "Paper White", hex: "#e8e4d9", isWhite: true },
  { name: "Crimson Red", hex: "#9e2a1f" },
  { name: "Sunbeam Yellow", hex: "#d9b82c" },
  { name: "Forest Green", hex: "#2d6a3e" },
  { name: "Cobalt Blue", hex: "#25467a" },
];

/**
 * 12 curated 2-pigment optical halftone mixes using strictly native Spectra 6 hexes.
 * Foreground strokes/fills painted with these mixes remain 100% crisp without dithering blur.
 */
export const OPTICAL_MIX_SWATCHES: OpticalMixSwatch[] = [
  {
    id: "warm-gray",
    label: "Warm Gray (50%)",
    primaryHex: "#1e1e1e",
    secondaryHex: "#e8e4d9",
    density: "halftone",
  },
  {
    id: "silver-mist",
    label: "Silver Mist (25%)",
    primaryHex: "#1e1e1e",
    secondaryHex: "#e8e4d9",
    density: "tone25",
  },
  {
    id: "charcoal",
    label: "Charcoal (75%)",
    primaryHex: "#1e1e1e",
    secondaryHex: "#e8e4d9",
    density: "tone75",
  },
  {
    id: "sunset-orange",
    label: "Sunset Orange",
    primaryHex: "#9e2a1f",
    secondaryHex: "#d9b82c",
    density: "halftone",
  },
  {
    id: "coral-pink",
    label: "Coral Pink",
    primaryHex: "#9e2a1f",
    secondaryHex: "#e8e4d9",
    density: "halftone",
  },
  {
    id: "cream-glow",
    label: "Cream Glow",
    primaryHex: "#d9b82c",
    secondaryHex: "#e8e4d9",
    density: "halftone",
  },
  {
    id: "sky-blue",
    label: "Sky Blue",
    primaryHex: "#25467a",
    secondaryHex: "#e8e4d9",
    density: "halftone",
  },
  {
    id: "plum-violet",
    label: "Plum Violet",
    primaryHex: "#9e2a1f",
    secondaryHex: "#25467a",
    density: "halftone",
  },
  {
    id: "mint-leaf",
    label: "Mint Leaf",
    primaryHex: "#2d6a3e",
    secondaryHex: "#e8e4d9",
    density: "halftone",
  },
  {
    id: "spring-lime",
    label: "Spring Lime",
    primaryHex: "#2d6a3e",
    secondaryHex: "#d9b82c",
    density: "halftone",
  },
  {
    id: "deep-teal",
    label: "Deep Teal",
    primaryHex: "#25467a",
    secondaryHex: "#2d6a3e",
    density: "halftone",
  },
  {
    id: "rust-umber",
    label: "Rust Umber",
    primaryHex: "#9e2a1f",
    secondaryHex: "#1e1e1e",
    density: "halftone",
  },
];

export function hexToRgba(hex: string): [number, number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b, 255];
}

/**
 * Maps any sampled RGB pixel to the closest native Spectra 6 perceived hex color.
 */
export function sampleSpectraColorHex(r: number, g: number, b: number): string {
  const idx = findNearestPerceivedColorIndex(r, g, b);
  return SPECTRA_PERCEIVED_COLORS[idx]?.hex ?? "#1e1e1e";
}
