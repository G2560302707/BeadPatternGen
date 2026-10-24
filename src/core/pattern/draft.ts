/**
 * S06 · 图纸草稿。
 *
 * 图片裁剪完成后，把 source.crop（源图像素坐标）与原始尺寸写进真实的 BeadPattern，
 * 此时 cells 全部为 EMPTY_CELL（-1），等待 S07+ 的色卡匹配结果填充。
 * 这样 S06 无需提前做颜色量化，也能保证裁剪信息沿正式数据模型传递。
 */

import { PatternError } from "./errors";
import { computePaletteHash } from "./hash";
import { EMPTY_CELL, SCHEMA_VERSION_V1 } from "./limits";
import type { BeadColor, BeadPattern, GenerationSettings, ImageMode, PatternSource } from "./types";
import { validatePattern } from "./validate";

export interface DraftPatternInput {
  id: string;
  title: string;
  width: number;
  height: number;
  palette: BeadColor[];
  mode: ImageMode;
  paletteId: string;
  paletteVersion: string;
  settings: GenerationSettings;
  source: PatternSource;
  /** 测试注入；生产环境默认使用当前时间。 */
  now?: string;
}

function validateSource(source: PatternSource): void {
  if (
    !Number.isInteger(source.originalWidth) ||
    !Number.isInteger(source.originalHeight) ||
    source.originalWidth < 1 ||
    source.originalHeight < 1
  ) {
    throw new PatternError(
      "E_INVALID_SETTINGS",
      `source.originalWidth/Height must be positive integers; got ${source.originalWidth}×${source.originalHeight}`,
    );
  }
  if (!Number.isFinite(source.aspectRatio) || source.aspectRatio <= 0) {
    throw new PatternError(
      "E_INVALID_SETTINGS",
      `source.aspectRatio must be > 0; got ${String(source.aspectRatio)}`,
    );
  }
  if (source.crop === undefined) return;
  const { x, y, width, height } = source.crop;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    x < 0 ||
    y < 0 ||
    x + width > source.originalWidth ||
    y + height > source.originalHeight
  ) {
    throw new PatternError(
      "E_INVALID_SETTINGS",
      `source.crop must be a positive rect inside ${source.originalWidth}×${source.originalHeight}; got ${JSON.stringify(source.crop)}`,
    );
  }
}

export function createDraftPattern(input: DraftPatternInput): BeadPattern {
  validateSource(input.source);
  const now = input.now ?? new Date().toISOString();
  const cells = new Int16Array(input.width * input.height);
  cells.fill(EMPTY_CELL);

  const pattern: BeadPattern = {
    schemaVersion: SCHEMA_VERSION_V1,
    id: input.id,
    title: input.title,
    width: input.width,
    height: input.height,
    cells,
    palette: input.palette,
    mode: input.mode,
    paletteId: input.paletteId,
    paletteVersion: input.paletteVersion,
    paletteHash: computePaletteHash(input.palette),
    settings: input.settings,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };
  validatePattern(pattern);
  return pattern;
}
