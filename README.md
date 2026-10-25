# 豆豆图纸 · BeadPatternGen

纯前端的拼豆（Perler / 熨斗豆）图纸生成器：导入任意图片，经过抠图构图、裁剪、色卡量化、抖动与局部优化，生成可以直接照着拼的图纸，并导出分享图纸 PNG / 分页 PDF / CSV 用量清单 / JSON 工程。所有计算均在浏览器本地完成——`src` 中没有任何网络请求（E2E 已验证），图片不会离开你的电脑。

产品形态为「一个家 + 六步流程」：首页（作品库）→ 导入 → 抠图构图（可选）→ 画布裁剪 → 调色生成 → 精修 → 导出分享，顶部步进器随时跳转。视觉提供 6 套可切换主题（默认 🌸樱粉少女，二次元可爱风；🍇香芋啵啵 / 🍵抹茶奶绿 / 🥤海盐汽水 / 🌙月夜宫阙 / ☁️云朵白），字体为自托管 OFL 子集（站酷快乐体 + Baloo 2，`pnpm fonts` 重建）。

## 功能特性

- 🎨 **真实色卡匹配** — 内置市面主流双色卡，可切换：MARD 221（2.6mm 小豆行业通用色号，默认；数据来自 [HansBug/pindou-color-data](https://github.com/HansBug/pindou-color-data)，MIT）与 Artkal S 178 色（5mm 大豆；数据来自 [maxcleme/beadcolors](https://github.com/maxcleme/beadcolors)，MIT）。颜色科学内核实现 sRGB → Lab → Oklab 转换，用 CIEDE2000 色差公式做最近邻匹配。
- 🖼️ **图片导入与裁剪** — 面积采样、裁剪预览，透明图片支持「保留透明」与「透明转纯色」两种策略。
- 🧭 **四模式生成策略** — `photo`（照片/人物）、`anime`（二次元，强制无抖动保描边）、`logo`（文字/几何边缘）、`landscape`（大面积渐变），每种模式围绕「边缘保护 vs 孤立点修复」的目标函数给出不同的保守程度。
- 🔀 **确定性抖动** — Floyd–Steinberg，同输入永远同输出。
- 📊 **质量诊断** — 孤立豆、碎片、细线、高色差格自动检测，生成可读报告。
- ✂️ **主体识别与构图**（二期）— 浏览器端运行 u2netp 分割模型（onnxruntime-web，WASM / WebGPU 自动回退），抠出主体后按占比 / 边距做构图合成，支持透明 / 纯色 / 图片背景。
- 👁️ **只读预览** — 缩放、平移、网格、原图对照。
- 📤 **多格式导出，统一「分享卡片」版式** — 分享图纸 PNG、图纸 PNG、制作/预览 PDF 共用同一套视觉（页眉信息栏 / 白色圆角图纸卡 + 红角标 / 每 5 格分区线 / 按用量排序的圆角图例，`card-style.ts` 单一来源）；PDF 中文页眉走内嵌 Noto Sans SC 子集字体（`pnpm fonts:pdf` 重建，缺失时自动回退英文）。另有 CSV 用量统计（UTF-8 BOM，Excel 直开）与 JSON 工程文件。
- 📏 **市售板子规格** — 5mm 标准板（29×29）与 2.6mm 小豆板（26×26）预设一键套用，自动换算拼板数与成品厘米尺寸。
- 💾 **本地保存** — IndexedDB 三仓存储（工程 / 图纸 / 缩略图），刷新后无原图也能恢复只读图纸；配额 80% 预警。
- 🔒 **隐私优先** — 去掉一切 CDN 与外站字体，Playwright E2E 验证「外站请求数为零」。

## 快速开始

```bash
pnpm install
pnpm models:download   # 下载 u2netp 分割模型（约 4.4 MB，模型不随仓库分发）
pnpm ort:sync          # 同步 onnxruntime-web 的 wasm 资源
pnpm dev               # 启动开发服务器
```

常用命令：

| 命令 | 说明 |
| --- | --- |
| `pnpm build` | 类型检查 + 生产构建 |
| `pnpm test` | Vitest 单元测试 |
| `pnpm test:e2e` | Playwright 端到端测试 |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript 检查 |
| `pnpm validate:palette` | 校验色卡数据完整性 |
| `pnpm fonts` | 重建自托管字体子集（下载 OFL 字体 → 按站点词汇表子集化） |
| `pnpm samples` | 重新生成内置示例图（public/samples） |

## 目录结构

```
src/
├── app/          # 外壳（AppShell / 路由 / 主题引擎 / 品牌 / 全站样式）
├── pages/        # 分步页面（首页 + 导入/构图/画布/生成/精修/导出 + 法务页）
├── ui/           # 通用 UI 组件（步进器 / 弹层 / 对话框 / 页面框架件）
├── design/       # 设计系统：令牌、6 套主题 CSS、字体、豆豆吉祥物 SVG
├── components/   # 状态反馈组件（空态 / 错误 / 加载）
├── features/     # 业务功能面板（导入 / 裁剪 / 设置 / 预览 / 导出 …）
├── core/         # 纯算法内核（无 DOM 依赖）
│   ├── color/       # sRGB / Lab / Oklab / CIEDE2000
│   ├── palette/     # 色卡索引、最近邻匹配、锁色
│   ├── image/       # 图片解码、裁剪、面积采样
│   ├── dithering/   # Floyd–Steinberg 确定性抖动
│   ├── modes/       # 四模式策略与局部优化
│   ├── quality/     # 孤立豆 / 碎片 / 细线诊断
│   ├── subject/     # 主体分割（u2netp）与蒙版后处理
│   ├── composition/ # 构图几何与像素合成
│   ├── pipeline/    # 生成流水线装配
│   └── pattern/     # 图纸数据模型与统计
├── export/       # PNG / PDF / CSV / JSON 导出
├── storage/      # IndexedDB 存储层
├── render/       # 画布渲染
├── state/        # Zustand 状态
└── workers/      # 生成 Worker 与分割 Worker
```

## 许可

[MIT](LICENSE)

Artkal S 色卡数据来自 [maxcleme/beadcolors](https://github.com/maxcleme/beadcolors)（`src/core/palette/NOTICE-maxcleme-beadcolors.txt`），MARD 221 色卡数据来自 [HansBug/pindou-color-data](https://github.com/HansBug/pindou-color-data)（`src/core/palette/NOTICE-hansbug-pindou-color-data.txt`），均为社区测量值而非品牌官方数值；分割模型 u2netp 遵循 Apache-2.0。UI 字体为 [站酷快乐体](https://github.com/googlefonts/zcool-kuaile) 与 [Baloo 2](https://github.com/googlefonts/baloo2)，均遵循 SIL Open Font License（许可文本随 `public/fonts/` 分发，`pnpm fonts` 可重建子集）。模型与 onnxruntime wasm 资源均不随仓库分发，按需下载。
