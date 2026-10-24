import { describe, expect, it } from "vitest";
import {
  deltaE2000,
  deltaEOklab,
  hexToRgb,
  labToRgb,
  linearToSrgb,
  oklabToRgb,
  rgbToHex,
  rgbToLab,
  rgbToOklab,
  srgbToLinear,
} from "./index";
import type { Lab, Oklab, RGB } from "./index";

/** Sharma / Wu / Dalal (2005) 34 组标准测试对，期望值取自论文 Table 1（4 位小数）。 */
const SHARMA_PAIRS: ReadonlyArray<{
  readonly id: number;
  readonly lab1: Lab;
  readonly lab2: Lab;
  readonly expected: number;
}> = [
  {
    id: 1,
    lab1: { L: 50, a: 2.6772, b: -79.7751 },
    lab2: { L: 50, a: 0, b: -82.7485 },
    expected: 2.0425,
  },
  {
    id: 2,
    lab1: { L: 50, a: 3.1571, b: -77.2803 },
    lab2: { L: 50, a: 0, b: -82.7485 },
    expected: 2.8615,
  },
  {
    id: 3,
    lab1: { L: 50, a: 2.8361, b: -74.02 },
    lab2: { L: 50, a: 0, b: -82.7485 },
    expected: 3.4412,
  },
  {
    id: 4,
    lab1: { L: 50, a: -1.3802, b: -84.2814 },
    lab2: { L: 50, a: 0, b: -82.7485 },
    expected: 1.0,
  },
  {
    id: 5,
    lab1: { L: 50, a: -1.1848, b: -84.8006 },
    lab2: { L: 50, a: 0, b: -82.7485 },
    expected: 1.0,
  },
  {
    id: 6,
    lab1: { L: 50, a: -0.9009, b: -85.5211 },
    lab2: { L: 50, a: 0, b: -82.7485 },
    expected: 1.0,
  },
  { id: 7, lab1: { L: 50, a: 0, b: 0 }, lab2: { L: 50, a: -1, b: 2 }, expected: 2.3669 },
  { id: 8, lab1: { L: 50, a: -1, b: 2 }, lab2: { L: 50, a: 0, b: 0 }, expected: 2.3669 },
  {
    id: 9,
    lab1: { L: 50, a: 2.49, b: -0.001 },
    lab2: { L: 50, a: -2.49, b: 0.0009 },
    expected: 7.1792,
  },
  {
    id: 10,
    lab1: { L: 50, a: 2.49, b: -0.001 },
    lab2: { L: 50, a: -2.49, b: 0.001 },
    expected: 7.1792,
  },
  {
    id: 11,
    lab1: { L: 50, a: 2.49, b: -0.001 },
    lab2: { L: 50, a: -2.49, b: 0.0011 },
    expected: 7.2195,
  },
  {
    id: 12,
    lab1: { L: 50, a: 2.49, b: -0.001 },
    lab2: { L: 50, a: -2.49, b: 0.0012 },
    expected: 7.2195,
  },
  {
    id: 13,
    lab1: { L: 50, a: -0.001, b: 2.49 },
    lab2: { L: 50, a: 0.0009, b: -2.49 },
    expected: 4.8045,
  },
  {
    id: 14,
    lab1: { L: 50, a: -0.001, b: 2.49 },
    lab2: { L: 50, a: 0.001, b: -2.49 },
    expected: 4.8045,
  },
  {
    id: 15,
    lab1: { L: 50, a: -0.001, b: 2.49 },
    lab2: { L: 50, a: 0.0011, b: -2.49 },
    expected: 4.7461,
  },
  { id: 16, lab1: { L: 50, a: 2.5, b: 0 }, lab2: { L: 50, a: 0, b: -2.5 }, expected: 4.3065 },
  { id: 17, lab1: { L: 50, a: 2.5, b: 0 }, lab2: { L: 73, a: 25, b: -18 }, expected: 27.1492 },
  { id: 18, lab1: { L: 50, a: 2.5, b: 0 }, lab2: { L: 61, a: -5, b: 29 }, expected: 22.8977 },
  { id: 19, lab1: { L: 50, a: 2.5, b: 0 }, lab2: { L: 56, a: -27, b: -3 }, expected: 31.903 },
  { id: 20, lab1: { L: 50, a: 2.5, b: 0 }, lab2: { L: 58, a: 24, b: 15 }, expected: 19.4535 },
  { id: 21, lab1: { L: 50, a: 2.5, b: 0 }, lab2: { L: 50, a: 3.1736, b: 0.5854 }, expected: 1.0 },
  { id: 22, lab1: { L: 50, a: 2.5, b: 0 }, lab2: { L: 50, a: 3.2972, b: 0 }, expected: 1.0 },
  { id: 23, lab1: { L: 50, a: 2.5, b: 0 }, lab2: { L: 50, a: 1.8634, b: 0.5757 }, expected: 1.0 },
  { id: 24, lab1: { L: 50, a: 2.5, b: 0 }, lab2: { L: 50, a: 3.2592, b: 0.335 }, expected: 1.0 },
  {
    id: 25,
    lab1: { L: 60.2574, a: -34.0099, b: 36.2677 },
    lab2: { L: 60.4626, a: -34.1751, b: 39.4387 },
    expected: 1.2644,
  },
  {
    id: 26,
    lab1: { L: 63.0109, a: -31.0961, b: -5.8663 },
    lab2: { L: 62.8187, a: -29.7946, b: -4.0864 },
    expected: 1.263,
  },
  {
    id: 27,
    lab1: { L: 61.2901, a: 3.7196, b: -5.3901 },
    lab2: { L: 61.4292, a: 2.248, b: -4.962 },
    expected: 1.8731,
  },
  {
    id: 28,
    lab1: { L: 35.0831, a: -44.1164, b: 3.7933 },
    lab2: { L: 35.0232, a: -40.0716, b: 1.5901 },
    expected: 1.8645,
  },
  {
    id: 29,
    lab1: { L: 22.7233, a: 20.0904, b: -46.694 },
    lab2: { L: 23.0331, a: 14.973, b: -42.5619 },
    expected: 2.0373,
  },
  {
    id: 30,
    lab1: { L: 36.4612, a: 47.858, b: 18.3852 },
    lab2: { L: 36.2715, a: 50.5065, b: 21.2231 },
    expected: 1.4146,
  },
  {
    id: 31,
    lab1: { L: 90.8027, a: -2.0831, b: 1.441 },
    lab2: { L: 91.1528, a: -1.6435, b: 0.0447 },
    expected: 1.4441,
  },
  {
    id: 32,
    lab1: { L: 90.9257, a: -0.5406, b: -0.9208 },
    lab2: { L: 88.6381, a: -0.8985, b: -0.7239 },
    expected: 1.5381,
  },
  {
    id: 33,
    lab1: { L: 6.7747, a: -0.2908, b: -2.4247 },
    lab2: { L: 5.8714, a: -0.0985, b: -2.2286 },
    expected: 0.6377,
  },
  {
    id: 34,
    lab1: { L: 2.0776, a: 0.0795, b: -1.135 },
    lab2: { L: 0.9033, a: -0.0636, b: -0.5514 },
    expected: 0.9082,
  },
];

