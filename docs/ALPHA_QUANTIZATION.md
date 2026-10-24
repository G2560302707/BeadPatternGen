# Alpha 与颜色量化（C5）

> 适用范围：`src/core/pipeline/generate.ts` 从采样缓冲到 `BeadPattern` 的整条量化链路。
> 回归测试：`src/core/pipeline/alpha.test.ts`（15 个用例，长期红线）。

## 1. 验收红线

**透明像素不得被映射为黑色拼豆。**

二期构图引擎的输出是 RGBA 画布：透明背景像素为 `(0, 0, 0, 0)`。如果量化阶段
只用 RGB、忽略 Alpha，这些格子会被最近邻匹配成黑色（`#000000` 附近），
整张图纸会出现一圈黑边或整块黑底。C5 的所有行为都围绕这条红线定义。

## 2. 两种模式

模式由 `GenerateInput.transparentPolicy` 选择，取值沿用一期
`src/core/pattern/types.ts` 的 `TransparentPolicy`。

| 模式         | 语义       | 透明格处理                  | 是否消耗豆子 | 参与误差扩散 | 产物 settings            |
| ------------ | ---------- | --------------------------- | ------------ | ------------ | ------------------------ |
| `empty`      | 保留透明   | `cells[i] = -1`（空格）     | 否           | 否           | `transparentPolicy`      |
| `background` | 透明转纯色 | 用 `backgroundHex` 颜色量化 | 是           | 是           | 同时写入 `backgroundHex` |

### 2.1 `empty`：保留透明

- **判定阈值**：`alpha < 128`（`EMPTY_ALPHA_THRESHOLD`）即空格。128 不是空格。
  该阈值与 `src/core/sampling/area-sample.ts` 的采样阈值完全一致。
- 空格的 RGB **永远不被读取**：不进入色卡子集选择、最近邻匹配、误差扩散、
  局部优化、边缘强度与诊断。透明格无论携带 `(0,0,0)`、洋红还是任意颜色，
  输出都逐格相同（测试用例固定了这一点）。
- 误差扩散：空格不量化、不发射误差；扩散目标落在空格上时误差直接丢弃，
  不会绕路污染邻域。
- 全透明图是合法结果：`beadCount = 0`，不会因“没有样本”而失败。
  此时 `pattern.palette` 按色卡原顺序取前 `min(maxColors, palette.length)` 个颜色
  占位（没有任何格子引用它们），保证图纸结构仍然有效。

### 2.2 `background`：透明转纯色

- **默认背景色**：`#FFFFFF`（`DEFAULT_TRANSPARENT_BACKGROUND_HEX`）。
  未提供 `backgroundHex` 时自动使用白色，而不是报错或把透明当成黑色。
- 背景色只接受 `#RRGGBB`（大小写不敏感），持久化前统一转成大写。
  非法值在任何像素计算之前抛出 `E_INVALID_SETTINGS`。
- **替换规则**：只有 `alpha === 0` 的格子替换为背景色。
  - 这些格子在数学上没有可见贡献，RGB 是不携带信息的哨兵值；
  - 替换发生在色卡子集选择之前，因此透明格不会把黑色“投票”进色卡子集。
- **半透明格**（`alpha > 0`）保留采样 RGB：
  - 采样使用 `alphaPolicy="background"` 时，RGB 已逐像素合成到背景色上；
  - 采样使用 `alphaPolicy="empty"` 时，RGB 是可见内容的预乘还原色；
  - 二次合成会把主体边缘进一步压向背景色，因此这里刻意不重复合成。
- 所有格子都消耗豆子，空白背景也会被拼成背景色。

## 3. 采样与量化的对接约定（与 UI / C6）

1. `sampleToGrid()` 的 `alphaPolicy` 与 `generatePattern()` 的 `transparentPolicy`
   **使用同一个值**（当前 UI 的 `workspace.alphaPolicy` 同时传给两者）。
2. `empty` 采样输出的 alpha 只可能是 `0` 或 `>= 128`；`background` 采样的 RGB
   已经不透明化，alpha 仅保留真实平均值。
3. 构图结果（`composeImage()`）的透明背景为 `(0,0,0,0)`。无论走哪种采样策略，
   量化阶段都能保证它不会变成黑豆：
   - `empty` → 空格；
   - `background` → 背景色（默认白色）。
