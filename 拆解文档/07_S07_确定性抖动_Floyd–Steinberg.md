# S07 · 确定性抖动：Floyd–Steinberg

> **所属** 一期 · 内核 ｜ **主导** 国产模型 ｜ **工期** 1–2 天 ｜ **前置** S04, S05 ｜ **原文** 原文 P4（拆出）

> 拆解版 v1.0（基于技术规格 v1.1 修正版）

---

## 本阶段目标

给渐变区域补上「用有限色卡模拟更多层次」的能力，同时保证结果完全可复现——抖动一旦不确定，整个项目的测试体系就废了。

## 交付文件

- `src/core/dithering/types.ts`
- `src/core/dithering/floyd-steinberg.ts`
- `src/core/dithering/index.ts`
- `src/core/dithering/VECTORS.md`
- `src/core/dithering/dithering.test.ts`

## 提示词 A：发给国产模型（算法交付）

````text
【本阶段】S07 · 确定性抖动：Floyd–Steinberg
（原文对应：原文 P4（拆出） ｜ 参考工期：1–2 天 ｜ 前置：S04, S05）

【目标】给渐变区域补上「用有限色卡模拟更多层次」的能力，同时保证结果完全可复现——抖动一旦不确定，整个项目的测试体系就废了。

【交付物】严格按下列路径输出，每个文件给出完整全文（不接受「// 省略」「…」「其余同上」）：
  - src/core/dithering/types.ts
  - src/core/dithering/floyd-steinberg.ts
  - src/core/dithering/index.ts
  - src/core/dithering/VECTORS.md
  - src/core/dithering/dithering.test.ts

【任务】
【函数签名逐字照抄】
```ts
// types.ts
export interface DitherOptions {
  strength: number;    // 0–1，误差扩散强度的缩放系数，默认 1
  metric: ColorMetricName;
}
export interface DitherResult {
  indices: Int16Array;        // 长度 = width*height；-1 表示空格
  residualError: number;      // 全部被丢弃的边界误差绝对值之和，用于诊断
}

// floyd-steinberg.ts
export function floydSteinberg(
  samples: readonly RGB[],       // 长度 = width*height，行优先
  alphaMask: readonly boolean[], // true = 空格，不参与扩散
  width: number,
  height: number,
  palette: readonly BeadColor[],
  index: PaletteIndex,
  options: DitherOptions
): DitherResult;
```
可 import 的唯一外部路径：`../color`、`../palette`。

【实现要求（这些是实现契约，不是建议）】
1. 遍历顺序写死：从左到右，从上到下。不做蛇形扫描（蛇形会破坏确定性测试的可读性）。
2. 误差扩散系数写死为 7/16、3/16、5/16、1/16，对应右、左下、下、右下。
3. 边界误差直接丢弃，不回绕到下一行行首。丢弃量必须累加进 residualError。
4. strength 缩放扩散误差量（newErr = err * strength），默认 1；strength=0 时必须退化为逐格最近邻。
5. alphaMask 为 true 的格子：输出 -1，且不接收、不发射误差。
6. 量化必须走 PaletteIndex.nearest，不许自己再写一遍最近邻。
7. 内部使用 Float32Array 保存累积浮点颜色，禁止用整数中间值（会导致误差被截断）。

【VECTORS.md 必须包含（这是本阶段验收的核心）】
- 一个 3×3 灰度输入 + 2 色色卡（#000000 / #FFFFFF）的完整手算表：
  逐格写出「累积值 → 最近色 → 误差 → 扩散到邻居的各分量」，
  最后一格一列列出最终 indices 数组与 residualError 的精确值。
- strength=0 与 strength=1 两种结果的对比表。
- 一个含 alphaMask 的用例，证明空格切断扩散链。

【确定性硬要求】
- 相同输入必得相同输出；同一次交付内不得出现随机数、时间戳、依赖遍历顺序的写法。
- 所有阈值 / 容差 / 矩阵系数必须集中成具名常量，注释标明来源（标准编号 / 公式推导 / 经验值）。
- 浮点累加顺序必须写死并注释，避免末位误差导致回归测试随机失败。

【自检清单】交付前逐条自查，输出结果表（项目 / 结论 / 依据），结论只能是「通过 / 不通过 / 未验证」：
  1. 3×3 手算用例逐格一致（含 residualError 精确相等）
  2. strength=0 时结果等于逐格最近邻（构造对拍用例）
  3. 遍历顺序与扩散系数与规格逐字一致
  4. 空格不接收也不发射误差
  5. 同输入两次调用结果完全一致
  6. 仅 import ../color 与 ../palette

【特别提醒】
手算表必须真的手算，不能靠跑代码回填——如果实现和手算不一致，是其中一方错了，必须查清而不是改表。residualError 的浮点累加顺序写死（行优先），否则末位会出现 1e-7 级差异。

【边界】不要写 UI、不要写 Worker、不要改 package.json、不要引入任何第三方库。
你的交付物会被另一位工程师原样粘贴进工程后运行 vitest，任何「看起来对」的近似实现都会在断言下暴露。
````

## 提示词 B：发给 Cursor（落地验证）

````text
【落地任务】上一轮由另一个模型交付了下面这批文件。你的工作只有「接入 + 验证」，不是重新实现。

要落地的文件：
  - src/core/dithering/types.ts
  - src/core/dithering/floyd-steinberg.ts
  - src/core/dithering/index.ts
  - src/core/dithering/VECTORS.md
  - src/core/dithering/dithering.test.ts

1. 按指定路径原样创建这些文件。不允许改写函数名、参数顺序、导出名、类型字段名。
2. 若与既有代码存在类型冲突：只允许在调用侧做适配，不允许改核心实现。确需改动时先说明理由并列出差异清单。
3. 接入点：src/core/dithering/index.ts 由 S10 的生成流水线在 settings.dithering === 'floyd-steinberg' 时调用。
4. 运行下面的命令并粘贴原始输出：
   pnpm typecheck
   pnpm vitest run src/core/dithering
   pnpm build
5. 如果测试失败：禁止修改断言、禁止放宽容差、禁止改实现去迎合测试。请先按下面格式把失败最小化回传给我：
   FAIL_CASE: 函数=<名称> | 输入=<可复制的最小输入> | 期望=<VECTORS 中的值> | 实际=<实测值> | 差异=<绝对误差>
6. 报告：文件清单 / 命令原始输出 / 失败用例 / 是否需要回传重做。
````

## 风险提示

浮点累加顺序不确定会导致末位误差，进而让「确定性测试」随机失败。累加路径必须在实现里写死并注释。

---

← 返回 [S07 索引](00_使用说明.md)