/** 往返测试用 9 色：6 个端点 / 灰阶 + 3 个固定中间色。 */
const ROUND_TRIP_COLORS: ReadonlyArray<{ readonly hex: string; readonly rgb: RGB }> = [
  { hex: "#000000", rgb: { r: 0, g: 0, b: 0 } },
  { hex: "#FFFFFF", rgb: { r: 255, g: 255, b: 255 } },
  { hex: "#808080", rgb: { r: 128, g: 128, b: 128 } },
  { hex: "#FF0000", rgb: { r: 255, g: 0, b: 0 } },
  { hex: "#00FF00", rgb: { r: 0, g: 255, b: 0 } },
  { hex: "#0000FF", rgb: { r: 0, g: 0, b: 255 } },
  { hex: "#123456", rgb: { r: 18, g: 52, b: 86 } },
  { hex: "#C0FFEE", rgb: { r: 192, g: 255, b: 238 } },
  { hex: "#7F3FBF", rgb: { r: 127, g: 63, b: 191 } },
];

function maxChannelError(a: RGB, b: RGB): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

function isChannelInteger(rgb: RGB): boolean {
  return Number.isInteger(rgb.r) && Number.isInteger(rgb.g) && Number.isInteger(rgb.b);
}

function isChannelInRange(rgb: RGB): boolean {
  return rgb.r >= 0 && rgb.r <= 255 && rgb.g >= 0 && rgb.g <= 255 && rgb.b >= 0 && rgb.b <= 255;
}

