import type { BeadColor } from "./types";

/**
 * Deterministic palette fingerprint (FNV-1a 32-bit hex).
 * Not cryptographic; used to detect fixture drift (spec 5.1 paletteHash).
 */
export function computePaletteHash(palette: readonly BeadColor[]): string {
  let hash = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i += 1) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  for (const color of palette) {
    feed(color.code);
    feed("\u001f");
    feed(color.hex);
    feed("\u001e");
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