4. 即使调用方误把未采样的透明缓冲直接交给 `generatePattern()`（例如 C6 的直通路径），
   `background` 模式也会用背景色替换 `alpha === 0` 的哨兵色。这是防御性保证，
   不替代第 1 条的一致性约定。
5. **对二期构图结果的建议默认值**：`background` + `#FFFFFF`（安全模式）。
   `empty` 适合明确要镂空成品（不拼背景）的场景。默认值属于 UI 状态层
   （`src/state/`，由 UI 协作方维护），核心层不替 UI 做选择；无论选哪种，
   本文件定义的语义都保证红线不被突破。

## 4. 流水线各阶段的 Alpha 行为

| 阶段              | `empty` 空格                                    | `background` 透明格      |
| ----------------- | ----------------------------------------------- | ------------------------ |
| 色卡子集 `subset` | 跳过，不参与样本分布                            | 以背景色参与             |
| 最近邻 `match`    | 写 `-1`，不调用 `nearest()`                     | 正常量化为背景色对应的豆 |
| 抖动 `dither`     | 不量化、不发射误差；接收误差时直接丢弃          | 正常参与误差扩散         |
| 局部优化 `refine` | `-1` 永不被修改；不作为同色邻居、不参与边缘强度 | 正常参与                 |
| 诊断 `diagnose`   | 不计入 `nonEmptyCells`、孤立豆、碎片、细线      | 正常参与                 |
| 统计 `stats`      | 不计入 `beadCount`                              | 计入                     |

## 5. 边界与已知限制

- **半透明边缘**：`alpha >= 128` 的格子按实心豆处理（保留可见色）。
  `alpha 1–127` 在 `empty` 模式下视为空格；在两格拼豆的粒度上不做部分透明度表达。
- **不做 Alpha 羽化/抗锯齿**：量化阶段只做“透明 / 不透明”的二值判定，
  边缘过渡由 C2 蒙版后处理与 C3 构图决定。
- **`background` 模式不使用 alpha 做二次合成**：见 2.2。若未来需要在量化阶段
  直接接收未合成的原始 RGBA，应新增显式字段区分“是否已合成”，不能靠猜。

## 6. 回归用例

`src/core/pipeline/alpha.test.ts`：

| 场景                                                        | 断言                                               |
| ----------------------------------------------------------- | -------------------------------------------------- |
| `empty` 全透明图                                            | 全部 `-1`，`beadCount = 0`，不报错                 |
| `empty` 透明格 RGB 为黑 / 洋红 + FS 抖动                    | 两种输入输出逐格相同，透明列仍为 `-1`              |
| `empty` alpha 127 / 128                                     | 127 为空格，128 为豆                               |
| `empty` 选色时透明哨兵不参与                                | `maxColors = 1` 选出红色而非黑色                   |
| `empty` 半透明边缘邻接深色主体                              | 128 的边缘仍属于主体                               |
| `background` 全透明图                                       | 全部为背景色，绝不出现黑色                         |
| `background` 缺省背景色                                     | 默认 `#FFFFFF`                                     |
| `background` 小写背景色                                     | 归一化为大写                                       |
| `background` 透明格 RGB 为黑 / 洋红                         | 输出相同，透明格为背景色                           |
| `background` 半透明边缘                                     | 保留可见色，不被替换成背景色                       |
| 非法策略 / 非法背景色                                       | `E_INVALID_SETTINGS`，且在任何像素计算之前         |
| 两种模式的确定性                                            | 同输入两次运行逐格一致                             |
| `composeImage` 透明背景 → `sampleToGrid(empty)` → 量化      | 构图留白为 `(0,0,0,0)`，输出为空格，主体仍为深色豆 |
| `composeImage` 透明背景 → `sampleToGrid(background)` → 量化 | 构图留白变成背景色豆，绝不出现黑豆                 |

## 7. 错误码

| 错误码               | 触发条件                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `E_INVALID_SETTINGS` | `transparentPolicy` 不是 `empty` / `background`；`background` 模式下 `backgroundHex` 不是 `#RRGGBB`；`maxColors < 1` |
| `E_INVALID_SAMPLE`   | `rgb.length !== width * height * 3` 或 `alpha.length !== width * height`                                             |