describe("srgb 传递函数", () => {
  it("端点精确：0 → 0，1 → 1", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBe(1);
    expect(linearToSrgb(0)).toBe(0);
    // 1.055·1 − 0.055 在二进制浮点下为 0.9999999999999999；仍属 [0,1]。
    expect(linearToSrgb(1)).toBeCloseTo(1, 12);
  });

  it("分段阈值两侧使用正确公式", () => {
    expect(srgbToLinear(0.04045)).toBe(0.04045 / 12.92);
    expect(srgbToLinear(0.0404500001)).toBeCloseTo(
      Math.pow((0.0404500001 + 0.055) / 1.055, 2.4),
      15,
    );
    expect(linearToSrgb(0.0031308)).toBe(0.0031308 * 12.92);
    expect(linearToSrgb(0.0031308001)).toBeCloseTo(
      1.055 * Math.pow(0.0031308001, 1 / 2.4) - 0.055,
      15,
    );
  });

  it("0.5 编码值解码为 IEC 61966-2-1 的 0.21404114048223255", () => {
    expect(srgbToLinear(0.5)).toBeCloseTo(0.21404114048223255, 12);
  });

  it("解码 / 编码互为逆运算（0–1 网格，阈值处允许 1e-7 分段常数舍入差）", () => {
    // 0.04045/12.92 = 0.00313080495… 略大于线性域阈值 0.0031308，
    // 两个公开常数各自四舍五入，导致阈值点往返差约 2.96e-8；这是标准行为。
    const samples = [0, 0.001, 0.0031308, 0.04045, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
    for (const value of samples) {
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 6);
    }
  });

  it("输入越界 / 非有限数抛 RangeError", () => {
    expect(() => srgbToLinear(-0.0001)).toThrow(RangeError);
    expect(() => srgbToLinear(1.0001)).toThrow(RangeError);
    expect(() => srgbToLinear(Number.NaN)).toThrow(RangeError);
    expect(() => srgbToLinear(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => linearToSrgb(-0.0001)).toThrow(RangeError);
    expect(() => linearToSrgb(1.0001)).toThrow(RangeError);
    expect(() => linearToSrgb(Number.NaN)).toThrow(RangeError);
  });
});

