/**
 * S06 · 图片头校验公共出口（纯函数）。
 */

export type { ImageImportErrorCode } from "./errors";
export { ImageImportError } from "./errors";
export type { ImageDimensions, ImageFormat } from "./validate";
export {
  FORMAT_LABEL,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGE_PIXELS,
  MIN_IMAGE_DIMENSION,
  assertFileSize,
  assertImageDimensions,
  detectImageFormat,
  exifOrientationSwapsDimensions,
  readImageDimensionsFromHeader,
  readJpegExifOrientation,
  requireImageFormat,
} from "./validate";
