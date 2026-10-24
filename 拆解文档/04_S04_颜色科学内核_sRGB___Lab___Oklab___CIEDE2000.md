# S04 · 颜色科学内核：sRGB / Lab / Oklab / CIEDE2000

> **所属** 一期 · 内核 ｜ **主导** 国产模型 ｜ **工期** 2–3 天 ｜ **前置** S03 ｜ **原文** 原文 P4（拆出）

> 拆解版 v1.0（基于技术规格 v1.1 修正版）

---

## 本阶段目标

整条流水线的地基。这一层错了，后面所有色卡匹配、抖动、诊断全错，而且错得很隐蔽——图看起来还行，但颜色永远配不准。

## 交付文件

- `src/core/color/types.ts`
- `src/core/color/srgb.ts`
- `src/core/color/lab.ts`
- `src/core/color/oklab.ts`
- `src/core/color/ciede2000.ts`
- `src/core/color/hex.ts`
- `src/core/color/index.ts`
- `src/core/color/VECTORS.md`
- `src/core/color/color.test.ts`

## 提示词 A：发给国产模型（算法交付）

````text
【本阶段】S04 · 颜色科学内核：sRGB / Lab / Oklab / CIEDE2000
（原文对应：原文 P4（拆出） ｜ 参考工期：2–3 天 ｜ 前置：S03）

【目标】整条流水线的地基。这一层错了，后面所有色卡匹配、抖动、诊断全错，而且错得很隐蔽——图看起来还行，但颜色永远配不准。

【交付物】严格按下列路径输出，每个文件给出完整全文（不接受「// 省略」「…」「其余同上」）：
  - src/core/color/types.ts
  - src/core/color/srgb.ts
  - src/core/color/lab.ts
  - src/core/color/oklab.ts
  - src/core/color/ciede2000.ts
  - src/core/color/hex.ts
  - src/core/color/index.ts
  - src/core/color/VECTORS.md
  - src/core/color/color.test.ts

【任务】
【函数签名必须逐字照抄，不许改名、不许加参数、不许改返回结构】
```ts
// types.ts
export interface RGB { r: number; g: number; b: number }   // 0–255
export interface Lab { L: number; a: number; b: number }   // CIE L*a*b*, D65
export interface Oklab { L: number; a: number; b: number }
export type ColorMetricName = "ciede2000" | "oklab";

// srgb.ts
export function srgbToLinear(c: number): number;   // 输入 0–1
export function linearToSrgb(c: number): number;   // 输出 0–1

// lab.ts
export function rgbToLab(rgb: RGB): Lab;
export function labToRgb(lab: Lab): RGB;           // 结果 clamp 到 0–255 并四舍五入

// oklab.ts
export function rgbToOklab(rgb: RGB): Oklab;
export function oklabToRgb(ok: Oklab): RGB;

// ciede2000.ts
export function deltaE2000(a: Lab, b: Lab): number;
export function deltaEOklab(a: Oklab, b: Oklab): number;

// hex.ts
export function hexToRgb(hex: string): RGB;        // 支持 #abc / #AABBCC / 大小写
export function rgbToHex(rgb: RGB): string;        // 输出大写 #RRGGBB
```

【实现要求】
1. sRGB 传递函数用标准分段式（线性段斜率 12.92，伽马段 1.055/2.4，阈值 0.0031308 / 0.04045）。
2. XYZ 使用 sRGB D65 矩阵，白点 Xn=0.95047、Yn=1.0、Zn=1.08883，写进具名常量并注明来源。
3. Oklab 必须走标准 M1/M2 矩阵路线（线性 sRGB → LMS → 立方根 → Lab），不要用近似幂函数替代。
4. CIEDE2000 必须完整实现：kL=kC=kH=1，色相角用 atan2 归一化到 [0,360)，
   色相差 Δh 必须处理 ±360 回绕，旋转项 RT 与 SL/SC/SH 全部按 CIE 标准公式。
5. 输入越界（NaN、负数、>255）的行为必须明确选择「抛错」或「clamp」，二者选一并写进注释与 VECTORS.md，
   全包保持一致。
