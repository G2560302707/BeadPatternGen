import { decodeProject, encodeProject } from "../core/pattern";
import type { BeadPattern } from "../core/pattern";
import { assertExportReady } from "./assert";

export function exportProjectJson(pattern: BeadPattern): string {
  assertExportReady(pattern);
  return `${JSON.stringify(encodeProject(pattern), null, 2)}\n`;
}

export function parseProjectJson(raw: string | unknown): BeadPattern {
  return decodeProject(raw);
}
