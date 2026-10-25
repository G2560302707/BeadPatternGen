# S06 · 面积采样测试向量（VECTORS）

本文件定义 `sampleToGrid` 的确定性行为。测试 `src/core/sampling/sampling.test.ts` 逐条断言。

## 1. 坐标与权重

- `crop` 使用**源图像素坐标**：像素 `(px, py)` 占据 `[px, px+1) × [py, py+1)`。
- 输出格 `(cx, cy)` 对应源区域：

  ```
  x0 = crop.x + cx * crop.width  / gridW
  x1 = crop.x + (cx+1) * crop.width  / gridW
  y0 = crop.y + cy * crop.height / gridH
  y1 = crop.y + (cy+1) * crop.height / gridH
  ```

- 单个源像素的权重 = 它与该格区域的真实交叠面积（`wx * wy`）。
- 权重按格区几何面积归一化。正常路径下 `Σweight / regionArea === 1`。
- 浮点比较容差：`1e-9`。

## 2. 放大退化（格区 < 1 平方像素）

- 当 `regionArea = (x1-x0)*(y1-y0) < 1` 时，不按面积采样，改为取格中心最近的单个源像素：
  `px = floor((x0+x1)/2)`，`py = floor((y0+y1)/2)`，随后 clamp 到图像内。
- 该 span 的权重记为 **1**，不是 0。输出像素即该源像素的 RGBA。
- 目的：网格比源图更密时不出现 0 面积 / NaN。

## 3. 颜色与 alpha

设格区总覆盖面积 `A = Σweight`，`a_i ∈ [0,255]`。

- 平均 alpha：

  ```
  avgAlpha = Σ(weight × a_i) / A
  ```

- `alphaPolicy = "empty"`（默认）：

  ```
  alphaWeightSum = Σ(weight × a_i / 255)
  outRGB   = L2S( Σ(weight × S2L(rgb_i) × a_i/255) / alphaWeightSum )   (alphaWeightSum > 0)
  outRGB   = 0                                                          (全透明)
  outAlpha = 0                    if avgAlpha < 128
           = round(avgAlpha)      otherwise
  ```

  **阈值 = 128，且判定为严格小于**：`avgAlpha = 127` 是空格，`128` 不是空格。
  “标记为空”在返回值中的唯一表示是 `outAlpha = 0`。
  颜色按 `coverage × alpha` 预乘累计，避免全透明像素的任意 RGB 污染平均色。

- `alphaPolicy = "background"` 且必须提供 `backgroundHex`（`#RRGGBB`）：

  ```
  outRGB = L2S( Σ(weight × (S2L(rgb_i) × a_i/255 + S2L(bg) × (1 - a_i/255))) / A )
  outAlpha = round(avgAlpha)
  ```

  背景策略下不产生空格；RGB 已合成到背景色，但 alpha 仍输出真实平均值，
  透明度信息不会被静默丢弃。

- 所有输出通道用 `round` 后 clamp 到 `[0,255]`。

- **1.1 起颜色在线性光空间累计与平均**：`S2L` 为 sRGB EOTF（`c ≤ 0.04045`
  时 `c/12.92`，否则 `((c+0.055)/1.055)^2.4`），`L2S` 为其逆。sRGB 编码值直接
  平均会把暗色稀释（50% 黑 + 50% 白得到 188 而不是物理正确的 187/128 线性），
  小格数图纸的描边、眼睛、阴影都会发灰发虚。上式中的求和、均值都在线性域完成，
  仅在输出时编码回 sRGB。
- **细暗线保留（1.1 新增）**：对每个格子做第二遍扫描，统计亮度明显低于格子
  平均（> 20，sRGB 亮度）的可见内容；当其面积占比在 1.2%–22% 之间时视为
  细线/描边——对比度 ≥ 130 且线色亮度 ≤ 100 时整格取线色（线稿的描边格是
  完整的深色），否则按 `min(0.45, 对比度/130)` 向线色偏置。占比超过 22% 的
  暗色是成块阴影（动画平面阴影），绝不能偏置；低于 1.2% 视为噪声。

## 4. 手算向量

### V1 · 2×2 纯色 → 1×1

源像素 RGBA：

```
(10,20,30,255)  (50,60,70,255)
(90,100,110,255) (130,140,150,255)
```

四个像素等权（各 1 面积）：

```
R = (10+50+90+130)/4 = 70
G = (20+60+100+140)/4 = 80
B = (30+70+110+150)/4 = 90
alpha = 255
```

期望：`rgb = [70,80,90]`，`alpha = [255]`。

### V2 · 4×4 灰阶渐变 → 2×2

源图像素值：`v(x,y) = (y*4 + x) * 2`，RGBA = `(v,v,v,255)`。
每个 2×2 格：

| 格 | 像素值 | 平均 |
|---|---|---|
| (0,0) | 0, 2, 8, 10 | 5 |
| (1,0) | 4, 6, 12, 14 | 9 |
| (0,1) | 16, 18, 24, 26 | 21 |
| (1,1) | 20, 22, 28, 30 | 25 |

期望 RGB（按行主序）：`[5,5,5, 9,9,9, 21,21,21, 25,25,25]`；alpha 全 255。

### V3 · 1×1 全透明 + empty

源像素 `(0,0,0,0)`，crop 全图，grid 1×1：

期望 `rgb = [0,0,0]`，`alpha = [0]`（即空格标记）。

### V4 · 非整数比例 7×5 → 3×2

crop = `{x:0,y:0,width:7,height:5}`。格区尺寸为 `7/3 × 5/2 ≈ 2.3333 × 2.5`。
对全部 6 个格断言：

- `spans.length > 0`；
- 每个 `weight > 0`；
- `|Σweight / regionArea − 1| < 1e-9`；
- `nearestFallback === false`。

另用全图恒为 `(123,123,123,255)` 的源图采样，断言 6 格全为 123，
证明非整数比例的归一化没有亮度漂移。

### V5 · 放大退化

1×1 源图 `(200,100,50,255)` → 3×2 网格：每格 `regionArea = 1/6 < 1`，
全部走最近像素，输出 6 格均为 `(200,100,50)`，alpha 255。

### V6 · 背景合成

1×1 源像素 `(255,0,0,128)`，`alphaPolicy="background"`，`backgroundHex="#FFFFFF"`：

```
avgAlpha = 128
R = 255×128/255 + 255×127/255 = 255
G =   0×128/255 + 255×127/255 = 127
B =   0×128/255 + 255×127/255 = 127
```

期望 `rgb=[255,127,127]`，`alpha=[128]`。

### V7 · 非法输入

- crop 越界 / 宽高 ≤ 0 → `SamplingError.code = "INVALID_CROP"`；
- grid 非正整数 → `INVALID_GRID`；
- `background` 缺少 `backgroundHex` → `INVALID_BACKGROUND`；
- `img.data` 长度不等于 `width*height*4` → `INVALID_IMAGE`。
