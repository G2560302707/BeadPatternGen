import { PatternError } from "./errors";
import { computePaletteHash } from "./hash";
import { SCHEMA_VERSION_V1 } from "./limits";
import type { BeadPattern, ProjectJsonV1 } from "./types";
import { validatePattern } from "./validate";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new PatternError("E_INVALID_JSON", `field ${key} must be a string`);
  }
  return value;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PatternError("E_INVALID_JSON", `field ${key} must be a finite number`);
  }
  return value;
}

function parseSettings(raw: unknown): BeadPattern["settings"] {
  if (!isRecord(raw)) {
    throw new PatternError("E_INVALID_JSON", "settings must be an object");
  }
  const settings: BeadPattern["settings"] = {
    maxColors: requireNumber(raw, "maxColors"),
    dithering: requireString(raw, "dithering") as BeadPattern["settings"]["dithering"],
    colorMetric: requireString(raw, "colorMetric") as BeadPattern["settings"]["colorMetric"],
    transparentPolicy: requireString(
      raw,
      "transparentPolicy",
    ) as BeadPattern["settings"]["transparentPolicy"],
  };
  if (typeof raw.backgroundHex === "string") {
    settings.backgroundHex = raw.backgroundHex;
  }
  return settings;
}

function parseSource(raw: unknown): BeadPattern["source"] {
  if (!isRecord(raw)) {
    throw new PatternError("E_INVALID_JSON", "source must be an object");
  }
  const source: BeadPattern["source"] = {
    originalWidth: requireNumber(raw, "originalWidth"),
    originalHeight: requireNumber(raw, "originalHeight"),
    aspectRatio: requireNumber(raw, "aspectRatio"),
  };
  if (isRecord(raw.crop)) {
    source.crop = {
      x: requireNumber(raw.crop, "x"),
      y: requireNumber(raw.crop, "y"),
      width: requireNumber(raw.crop, "width"),
      height: requireNumber(raw.crop, "height"),
    };
  }
  return source;
}

/**
 * Version hook. 1.0 → 1.0 is identity.
 * Later schema versions must branch here instead of silently dropping fields.
 */
export function migrate(raw: unknown, fromVersion: string): unknown {
  if (fromVersion === SCHEMA_VERSION_V1) {
    return raw;
  }
  throw new PatternError("E_UNKNOWN_SCHEMA", `no migration from schemaVersion ${fromVersion}`);
}

export function encodeProject(pattern: BeadPattern): ProjectJsonV1 {
  validatePattern(pattern);
  const cells = Array.from(pattern.cells, (n) => n);
  const paletteHash = pattern.paletteHash ?? computePaletteHash(pattern.palette);
  const json: ProjectJsonV1 = {
    schemaVersion: SCHEMA_VERSION_V1,
    id: pattern.id,
    title: pattern.title,
    width: pattern.width,
    height: pattern.height,
    cells,
    palette: pattern.palette,
    mode: pattern.mode,
    paletteId: pattern.paletteId,
    paletteVersion: pattern.paletteVersion,
    paletteHash,
    settings: pattern.settings,
    source: pattern.source,
    createdAt: pattern.createdAt,
    updatedAt: pattern.updatedAt,
  };
  return json;
}

export function decodeProject(raw: unknown): BeadPattern {
  if (typeof raw === "string") {
    try {
      return decodeProject(JSON.parse(raw) as unknown);
    } catch (err) {
      if (err instanceof PatternError) {
        throw err;
      }
      throw new PatternError("E_INVALID_JSON", "project JSON parse failed");
    }
  }
  if (!isRecord(raw)) {
    throw new PatternError("E_INVALID_JSON", "project root must be an object");
  }
  if (!("schemaVersion" in raw) || typeof raw.schemaVersion !== "string") {
    throw new PatternError("E_UNKNOWN_SCHEMA", "schemaVersion missing");
  }
  const migrated = migrate(raw, raw.schemaVersion);
  if (!isRecord(migrated)) {
    throw new PatternError("E_INVALID_JSON", "migrated project is not an object");
  }
  if (migrated.schemaVersion !== SCHEMA_VERSION_V1) {
    throw new PatternError(
      "E_UNKNOWN_SCHEMA",
      `unsupported schemaVersion ${String(migrated.schemaVersion)}`,
    );
  }
  if (!Array.isArray(migrated.cells) || !migrated.cells.every((n) => typeof n === "number")) {
    throw new PatternError(
      "E_INVALID_JSON",
      "cells must be a number[] (not Int16Array JSON object)",
    );
  }
  if (!Array.isArray(migrated.palette)) {
    throw new PatternError("E_INVALID_JSON", "palette must be an array");
  }
  if (!isRecord(migrated.settings) || !isRecord(migrated.source)) {
    throw new PatternError("E_INVALID_JSON", "settings and source must be objects");
  }
  const pattern: BeadPattern = {
    schemaVersion: SCHEMA_VERSION_V1,
    id: requireString(migrated, "id"),
    title: requireString(migrated, "title"),
    width: requireNumber(migrated, "width"),
    height: requireNumber(migrated, "height"),
    cells: Int16Array.from(migrated.cells),
    palette: migrated.palette as BeadPattern["palette"],
    mode: migrated.mode as BeadPattern["mode"],
    paletteId: requireString(migrated, "paletteId"),
    paletteVersion: requireString(migrated, "paletteVersion"),
    settings: parseSettings(migrated.settings),
    source: parseSource(migrated.source),
    createdAt: requireString(migrated, "createdAt"),
    updatedAt: requireString(migrated, "updatedAt"),
  };
  if (typeof migrated.paletteHash === "string") {
    pattern.paletteHash = migrated.paletteHash;
  }
  validatePattern(pattern);
  return pattern;
}
