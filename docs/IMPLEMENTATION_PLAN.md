# 一期实施计划（S01 规划，不提前写后续阶段代码）

规格里程碑 P0–P6 与拆解文档 S01–S15 对齐如下。单人每天约 3 小时时，规格建议一期 4–6 周。

## 阶段映射

| 规格 | 拆解 | 主导 | 目标 | 完成条件 |
|---|---|---|---|---|
| P0 | **S01（本阶段）** | Cursor | 仓库体检、许可、色卡锁定、算法拆解 | 色卡可校验；审计文档齐 |
| P1 | S02 | Cursor | Vite+React+TS+pnpm 骨架、lint/typecheck/test/build、空工作台 | 四门禁绿；目录用 `pattern-preview` 而非 editor |
| P1/P2 | S03 | Cursor | `BeadPattern` / 统计 / JSON Int16Array↔number[] | 单元测试覆盖非法索引与往返 |
| P2 | S04 | 国产 → Cursor 接入 | sRGB/Lab/Oklab/CIEDE2000 | VECTORS 断言通过 |
| P2 | S05 | 国产 → Cursor 接入 | 色卡索引、最近邻、maxColors | 无合成色 |
| P3 | S06 | Cursor | 图片输入、裁剪、面积采样 | 真实解码 + 透明策略 |
| P4 | S07 | 国产 → Cursor 接入 | 确定性 Floyd–Steinberg | 方向与边界写死 |
| P4 | S08 | 国产 → Cursor 接入 | 孤立豆/碎片/细线/高色差 | 孤立豆=4-邻域 |
| P4 | S09 | 国产 → Cursor 接入 | 四模式与局部目标函数 | 权重可测 |
| P4 | S10 | Cursor | Worker、进度、取消、任务 ID | 旧任务不得覆盖新结果 |
| P5 | S11 | Cursor | 只读预览：缩放平移网格对照 | 无改 cells 入口 |
| P5 | S12 | 国产 → Cursor 接入 | PDF 分页几何 | 重叠默认 2 格 |
| P5 | S13 | Cursor | PNG / 分页 PDF / CSV / JSON 导出 | 导出不重新量化 |
| P6 | S14 | Cursor | IndexedDB 保存恢复 | schema 校验 |
| P6 | S15 | Cursor | 隐私审查、E2E、一期验收 | PHASE1_ACCEPTANCE |

二期 S16–S22 默认不排期。触发条件：用户逐字「现在授权开始二期」。

## 工程原则（后续阶段不得推翻）

1. 核心算法仅 `src/core`，不 import React/DOM。
2. 耗时在 Worker；任务 ID 校验。
3. 按钮皆有真实行为；无假进度/假色卡。
4. 最终格子颜色 ∈ 所选 fixture。
5. 用户图片默认不出浏览器。
6. 测试失败修实现，不改断言。

## S02 起建议的空目录（本阶段不创建应用代码）

规格第 6 章：`app/`、`components/`、`features/{image-import,image-crop,generation-settings,pattern-preview,palette-panel,quality-report,export}`、`core/{color,sampling,quantization,dithering,topology,pattern,quality,palette}`、`workers/`、`render/`、`storage/`、`export/`、`state/`、`test/`。

S01 只占用 `src/core/palette/`。
