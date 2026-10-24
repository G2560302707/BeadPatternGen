/**
 * S11 · C3 构图几何（纯函数）。
 *
 * 坐标与单位约定（与 C1 `CompositionParams` 一致）：
 * - `subjectScale`：主体最长边占"画布内容区"（画布减去 margin）短边的比例；
 * - `offsetX` / `offsetY`：主体中心相对画布中心的偏移，单位 = 画布宽 / 高；
 * - `margin`：画布内容区四边内缩量，单位 = `min(画布宽, 画布高)`。
 *
 * 超界策略：几何上永远不会输出越界的主体矩形——
 * 先把主体中心按 offset 放好，再把矩形夹紧到内容区内；如果发生夹紧，
 * `adjusted = true` 并返回一组可写回参数面板的 `suggestion`。
 * 这样 UI 拖动到画布外时不会产生非法预览，同时用户知道值被修正成了多少。
 */

import { isBBox, isCompositionParams } from "../subject";
import type { BBox, CompositionParams } from "../subject";
import { COMPOSITION_ALGORITHM_VERSION, CompositionError } from "./types";
import type {
  CompositionOverflow,
  CompositionPlan,
  CompositionRect,
  CompositionSuggestion,
} from "./types";

/** 浮点比较容差；避免 0.1 + 0.2 之类误差把 `adjusted` 误判为 true。 */
const EPSILON = 1e-9;

function invalidSource(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new CompositionError(
      "E_SOURCE_INVALID",
      `source width/height must be positive integers; got ${String(width)}×${String(height)}`,
    );
  }
}

function validateBBox(bbox: BBox, sourceWidth: number, sourceHeight: number): void {
  if (!isBBox(bbox)) {
    throw new CompositionError("E_BBOX_INVALID", `invalid bbox: ${JSON.stringify(bbox)}`);
  }
  if (
    bbox.x < 0 ||
    bbox.y < 0 ||
    bbox.x + bbox.width > sourceWidth ||
    bbox.y + bbox.height > sourceHeight
  ) {
    throw new CompositionError(
      "E_BBOX_INVALID",
      `bbox ${JSON.stringify(bbox)} exceeds source ${sourceWidth}×${sourceHeight}`,
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeZero(value: number): number {
  return Math.abs(value) < EPSILON ? 0 : value;
}

/**
 * 计算构图计划。不读像素，只做几何换算。
 *
 * @param sourceWidth  源图宽度（像素）
 * @param sourceHeight 源图高度（像素）
 * @param bbox         主体有效边界框（原图坐标系）
 * @param params       构图参数
 */
export function computeCompositionPlan(
  sourceWidth: number,
  sourceHeight: number,
  bbox: BBox,
  params: CompositionParams,
): CompositionPlan {
  invalidSource(sourceWidth, sourceHeight);
  validateBBox(bbox, sourceWidth, sourceHeight);
  if (!isCompositionParams(params)) {
    throw new CompositionError(
      "E_PARAMS_INVALID",
      `invalid composition params: ${JSON.stringify(params)}`,
    );
  }

  const { canvasWidth, canvasHeight } = params;
  const marginPx = Math.round(params.margin * Math.min(canvasWidth, canvasHeight));
  const contentWidth = canvasWidth - marginPx * 2;
  const contentHeight = canvasHeight - marginPx * 2;
  if (contentWidth <= 0 || contentHeight <= 0) {
    throw new CompositionError(
      "E_MARGIN_TOO_LARGE",
      `margin ${params.margin} leaves no content area in ${canvasWidth}×${canvasHeight} canvas`,
    );
  }

  const contentRect: CompositionRect = {
    x: marginPx,
    y: marginPx,
    width: contentWidth,
    height: contentHeight,
  };

  // 主体最长边对齐内容区短边的百分比；这样无论画布是横版还是竖版都不会溢出。
  const targetLongest = params.subjectScale * Math.min(contentWidth, contentHeight);
  const longest = Math.max(bbox.width, bbox.height);
  const scale = targetLongest / longest;
  const subjectWidth = bbox.width * scale;
  const subjectHeight = bbox.height * scale;

  const desiredCenterX = canvasWidth / 2 + params.offsetX * canvasWidth;
  const desiredCenterY = canvasHeight / 2 + params.offsetY * canvasHeight;
  const desiredRect: CompositionRect = {
    x: desiredCenterX - subjectWidth / 2,
    y: desiredCenterY - subjectHeight / 2,
    width: subjectWidth,
    height: subjectHeight,
  };

  // 夹紧到内容区：保证主体完整位于画布内，且四周至少留出 margin。
  const x = clamp(desiredRect.x, contentRect.x, contentRect.x + contentRect.width - subjectWidth);
  const y = clamp(desiredRect.y, contentRect.y, contentRect.y + contentRect.height - subjectHeight);
  const subjectRect: CompositionRect = { x, y, width: subjectWidth, height: subjectHeight };

  const adjusted =
    Math.abs(subjectRect.x - desiredRect.x) > EPSILON ||
    Math.abs(subjectRect.y - desiredRect.y) > EPSILON;

  const suggestion: CompositionSuggestion = {
    offsetX: normalizeZero(
      clamp((subjectRect.x + subjectWidth / 2 - canvasWidth / 2) / canvasWidth, -1, 1),
    ),
    offsetY: normalizeZero(
      clamp((subjectRect.y + subjectHeight / 2 - canvasHeight / 2) / canvasHeight, -1, 1),
    ),
  };

  const overflow: CompositionOverflow = {
    left: normalizeZero(Math.max(0, -desiredRect.x)),
    top: normalizeZero(Math.max(0, -desiredRect.y)),
    right: normalizeZero(Math.max(0, desiredRect.x + desiredRect.width - canvasWidth)),
    bottom: normalizeZero(Math.max(0, desiredRect.y + desiredRect.height - canvasHeight)),
  };

  return {
    algorithmVersion: COMPOSITION_ALGORITHM_VERSION,
    canvasWidth,
    canvasHeight,
    contentRect,
    crop: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
    desiredRect,
    subjectRect,
    scale,
    adjusted,
    suggestion,
    overflow,
  };
}