6. 不得缓存跨调用状态；不得使用全局可变变量。

【VECTORS.md 必须包含】
- 一张「CIEDE2000 标准验证对」表：至少 10 组，取自 Sharma / Wu / Dalal (2005) 公开的测试对，
  给出 Lab1、Lab2、期望 ΔE00、本实现输出、绝对误差。这是本阶段最重要的一张表。
- 一张往返表：黑 #000000、白 #FFFFFF、中灰 #808080、纯红、纯绿、纯蓝、
  以及 3 个随机但固定的中间色，给出 RGB → Lab → RGB 与 RGB → Oklab → RGB 的最大通道误差（0–255 尺度）。
- 一张边界表：hex 短写 #abc、大小写、非法输入（"#GGG"、"12ab"、空串）的预期行为。

【确定性硬要求】
- 相同输入必得相同输出；同一次交付内不得出现随机数、时间戳、依赖遍历顺序的写法。
- 所有阈值 / 容差 / 矩阵系数必须集中成具名常量，注释标明来源（标准编号 / 公式推导 / 经验值）。
- 浮点累加顺序必须写死并注释，避免末位误差导致回归测试随机失败。

【自检清单】交付前逐条自查，输出结果表（项目 / 结论 / 依据），结论只能是「通过 / 不通过 / 未验证」：
  1. CIEDE2000 与标准测试对的绝对误差 ≤ 1e-4（逐条列出）
  2. RGB→Lab→RGB 往返最大通道误差 ≤ 1（0–255 尺度）
  3. RGB→Oklab→RGB 往返最大通道误差 ≤ 1（0–255 尺度）
  4. hex 短写 / 大小写 / 非法输入行为与 VECTORS.md 一致
  5. 全包零 import、零第三方依赖、零 DOM 引用
  6. 没有任何 Math.random / Date.now / 依赖遍历顺序的写法

【特别提醒】
最大的翻车点是 CIEDE2000 的色相回绕与 RT 项。请先把 10 组标准测试对算到 1e-4 再往下写别的函数——先证明公式对，再谈代码整洁。

【边界】不要写 UI、不要写 Worker、不要改 package.json、不要引入任何第三方库。
你的交付物会被另一位工程师原样粘贴进工程后运行 vitest，任何「看起来对」的近似实现都会在断言下暴露。
````

## 提示词 B：发给 Cursor（落地验证）

````text
【落地任务】上一轮由另一个模型交付了下面这批文件。你的工作只有「接入 + 验证」，不是重新实现。

要落地的文件：
  - src/core/color/types.ts
  - src/core/color/srgb.ts
  - src/core/color/lab.ts
  - src/core/color/oklab.ts
  - src/core/color/ciede2000.ts
  - src/core/color/hex.ts
  - src/core/color/index.ts
  - src/core/color/VECTORS.md
  - src/core/color/color.test.ts

1. 按指定路径原样创建这些文件。不允许改写函数名、参数顺序、导出名、类型字段名。
2. 若与既有代码存在类型冲突：只允许在调用侧做适配，不允许改核心实现。确需改动时先说明理由并列出差异清单。
3. 接入点：src/core/color/index.ts 的导出将被 S05 色卡匹配、S07 抖动、S08 诊断三处直接 import，导出名必须与上面签名完全一致。
4. 运行下面的命令并粘贴原始输出：
   pnpm typecheck
   pnpm vitest run src/core/color
   pnpm build
5. 如果测试失败：禁止修改断言、禁止放宽容差、禁止改实现去迎合测试。请先按下面格式把失败最小化回传给我：
   FAIL_CASE: 函数=<名称> | 输入=<可复制的最小输入> | 期望=<VECTORS 中的值> | 实际=<实测值> | 差异=<绝对误差>
6. 报告：文件清单 / 命令原始输出 / 失败用例 / 是否需要回传重做。
````

## 风险提示

若误差不达标，绝不允许放宽容差或改测试向量。这是纯数学，错了就是实现错了。

---

← 返回 [S04 索引](00_使用说明.md)
