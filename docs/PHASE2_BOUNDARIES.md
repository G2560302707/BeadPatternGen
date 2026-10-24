# 二期边界清单（S16）

授权：用户已明确要求开始二期。一期算法与导出模块只读复用，禁止替换实现。

## 可复用（只调用，不改内部）

- `src/core/color/`、`src/core/palette/`、`src/core/dithering/`、`src/core/sampling/`、`src/core/modes/`
- `src/core/pipeline/generate.ts` 全图生成入口
- `src/core/quality/` 诊断纯函数（编辑后可再调用 `buildReport`）
- `src/core/pattern/` 的 `BeadPattern` 字段名、`computeStats`、`encodeProject` / `decodeProject`（schema 1.0）
- `src/export/` PNG / PDF / CSV / JSON（导出当前内存中的 `BeadPattern`）
- `src/render/canvas-renderer.ts` 读 cells 绘制；选区叠在预览层，不改量化

## 必须扩展（新增，不替换）

- 编辑命令：`src/core/pattern/commands.ts`（稀疏差分，禁止 UI 直接写 `cells`）
- 选区几何：`src/core/pattern/selection.ts`
- 增量统计：`src/core/pattern/stats-delta.ts`
- 局部再生成：`src/core/pattern/local-regen.ts`（调用已有 `buildPaletteIndex.nearest`）
- 工作区：`locked` 位图、undo/redo 栈、选区、剪贴板（不进 schema 1.0 JSON）
- IndexedDB v3：新增 `edit-drafts` 仓；不改 v1/v2 仓结构与旧记录
- 「另存副本」：新 `id`，不覆盖原项目

## 绝不能动

- 一期色卡匹配 / 抖动 / 局部优化 / 流水线顺序
- 导出切片几何、PDF 分页、CSV 表头、JSON schema 1.0 必填字段
- 把 `locked` / `editHistory` 写进 `ProjectJsonV1`（会破坏一期往返测试）
- 诊断里编造还原度分数
- 外网请求、第三方字体 CDN
