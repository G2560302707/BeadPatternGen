# 二期验收表（S16–S22）

更新日期：2026-10-24（R1–R9 增补）  
授权：用户已要求开始二期。一期算法与导出模块未替换。

| 项 | 结论 | 证据 |
|---|---|---|
| S16 边界 | 通过 | `docs/PHASE2_BOUNDARIES.md` |
| 命令写入 cells | 通过 | `src/core/pattern/commands.test.ts`：undo N 次矩阵复原；UI 经 `executeCommand` / `commitStroke` |
| 连续笔划合并 | 通过 | `mergePaintCommands`；画笔一次 pointerdown→up 记一条历史 |
| 增量统计 | 通过 | `applyChangesToStats` 与 `computeStats` 对齐 |
| 选区填充 / 替换 / 镜像 / 旋转 / 复制粘贴 | 通过 | `src/core/pattern/selection.test.ts` |
| 自动保存 / 恢复 / 另存副本 | 通过 | `src/storage/draft-repository.test.ts`；UI「另存副本」新 id |
| locked 不被局部再生成覆盖 | 通过 | `src/core/pattern/local-regen.test.ts` |
| 编辑后导出 | 通过 | `src/export/export.test.ts` · JSON after phase-2 edits；仍走一期 `exportPng` / `encodeProject` |
| 200×200 历史内存 | 通过 | `estimateHistoryBytes` < 8MB（80 条 × 40 格稀疏差分） |
| schema 1.0 | 通过 | locked / 历史不写入 `ProjectJsonV1` |
| 一期回归 | 以本轮 `pnpm test` / `pnpm test:e2e` 原始输出为准 | |

## R 轮增补（2026-10-24）

| 项 | 结论 | 证据 |
|---|---|---|
| R1 图层（1 基底 + 1 精修层） | 通过 | `src/core/pattern/layers.test.ts`（合成顺序 / 反推 / undo 记账）；`src/state/workspace-store.layers.test.ts`（隐藏精修层后可见矩阵 === 基底、undo 不破坏基底、还原可撤销）；`src/storage/draft-repository.test.ts`（图层侧车往返） |
| R1 边界 | 通过 | 图层不进 schema 1.0 JSON；只新增 `edit-drafts` 可选字段；导出模块未改（只读合成后的可见矩阵） |
| R2 非正方形旋转 / 平移 | 通过 | `src/core/pattern/selection.test.ts` 新增 9 用例（2×3 转 90° 宽高对调、clipped 报告、平移往返复原、目标覆盖 / 源清空）；PatternBoard「旋转」改用 `rotateSelection`，新增上/下/左/右移（kind `translate`） |
| R3 无 sample 再生成 | 通过 | `src/features/pattern-preview/regen-sample.test.ts`（source.crop 优先并夹紧、locked 不被覆盖）；无原图时按钮禁用 + `E_REGEN_NO_SOURCE` 可见错误，不静默 |
| R7 性能记时 | 通过（表未填） | 状态栏显示真实耗时（`src/state/generation.ts`）；`docs/manual/性能记时表.md` 模板，未实测留空，未写成 CI 门禁 |
| R8 盲测记录表 | 通过（未实测） | `docs/manual/视觉盲测记录表.md`；无 0–100 分 / 百分比 / ΔE 分数 |
| R9 WebGPU 冒烟 | 文档完成 | `docs/SEGMENTATION.md` 6.1 节 + Worker 后端日志；E2E 仍走默认路径 |
| R5 多主体 | 仅方案 | `docs/PROPOSAL_MULTI_SUBJECT.md`，未改 src |
| R4 更大分割模型 | 未开工 | 缺模型：`public/models/` 只有 u2netp.onnx，未改代码 |
| R6 自备色卡 | 未开工 | 缺用户色卡 JSON（许可 / 字段未提供），未改代码 |
| E2E 断言调整 | 说明 | `toHaveText("生成完成")` → `toContainText("生成完成")`，因 R7 状态栏新增真实耗时后缀；断言意图（生成完成）未变 |

未纳入：MARD/Perler 色卡、把诊断编成还原度分数、Playwright 跑真实 ONNX、多主体实现（等方案评审）。
