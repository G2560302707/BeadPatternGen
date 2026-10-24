#!/usr/bin/env node
/**
 * Palette fixture validator (S01).
 * Exit 0 only when the JSON is structurally valid and internally unique.
 * Failures always exit with code 1; never swallow errors.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HEX_RE = /^#[0-9A-F]{6}$/;
const REQUIRED_ROOT = [
  "paletteId",
  "brand",
  "series",
  "version",
  "sourceUrl",
  "license",
  "fetchedAt",
  "colors",
];
const REQUIRED_COLOR = ["code", "name", "hex"];

function fail(message) {
  console.error(`validate-palette: FAIL: ${message}`);
  process.exit(1);
}

function requireNonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${path} must be a non-empty string`);
  }
}

const inputPath = process.argv[2];
if (!inputPath) {
  fail('usage: node scripts/validate-palette.mjs "<palette.json>"');
}

const absPath = resolve(inputPath);
let raw;
try {
  raw = readFileSync(absPath, "utf8");
} catch (err) {
  fail(`cannot read file ${absPath}: ${err instanceof Error ? err.message : String(err)}`);
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  fail(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
}

if (data === null || typeof data !== "object" || Array.isArray(data)) {
  fail("root must be a JSON object");
}

for (const key of REQUIRED_ROOT) {
  if (!(key in data)) {
    fail(`missing required field: ${key}`);
  }
}

requireNonEmptyString(data.paletteId, "paletteId");
requireNonEmptyString(data.brand, "brand");
requireNonEmptyString(data.series, "series");
requireNonEmptyString(data.version, "version");
requireNonEmptyString(data.sourceUrl, "sourceUrl");
requireNonEmptyString(data.license, "license");
requireNonEmptyString(data.fetchedAt, "fetchedAt");

if (!Array.isArray(data.colors) || data.colors.length === 0) {
  fail("colors must be a non-empty array");
}

const codes = new Map();
const hexes = new Map();

data.colors.forEach((color, index) => {
  const prefix = `colors[${index}]`;
  if (color === null || typeof color !== "object" || Array.isArray(color)) {
    fail(`${prefix} must be an object`);
  }
  for (const key of REQUIRED_COLOR) {
    if (!(key in color)) {
      fail(`${prefix} missing required field: ${key}`);
    }
  }
  requireNonEmptyString(color.code, `${prefix}.code`);
  requireNonEmptyString(color.name, `${prefix}.name`);
  requireNonEmptyString(color.hex, `${prefix}.hex`);
  if (!HEX_RE.test(color.hex)) {
    fail(`${prefix}.hex must be normalized uppercase #RRGGBB (got ${JSON.stringify(color.hex)})`);
  }
  if (codes.has(color.code)) {
    fail(`duplicate code ${JSON.stringify(color.code)} at ${prefix} and ${codes.get(color.code)}`);
  }
  codes.set(color.code, prefix);
  if (hexes.has(color.hex)) {
    fail(`duplicate hex ${color.hex} at ${prefix} and ${hexes.get(color.hex)}`);
  }
  hexes.set(color.hex, prefix);
});

console.log(
  `validate-palette: OK ${absPath} paletteId=${data.paletteId} version=${data.version} colors=${data.colors.length}`,
);
process.exit(0);
