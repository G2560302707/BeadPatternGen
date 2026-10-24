/** 5×7 点阵，仅 ASCII（0-9 A-Z 与少量符号）。中文跳过。 */

export const GLYPH_W = 5;
export const GLYPH_H = 7;
const GAP = 1;

const FONT: Record<string, readonly number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  "3": [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  "(": [0b00100, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b00100],
  ")": [0b00100, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b00100],
  x: [0b00000, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b00000],
  "-": [0, 0, 0, 0b01110, 0, 0, 0],
  "/": [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
};

export function asciiForBitmap(text: string): string {
  return [...text]
    .map((ch) => {
      if (ch === "x") return "x";
      const upper = ch.toUpperCase();
      if (FONT[ch] || FONT[upper]) return FONT[ch] ? ch : upper;
      if (ch === " ") return " ";
      return "";
    })
    .join("");
}

export function bitmapTextWidth(text: string, scale = 1): number {
  const printable = asciiForBitmap(text);
  if (printable.length === 0) return 0;
  return printable.length * (GLYPH_W + GAP) * scale - GAP * scale;
}

export function forEachBitmapPixel(
  text: string,
  originX: number,
  originY: number,
  scale: number,
  plot: (x: number, y: number) => void,
): void {
  const printable = asciiForBitmap(text);
  let cursor = originX;
  for (const ch of printable) {
    const glyph = FONT[ch] ?? FONT[ch.toUpperCase()];
    if (!glyph) {
      cursor += (GLYPH_W + GAP) * scale;
      continue;
    }
    for (let row = 0; row < GLYPH_H; row += 1) {
      const bits = glyph[row] ?? 0;
      for (let col = 0; col < GLYPH_W; col += 1) {
        if ((bits & (1 << (GLYPH_W - 1 - col))) === 0) continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            plot(cursor + col * scale + dx, originY + row * scale + dy);
          }
        }
      }
    }
    cursor += (GLYPH_W + GAP) * scale;
  }
}
