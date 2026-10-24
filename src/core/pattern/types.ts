export type ImageMode = "photo" | "anime" | "logo" | "landscape";
export type DitheringMode = "none" | "floyd-steinberg";
export type ColorMetricName = "ciede2000" | "oklab";
export type TransparentPolicy = "empty" | "background";

/** Spec 5.1 BeadColor */
export interface BeadColor {
  code: string;
  name: string;
  hex: string;
  manufacturer: string;
  series?: string;
}

export interface GenerationSettings {
  maxColors: number;
  dithering: DitheringMode;
  colorMetric: ColorMetricName;
  transparentPolicy: TransparentPolicy;
  backgroundHex?: string;
}

export interface PatternSource {
  originalWidth: number;
  originalHeight: number;
  aspectRatio: number;
  crop?: { x: number; y: number; width: number; height: number };
}

/** Spec 5.1 BeadPattern — field names must not be renamed. */
export interface BeadPattern {
  schemaVersion: "1.0";
  id: string;
  title: string;
  width: number;
  height: number;
  cells: Int16Array;
  palette: BeadColor[];
  mode: ImageMode;
  paletteId: string;
  paletteVersion: string;
  paletteHash?: string;
  settings: GenerationSettings;
  source: PatternSource;
  createdAt: string;
  updatedAt: string;
}

/** Fixture + runtime palette wrapper (S01 JSON + manufacturer on each color). */
export interface PaletteDefinition {
  paletteId: string;
  brand: string;
  series: string;
  version: string;
  sourceUrl: string;
  license: string;
  fetchedAt: string;
  colors: BeadColor[];
}

export type QualityDiagnosticCode =
  "thin-line" | "isolated-bead" | "fragment" | "high-delta-e" | "low-resolution";

export interface QualityDiagnostic {
  code: QualityDiagnosticCode;
  message: string;
  cellIndices?: number[];
  count?: number;
}

export interface ColorUsageStat {
  code: string;
  name: string;
  hex: string;
  count: number;
  percentage: number;
}

export interface PatternStats {
  beadCount: number;
  colorCount: number;
  byColor: ColorUsageStat[];
}

export interface ProjectJsonV1 {
  schemaVersion: "1.0";
  id: string;
  title: string;
  width: number;
  height: number;
  cells: number[];
  palette: BeadColor[];
  mode: ImageMode;
  paletteId: string;
  paletteVersion: string;
  paletteHash?: string;
  settings: GenerationSettings;
  source: PatternSource;
  createdAt: string;
  updatedAt: string;
}
