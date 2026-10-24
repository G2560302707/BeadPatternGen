/**
 * #RGB / #RRGGBB 与 8 位 RGB 的互转。
 *
 * 输入域策略见 types.ts：非法格式一律抛 RangeError，不做静默截断或容错。
 * - 必须带前导 "#"；
 * - 只接受 3 位或 6 位十六进制数字（0-9、a-f、A-F）；
 * - 不接受空白、0x 前缀、4/5/7/8 位写法。
 *
 * 输出统一为大写 "#RRGGBB"。
 */

import { assertRgb } from "./types";
import type { RGB } from "./types";

/** 十六进制基数。 */
const HEX_RADIX = 16;

/** 每个输出通道固定两位。 */
const HEX_BYTE_WIDTH = 2;

/** 短写格式：恰好 3 位十六进制数字，必须带 #。 */
const HEX_SHORT_PATTERN = /^#[0-9a-fA-F]{3}$/;

/** 长写格式：恰好 6 位十六进制数字，必须带 #。 */
const HEX_LONG_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** 把 0–255 整数格式化为两位大写十六进制。 */
function toHexByte(value: number): string {
  return value.toString(HEX_RADIX).toUpperCase().padStart(HEX_BYTE_WIDTH, "0");
}

/**
 * "#abc" / "#AABBCC"（大小写不敏感）→ RGB。
 * 格式非法时抛 RangeError，消息中回显原输入。
 */
export function hexToRgb(hex: string): RGB {
  if (typeof hex !== "string") {
    throw new RangeError(`hexToRgb input must be a string; received ${String(hex)}`);
  }

  let body: string;
  if (HEX_SHORT_PATTERN.test(hex)) {
    // 逐位复制："abc" → "aabbcc"。只用 slice，不依赖索引访问的可空性。
    const r = hex.slice(1, 2);
    const g = hex.slice(2, 3);
    const b = hex.slice(3, 4);
    body = r + r + g + g + b + b;
  } else if (HEX_LONG_PATTERN.test(hex)) {
    body = hex.slice(1);
  } else {
    throw new RangeError(
      `hexToRgb expected "#RGB" or "#RRGGBB" with 0-9/a-f/A-F digits; received "${hex}"`,
    );
  }

  return {
    r: parseInt(body.slice(0, 2), HEX_RADIX),
    g: parseInt(body.slice(2, 4), HEX_RADIX),
    b: parseInt(body.slice(4, 6), HEX_RADIX),
  };
}

/**
 * RGB → 大写 "#RRGGBB"。
 * 通道允许小数（0–255），先 Math.round 再格式化；
 * 输入非有限或越界时抛 RangeError。
 */
export function rgbToHex(rgb: RGB): string {
  assertRgb(rgb);

  return `#${toHexByte(Math.round(rgb.r))}${toHexByte(Math.round(rgb.g))}${toHexByte(
    Math.round(rgb.b),
  )}`;
}
