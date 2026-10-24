import { PatternError } from "./errors";
import {
  EMPTY_CELL,
  MAX_CELL_COUNT,
  MAX_GRID_HEIGHT,
  MAX_GRID_WIDTH,
  MIN_GRID_SIZE,
  SCHEMA_VERSION_V1,
} from "./limits";
import type { BeadColor, BeadPattern, GenerationSettings } from "./types";

const HEX_RE = /^#[0-9A-F]{6}$/;
const IMAGE_MODES = new Set(["photo", "anime", "logo", "landscape"]);
const DITHERING = new Set(["none", "floyd-steinberg"]);
const METRICS = new Set(["ciede2000", "oklab"]);
const TRANSPARENCY = new Set(["empty", "background"]);

export function validateHex(hex: string, label: string): void {
  if (!HEX_RE.test(hex)) {
    throw new PatternError("E_INVALID_HEX", `${label} hex must be uppercase #RRGGBB, got ${hex}`);
  }
}

export function validatePaletteColors(palette: readonly BeadColor[]): void {
  const codes = new Map<string, number>();
  const hexes = new Map<string, number>();
  palette.forEach((color, index) => {
    if (color.code.trim() === "") {
      throw new PatternError("E_EMPTY_FIELD", `palette[${index}].code is empty`);
    }
    if (color.name.trim() === "") {
      throw new PatternError("E_EMPTY_FIELD", `palette[${index}].name is empty`);
    }
    if (color.manufacturer.trim() === "") {
      throw new PatternError("E_EMPTY_FIELD", `palette[${index}].manufacturer is empty`);
    }
    validateHex(color.hex, `palette[${index}]`);
    const prevCode = codes.get(color.code);
    if (prevCode !== undefined) {
      throw new PatternError(
        "E_DUP_CODE",
        `duplicate palette code ${color.code} at ${index} and ${prevCode}`,
      );
    }
    codes.set(color.code, index);
    const prevHex = hexes.get(color.hex);
    if (prevHex !== undefined) {
      throw new PatternError(
        "E_DUP_HEX",
        `duplicate palette hex ${color.hex} at ${index} and ${prevHex}`,
      );
    }
    hexes.set(color.hex, index);
  });
}

export function validateDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new PatternError("E_NON_POSITIVE_DIMENSION", "width and height must be integers");
  }
  if (width < MIN_GRID_SIZE || height < MIN_GRID_SIZE) {
    throw new PatternError(
      "E_NON_POSITIVE_DIMENSION",
      `width and height must be >= ${MIN_GRID_SIZE} (got ${width}×${height})`,
    );
  }
  if (width > MAX_GRID_WIDTH || height > MAX_GRID_HEIGHT || width * height > MAX_CELL_COUNT) {
    throw new PatternError(
      "E_DIMENSION_LIMIT",
      `grid ${width}×${height} exceeds ${MAX_GRID_WIDTH}×${MAX_GRID_HEIGHT} or ${MAX_CELL_COUNT} cells`,
    );
  }
}

export function validateSettings(settings: GenerationSettings): void {
  if (!Number.isInteger(settings.maxColors) || settings.maxColors < 1) {
    throw new PatternError("E_INVALID_SETTINGS", "maxColors must be an integer >= 1");
  }
  if (!DITHERING.has(settings.dithering)) {
    throw new PatternError("E_INVALID_SETTINGS", `unknown dithering ${settings.dithering}`);
  }
  if (!METRICS.has(settings.colorMetric)) {
    throw new PatternError("E_INVALID_SETTINGS", `unknown colorMetric ${settings.colorMetric}`);
  }
  if (!TRANSPARENCY.has(settings.transparentPolicy)) {
    throw new PatternError(
      "E_INVALID_SETTINGS",
      `unknown transparentPolicy ${settings.transparentPolicy}`,
    );
  }
  if (settings.transparentPolicy === "background") {
    if (settings.backgroundHex === undefined) {
      throw new PatternError(
        "E_INVALID_SETTINGS",
        "backgroundHex required when policy is background",
      );
    }
    validateHex(settings.backgroundHex, "settings.backgroundHex");
  }
}

export function validatePattern(pattern: BeadPattern): void {
  if (pattern.schemaVersion !== SCHEMA_VERSION_V1) {
    throw new PatternError(
      "E_UNKNOWN_SCHEMA",
      `unsupported schemaVersion ${pattern.schemaVersion}`,
    );
  }
  if (pattern.id.trim() === "" || pattern.title.trim() === "") {
    throw new PatternError("E_EMPTY_FIELD", "id and title must be non-empty");
  }
  if (pattern.paletteId.trim() === "" || pattern.paletteVersion.trim() === "") {
    throw new PatternError("E_PALETTE_REF", "paletteId and paletteVersion must be non-empty");
  }
  if (!IMAGE_MODES.has(pattern.mode)) {
    throw new PatternError("E_INVALID_SETTINGS", `unknown mode ${pattern.mode}`);
  }
  validateDimensions(pattern.width, pattern.height);
  validateSettings(pattern.settings);
  validatePaletteColors(pattern.palette);
  if (pattern.settings.maxColors < 1) {
    throw new PatternError("E_INVALID_SETTINGS", "maxColors must be >= 1");
  }
  if (pattern.cells.length !== pattern.width * pattern.height) {
    throw new PatternError(
      "E_CELLS_LENGTH",
      `cells.length ${pattern.cells.length} !== width*height ${pattern.width * pattern.height}`,
    );
  }
  const paletteLen = pattern.palette.length;
  for (let i = 0; i < pattern.cells.length; i += 1) {
    const value = pattern.cells[i];
    if (value === undefined) {
      throw new PatternError("E_INDEX_OUT_OF_RANGE", `missing cell at ${i}`);
    }
    if (value === EMPTY_CELL) {
      continue;
    }
    if (!Number.isInteger(value) || value < 0 || value >= paletteLen) {
      throw new PatternError(
        "E_INDEX_OUT_OF_RANGE",
        `cell[${i}]=${value} is not -1 or in [0, ${paletteLen})`,
      );
    }
  }
}
