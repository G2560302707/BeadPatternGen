# 拼豆图纸生成器 · BeadPatternGen

纯前端的拼豆（Perler / 熨斗豆）图纸生成器：导入任意图片，经过裁剪、色卡量化、抖动与局部优化，生成可以直接照着拼的图纸，并导出 PNG / 分页 PDF / CSV 用量清单 / JSON 工程。所有计算均在浏览器本地完成——`src` 中没有任何网络请求（E2E 已验证），图片不会离开你的电脑。

## 功能特性

- 🎨 **真实色卡匹配** — 内置 Artkal S 色卡（数据来自 [maxcleme/beadcolors](https://github.com/maxcleme/beadcolors)，按 commit 锁定）；颜色科学内核实现 sRGB → Lab → Oklab 转换，用 CIEDE2000 色差公式做最近邻匹配。
- 🖼️ **图片导入与裁剪** — 面积采样、裁剪预览，透明图片支持「保留透明」与「透明转纯色」两种策略。
- 🧭 **四模式生成策略** — `photo`（照片/人物）、`anime`（二次元，强制无抖动保描边）、`logo`（文字/几何边缘）、`landscape`（大面积渐变），每种模式围绕「边缘保护 vs 孤立点修复」的目标函数给出不同的保守程度。
- 🔀 **确定性抖动** — Floyd–Steinberg，同输入永远同输出。
- 📊 **质量诊断** — 孤立豆、碎片、细线、高色差格自动检测，生成可读报告。
- ✂️ **主体识别与构图**（二期）— 浏览器端运行 u2netp 分割模型（onnxruntime-web，WASM / WebGPU 自动回退），抠出主体后按占比 / 边距做构图合成，支持透明 / 纯色 / 图片背景。
- 👁️ **只读预览** — 缩放、平移、网格、原图对照。
- 📤 **多格式导出** — PNG（格尺寸 8/16/24/32）、分页 PDF（A4 / A3 / Letter，含切片拼版数学与末端色号清单）、CSV 用量统计（UTF-8 BOM，Excel 直开）、JSON 工程文件。
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

## 目录结构

```
src/
├── app/          # 入口与全局样式
├── components/   # 通用 UI 组件（空态 / 错误 / 加载）
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
├── features/     # 业务功能面板（导入 / 裁剪 / 设置 / 预览 / 导出 …）
├── export/       # PNG / PDF / CSV / JSON 导出
├── storage/      # IndexedDB 存储层
├── render/       # 画布渲染
├── state/        # Zustand 状态
└── workers/      # 生成 Worker 与分割 Worker
```

## 文档

- 技术规格与实施计划见 [`docs/`](docs/)（`TECHNICAL_SPEC.md`、`IMPLEMENTATION_STATUS.md`、`DEPENDENCY_DECISIONS.md`、`SEGMENTATION.md` 等）
- 逐阶段拆解文档见 [`拆解文档/`](拆解文档/)（S01–S22 每阶段的目标、约束与验收标准）

## 许可

[MIT](LICENSE)

色卡数据来自 [maxcleme/beadcolors](https://github.com/maxcleme/beadcolors)，其许可与来源说明见 `src/core/palette/NOTICE-maxcleme-beadcolors.txt`；分割模型 u2netp 遵循 Apache-2.0。模型与 onnxruntime wasm 资源均不随仓库分发，按需下载。