describe("Lab 转换", () => {
  it("黑色 → L*=0, a*=0, b*=0", () => {
    const lab = rgbToLab({ r: 0, g: 0, b: 0 });
    expect(lab.L).toBeCloseTo(0, 12);
    expect(lab.a).toBeCloseTo(0, 12);
    expect(lab.b).toBeCloseTo(0, 12);
  });

  it("白色 → L*≈100，a*/b*≈0（矩阵系数截断带来的 1e-5 级偏差）", () => {
    const lab = rgbToLab({ r: 255, g: 255, b: 255 });
    expect(lab.L).toBeCloseTo(100, 4);
    expect(lab.a).toBeCloseTo(0, 4);
    expect(lab.b).toBeCloseTo(0, 4);
  });

  it("纯红 / 纯绿 / 纯蓝匹配 D65 公开参考值（±1e-3）", () => {
    const red = rgbToLab({ r: 255, g: 0, b: 0 });
    expect(red.L).toBeCloseTo(53.2408, 3);
    expect(red.a).toBeCloseTo(80.0925, 3);
    expect(red.b).toBeCloseTo(67.2032, 3);

    const green = rgbToLab({ r: 0, g: 255, b: 0 });
    expect(green.L).toBeCloseTo(87.7347, 3);
    expect(green.a).toBeCloseTo(-86.1827, 3);
    expect(green.b).toBeCloseTo(83.1793, 3);

    const blue = rgbToLab({ r: 0, g: 0, b: 255 });
    expect(blue.L).toBeCloseTo(32.297, 3);
    expect(blue.a).toBeCloseTo(79.1875, 3);
    expect(blue.b).toBeCloseTo(-107.8602, 3);
  });

  it("中灰 #808080 的 L* = 53.5850157717（±1e-9）", () => {
    expect(rgbToLab({ r: 128, g: 128, b: 128 }).L).toBeCloseTo(53.5850157717, 9);
  });

  it("labToRgb 输出为 0–255 整数", () => {
    const back = labToRgb(rgbToLab({ r: 18, g: 52, b: 86 }));
    expect(back).toEqual({ r: 18, g: 52, b: 86 });
  });

  it("超色域输入被 clamp 且输出仍为整数", () => {
    const back = labToRgb({ L: 50, a: 200, b: 200 });
    expect(isChannelInteger(back)).toBe(true);
    expect(isChannelInRange(back)).toBe(true);
    expect(back).toEqual({ r: 255, g: 0, b: 0 });
    expect(labToRgb({ L: 0, a: 0, b: 0 })).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("非法输入抛 RangeError", () => {
    expect(() => rgbToLab({ r: -1, g: 0, b: 0 })).toThrow(RangeError);
    expect(() => rgbToLab({ r: 256, g: 0, b: 0 })).toThrow(RangeError);
    expect(() => rgbToLab({ r: Number.NaN, g: 0, b: 0 })).toThrow(RangeError);
    expect(() => labToRgb({ L: Number.NaN, a: 0, b: 0 })).toThrow(RangeError);
    expect(() => labToRgb({ L: 50, a: Number.POSITIVE_INFINITY, b: 0 })).toThrow(RangeError);
  });
});

describe("Oklab 转换", () => {
  it("黑色 → (0, 0, 0)", () => {
    const ok = rgbToOklab({ r: 0, g: 0, b: 0 });
    expect(ok.L).toBeCloseTo(0, 12);
    expect(ok.a).toBeCloseTo(0, 12);
    expect(ok.b).toBeCloseTo(0, 12);
  });

  it("白色 → L≈1，a/b≈0", () => {
    const ok = rgbToOklab({ r: 255, g: 255, b: 255 });
    expect(ok.L).toBeCloseTo(0.9999999935, 9);
    expect(ok.a).toBeCloseTo(0, 9);
    expect(ok.b).toBeCloseTo(0, 7);
  });

  it("纯红 / 纯绿 / 纯蓝匹配 Ottosson (2020) 参考值（±1e-6）", () => {
    const red = rgbToOklab({ r: 255, g: 0, b: 0 });
    expect(red.L).toBeCloseTo(0.627955, 6);
    expect(red.a).toBeCloseTo(0.224863, 6);
    expect(red.b).toBeCloseTo(0.125846, 6);

    const green = rgbToOklab({ r: 0, g: 255, b: 0 });
    expect(green.L).toBeCloseTo(0.86644, 6);
    expect(green.a).toBeCloseTo(-0.233888, 6);
    expect(green.b).toBeCloseTo(0.179498, 6);

    const blue = rgbToOklab({ r: 0, g: 0, b: 255 });
    expect(blue.L).toBeCloseTo(0.452014, 6);
    expect(blue.a).toBeCloseTo(-0.032457, 6);
    expect(blue.b).toBeCloseTo(-0.311528, 6);
  });

  it("oklabToRgb 输出为 0–255 整数并能精确还原 8 位色", () => {
    for (const color of ROUND_TRIP_COLORS) {
      const back = oklabToRgb(rgbToOklab(color.rgb));
      expect(isChannelInteger(back)).toBe(true);
      expect(back).toEqual(color.rgb);
    }
  });

  it("超色域输入被 clamp 且输出仍为整数", () => {
    const back = oklabToRgb({ L: 1.5, a: 0.5, b: 0.5 });
    expect(isChannelInteger(back)).toBe(true);
    expect(isChannelInRange(back)).toBe(true);
    expect(back).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("非法输入抛 RangeError", () => {
    expect(() => rgbToOklab({ r: -1, g: 0, b: 0 })).toThrow(RangeError);
    expect(() => rgbToOklab({ r: 0, g: 256, b: 0 })).toThrow(RangeError);
    expect(() => rgbToOklab({ r: 0, g: 0, b: Number.NaN })).toThrow(RangeError);
    expect(() => oklabToRgb({ L: 0, a: Number.NaN, b: 0 })).toThrow(RangeError);
    expect(() => oklabToRgb({ L: 0, a: 0, b: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});

describe("hex 解析与格式化", () => {
  it("短写展开正确", () => {
    expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb("#ABC")).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("长写大小写不敏感", () => {
    expect(hexToRgb("#AABBCC")).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb("#aabbcc")).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb("#aAbBcC")).toEqual({ r: 170, g: 187, b: 204 });
  });

  it("rgbToHex 输出大写 #RRGGBB", () => {
    expect(rgbToHex({ r: 170, g: 187, b: 204 })).toBe("#AABBCC");
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe("#FFFFFF");
    expect(rgbToHex({ r: 1, g: 2, b: 15 })).toBe("#01020F");
  });

  it("rgbToHex 对小数通道先四舍五入", () => {
    expect(rgbToHex({ r: 254.6, g: 0.4, b: 127.5 })).toBe("#FF0080");
  });

  it("hexToRgb / rgbToHex 往返一致（9 个固定色）", () => {
    for (const color of ROUND_TRIP_COLORS) {
      expect(rgbToHex(hexToRgb(color.hex))).toBe(color.hex.toUpperCase());
    }
  });

  it("非法 hex 一律抛 RangeError", () => {
    const invalid = [
      "#GGG",
      "12ab",
      "",
      "#12ab",
      "#abcd",
      " #abc",
      "#abc ",
      "#AABBCCD",
      "abc",
      "0xAABBCC",
    ];
    for (const value of invalid) {
      expect(() => hexToRgb(value)).toThrow(RangeError);
    }
  });

  it("rgbToHex 越界 / 非有限输入抛 RangeError", () => {
    expect(() => rgbToHex({ r: -1, g: 0, b: 0 })).toThrow(RangeError);
    expect(() => rgbToHex({ r: 256, g: 0, b: 0 })).toThrow(RangeError);
    expect(() => rgbToHex({ r: 0, g: Number.NaN, b: 0 })).toThrow(RangeError);
  });
});

describe("CIEDE2000", () => {
  it("34 组 Sharma / Wu / Dalal (2005) 标准对的绝对误差均 ≤ 1e-4", () => {
    for (const pair of SHARMA_PAIRS) {
      const actual = deltaE2000(pair.lab1, pair.lab2);
      const error = Math.abs(actual - pair.expected);
      expect(
        error,
        `pair ${pair.id}: actual=${actual}, expected=${pair.expected}, error=${error}`,
      ).toBeLessThanOrEqual(1e-4);
    }
  });

  it("相同颜色色差为 0", () => {
    for (const pair of SHARMA_PAIRS) {
      expect(deltaE2000(pair.lab1, pair.lab1)).toBe(0);
    }
  });

  it("对称性：dE(a,b) = dE(b,a)（±1e-9）", () => {
    for (const pair of SHARMA_PAIRS) {
      expect(
        Math.abs(deltaE2000(pair.lab1, pair.lab2) - deltaE2000(pair.lab2, pair.lab1)),
      ).toBeLessThanOrEqual(1e-9);
    }
  });

  it("零彩度分支（C′=0）不产生 NaN", () => {
    const value = deltaE2000({ L: 50, a: 0, b: 0 }, { L: 50, a: 0, b: 0 });
    expect(Number.isNaN(value)).toBe(false);
    expect(value).toBe(0);
  });

  it("非法输入抛 RangeError", () => {
    expect(() => deltaE2000({ L: Number.NaN, a: 0, b: 0 }, { L: 0, a: 0, b: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      deltaE2000({ L: 0, a: 0, b: 0 }, { L: 0, a: 0, b: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
  });
});

describe("Oklab 色差", () => {
  it("黑白距离为 1", () => {
    const black = rgbToOklab({ r: 0, g: 0, b: 0 });
    const white = rgbToOklab({ r: 255, g: 255, b: 255 });
    // 白色 Oklab L = 0.9999999935（矩阵系数十进制截断），距离为 1 − 6.53e-9。
    expect(deltaEOklab(black, white)).toBeCloseTo(1, 6);
  });

  it("相同颜色距离为 0，且对称", () => {
    const a: Oklab = { L: 0.5, a: 0.1, b: -0.2 };
    const b: Oklab = { L: 0.7, a: -0.1, b: 0.05 };
    expect(deltaEOklab(a, a)).toBe(0);
    expect(deltaEOklab(a, b)).toBeCloseTo(deltaEOklab(b, a), 15);
  });

  it("非法输入抛 RangeError", () => {
    expect(() => deltaEOklab({ L: Number.NaN, a: 0, b: 0 }, { L: 0, a: 0, b: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("往返精度（0–255 尺度）", () => {
  it("RGB → Lab → RGB 最大通道误差 ≤ 1（本实现为 0）", () => {
    for (const color of ROUND_TRIP_COLORS) {
      const error = maxChannelError(color.rgb, labToRgb(rgbToLab(color.rgb)));
      expect(error, `${color.hex} Lab 往返误差 ${error}`).toBeLessThanOrEqual(1);
    }
  });

  it("RGB → Oklab → RGB 最大通道误差 ≤ 1（本实现为 0）", () => {
    for (const color of ROUND_TRIP_COLORS) {
      const error = maxChannelError(color.rgb, oklabToRgb(rgbToOklab(color.rgb)));
      expect(error, `${color.hex} Oklab 往返误差 ${error}`).toBeLessThanOrEqual(1);
    }
  });
});

describe("确定性", () => {
  it("相同输入重复调用得到逐位相同的结果", () => {
    const rgb: RGB = { r: 127, g: 63, b: 191 };
    expect(rgbToLab(rgb)).toEqual(rgbToLab(rgb));
    expect(rgbToOklab(rgb)).toEqual(rgbToOklab(rgb));
    expect(rgbToHex(rgb)).toBe(rgbToHex(rgb));

    const lab1: Lab = { L: 35.0831, a: -44.1164, b: 3.7933 };
    const lab2: Lab = { L: 35.0232, a: -40.0716, b: 1.5901 };
    expect(deltaE2000(lab1, lab2)).toBe(deltaE2000(lab1, lab2));
  });

  it("调用顺序不影响结果（无跨调用状态）", () => {
    const a: Lab = { L: 50, a: 2.6772, b: -79.7751 };
    const b: Lab = { L: 50, a: 0, b: -82.7485 };
    const first = deltaE2000(a, b);
    const middle = deltaE2000({ L: 10, a: 20, b: 30 }, { L: 40, a: -5, b: 12 });
    const second = deltaE2000(a, b);
    expect(second).toBe(first);
    expect(Number.isFinite(middle)).toBe(true);
  });
});
