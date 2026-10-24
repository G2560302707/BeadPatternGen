# 实施状态

更新日期：2026-10-24  
当前阶段：**一期 S01–S15 完成。主体识别 C1–C6 / K1–K6 完成。二期 S16–S22 编辑器已落地。剩余任务 R1–R3、R5、R7–R9 完成；R4 / R6 缺外部数据未开工（见下）。**

规格来源：`docs/TECHNICAL_SPEC.md`（由 v1.1 `.docx` 原样转换）+ `实施导航.html`。

## 已完成

### S01–S12

见此前记录。色卡、工程骨架、BeadPattern、颜色科学、色卡索引、图片裁剪采样、抖动、诊断、模式策略、流水线 Worker、只读预览、分页几何均已落地。

### S13（Cursor 主导：PNG · 分页 PDF · CSV · JSON）

- 选型先写入 `docs/DEPENDENCY_DECISIONS.md`：`pdf-lib@1.17.1`（MIT）、`fast-png@8.0.0`（MIT）。
- PNG：格尺寸 8/16/24/32；颜色只取 `pattern.palette`；CPU 缓冲分带写入，不分配边长 > 8000 的 Canvas。
- PDF：制作版切片只调用 `computePages()`；A4 / A3 / Letter；预览版单页缩略；制作版按切片；末端清单分页。
- CSV：UTF-8 BOM（EF BB BF）；表头 `色号,色名,HEX,数量,占比`；末行合计。
- JSON：直接 `encodeProject`。
- `assertExportReady`：`sum(counts) !== nonEmptyCells` 时中断导出。

### S14（Cursor 主导：IndexedDB）

- 三 store：`projects` / `patterns` / `thumbnails`。格子用 `ArrayBuffer` / `Int16Array`，不转 JSON 字符串。
- 「已保存」只在事务 `oncomplete` 之后置位；失败回「未保存」，内存 Pattern 保留。
- 配额 80% 预警；可清理缩略图 / 导出后删除。
- JSON 导入：schema、尺寸、字符串长度、色卡索引；失败不改工作区。
- 刷新后从列表打开：无原图也能显示只读图纸。

### S15（Cursor 主导：隐私 · E2E · 一期验收）

- `src` 无 `fetch` / `axios` / `XMLHttpRequest` / `sendBeacon` / `WebSocket`。
- 去掉 Google Fonts CDN，系统字体。
- Playwright：主链路 + 取消后再生 + 外站请求为零。
- `docs/PHASE1_ACCEPTANCE.md`、`docs/KNOWN_LIMITATIONS.md`。
- 一期未做人工编辑器，这是范围设定，不是遗漏。

### C1（数据契约与存储扩展）

- `src/core/subject/types.ts`：SubjectMask / Subject / SubjectCandidate / CompositionParams /
  Composition / 分割 Worker 协议；`guards.ts` 覆盖全部运行时校验。
- `src/storage/`：DB_VERSION 1 → 2，新增 `subjects` / `compositions` 仓；蒙版以 Blob 存储，
  `createSubjectRepository()` 原子读写；迁移测试覆盖新库、v1 升级、重复打开。
- 契约说明：`docs/SUBJECT_COMPOSITION_CONTRACT.md`。

### C2（蒙版后处理与边界框）

- `src/core/subject/mask.ts`：去噪（8 邻域）/ 填孔（4 邻域）/ 保细节羽化 / 有效 bbox。
- 顺序固定：去噪 → 填孔 → bbox → 羽化；bbox 在羽化前计算，不被过渡像素撑大。
- 细结构保护：1 像素宽细线在默认参数下仍高于前景阈值。
- `src/core/subject/mask.test.ts`：28 个用例。

### C3（构图引擎）

- `src/core/composition/`：`computeCompositionPlan()` 纯几何换算（占比 / 定位 / 边距 /
  超界夹紧与 suggestion）；`composeImage()` 纯像素 RGBA 合成。
- 背景：transparent 保留 Alpha（透明像素 `(0,0,0,0)`）/ solid / image（cover）。
- 确定性：最近邻采样 + `COMPOSITION_ALGORITHM_VERSION = "1.0"`。
- `geometry.test.ts` + `compose.test.ts`：28 个用例。

### C4（浏览器端主体分割）

- 引入 `onnxruntime-web@1.30.0`（MIT）；模型 `u2netp`（Apache-2.0，4.4 MB，
  rembg 发布版），来源 / 体积 / 许可 / 校验和写入 `docs/DEPENDENCY_DECISIONS.md`。
- `src/core/subject/segmentation/`：模型清单、预处理（320×320 + CHW 归一化）、
  后处理（min-max + 上采样 + bbox / 置信度）、`runSegmentation()` 管线；不依赖 DOM。
- `src/workers/segmentation*`：模型加载（Cache Storage + 流式进度 + SHA-256）、
  ORT 会话（WASM，WebGPU 可选并自动回退）、图片解码、Worker 运行时与主线程客户端。
- 模型与 ORT wasm 均不随仓库分发；`pnpm models:download` / `pnpm ort:sync` 获取。
- 无 COOP/COEP 时强制单线程 WASM，真实浏览器冒烟通过；新页面命中缓存后模型请求为 0。
- 详见 `docs/SEGMENTATION.md`。

### C5（Alpha 与颜色量化专项）

- `src/core/pipeline/generate.ts` 在进入任何算法前解析透明策略：
  `empty`（保留透明）与 `background`（透明转纯色）语义固定，详见
  `docs/ALPHA_QUANTIZATION.md`。
- `empty`：`alpha < EMPTY_ALPHA_THRESHOLD(128)` 一律为空格；空格不参与选色、
  匹配、抖动、优化、诊断，其 RGB 完全不读取。全透明图输出 `beadCount = 0`
  的合法图纸（色卡按原顺序取前 `min(maxColors, size)` 个占位）。
- `background`：`alpha === 0` 的透明哨兵（构图层为 `(0,0,0,0)`）在任何计算前
  替换为背景色；缺省 `#FFFFFF`，大小写不敏感并持久化为大写。半透明格保留
  采样可见色，不做二次合成。
- 参数错误（未知策略、非法背景色、`maxColors < 1`）提前抛 `E_INVALID_SETTINGS`。
- `src/core/pipeline/alpha.test.ts`：15 个回归用例，固定“透明像素不得映射为
  黑色拼豆”红线（全透明图、半透明边缘、透明邻接深色主体、FS 抖动、两种模式，
  以及 C3 构图 → 采样 → 量化的真实链路）。

### C6（核心集成：detectSubjects / composePreview）

- `src/core/subject/detect.ts`：`detectSubjects()` 串起 C4 分割 → C2 后处理 → C1 落库；
  依赖注入，core 不 import Worker / 存储。
- `src/core/composition/preview.ts`：`composePreview()` 读取主体 → C3 合成 →（可选）保存构图记录。
- `src/core/subject/protocol.ts`：完整链路阶段（追加 `mask-cleanup` / `persist`）、
  任务状态与集成错误码收口（Mask / Composition / Storage 错误统一映射）。
- `src/workers/subject-service.ts`：单例分割客户端 + 主体仓库的浏览器接线；
  UI 不再直接创建 Worker 或打开 IDB。
- `src/core/subject/import.ts`：`importImage()` 预检；`imageIdFromBytes()` 对原图做 SHA-256
  内容寻址，同一文件跨刷新 / 再导入 id 不变。
- `detectSubjects()` 支持 `replaceExisting`：「重新识别」先删旧主体再写新记录。
- `src/features/subject-detect/`：默认真实 Worker；mock 只替换分割 runner，仍走 C2 后处理 + C1 落库。
  导入后先 `loadSubjectsWithMasksForImage()`，蒙版尺寸匹配则跳过分割。
- 构图确认：`persistSubjectMaskInBrowser`（无记录则新建）→ `composePreviewInBrowser` 保存构图参数，
  再采样并 `startGeneration()`。
- `src/state/subject-slice.ts` 已绑定到 `workspace-store`。
- 分割 Worker 已进入生产构建（`dist/assets/segmentation.worker-*.js`）。

### K1（图片导入 UI 增强）

- 状态机：`idle → uploading → decoding → detecting`（K1 交付时为占位；C6 已接入真实 Worker）。
- 预检错误归类：格式不支持 / 文件过大 / 分辨率过低（core `MIN_IMAGE_DIMENSION = 16`，`RESOLUTION_TOO_LOW`）/ 分辨率过高（`DIMENSION_LIMIT`）。

### K2–K6（UI）

- K2 主体选择、K3 构图工作台、K4 背景、K5 画笔、K6 状态收口与 Playwright E2E 已落地。
- 手动框选仍是占位入口（拆解文档约定，非拖框编辑器）。

### R1（图层与版本管理）

- `src/core/pattern/layers.ts`：`compositeCells`（overlay 空格透出基底）、
  `deriveOverlay`、`applyChangesToOverlay`（写回值等于基底视为透明，
  execute / undo / redo 共用）、`hasOverlayContent`；纯函数 **7 tests**。
- 工作区侧车：`baseCells`（只读基底）/ `overlayCells` / `refineVisible`，
  不进 schema 1.0 JSON；`applyGenerated` / `loadPattern` 以矩阵为基底建档，
  `restoreDraft` 从草稿恢复侧车。
- PatternBoard：精修层显示 / 隐藏开关（隐藏后画布、统计、诊断、导出都用基底）、
  「从基底还原精修层」（走 `executeCommand`，kind `restore-base`，可撤销；
  恢复格按既有规则标 locked）。
- `edit-drafts` 记录新增可选 `base` / `overlay` / `refineVisible`（旧草稿无字段
  → 展平，已在 KNOWN_LIMITATIONS 说明）；自动保存携带侧车。
- store 层 **6 tests**：合成顺序、隐藏精修层后可见矩阵（导出输入）=== 基底、
  undo/redo 跨显隐不破坏基底、还原可撤销、无差异时 no-op。
- 「版本副本」复用已有「另存副本」（副本为展平矩阵，无侧车）。

### R2（非正方形选区旋转与平移）

- `selection.ts` 新增 `rotateSelection(cells, indices, width, height, quarterTurns)`
  与 `translateSelection(...dx, dy)`，返回 `{ changes, clipped, selection }`：
  目标格覆盖、未接收新值的源格清 `EMPTY_CELL`、越出画布丢弃并报 `clipped`、
  选区随内容移动。不用 Math.random / Date。
- `EditKind` 新增 `translate` / `restore-base`。旧 `rotateSelectionCW` 保留
  （square 行为不变、原测试不动），UI「旋转」改用 `rotateSelection`。
- PatternBoard：新增上/下/左/右移 1 格（`data-testid="edit-move-*"`），
  全部走 `executeCommand`。
- **9 tests**：2×3 转 90° 宽高对调、180°/270°、归一化圈数、clipped、
  浮动选区平移往返复原、目标覆盖 / 源清空、移入格不清空、零位移。

### R3（无采样缓冲时的选区再生成）

- `src/features/pattern-preview/regen-sample.ts`：`resolveRegenCrop`（优先
  `pattern.source.crop`，夹紧到位图边界）+ `deriveRegenSample`（调用现有
  `sampleBitmapToGrid`，透明策略 / 背景色以图纸 settings 为准，未重写采样）。
- 按钮：`sample` 缺失但工作区有原图 → 点击时重采样再走 `regenSelection`；
  连原图都没有 → 按钮禁用 + title 文案「需要原图才能局部再生成」，
  派生失败时 setError（`E_REGEN_NO_SOURCE`），不静默失败。
- **4 tests**：crop 解析 / 兜底 / 夹紧 / 无图返回 null；纯函数层构造 rgb/alpha
  断言 locked 不被覆盖（`local-regen.test.ts` 原有用例保持）。

### R7（性能记时）

- `src/state/generation.ts` 记录任务发起时刻，完成时把真实耗时写进
  `GenerationProgressState.elapsedMs`；状态栏显示「生成完成 · 耗时 X.Xs」。
- `docs/manual/性能记时表.md`：P50/P95 记录模板 + 200×200 用 DevTools
  Performance 的说明；未实测留空，未写成 CI 门禁。

### R8（视觉盲测记录表）

- `docs/manual/视觉盲测记录表.md`：图类型 / 网格 / 模式 / 观察者 / 能拼不能拼
  部位 / 三选一结论；明确禁止 0–100 分、还原度百分比、ΔE 平均值。
- 两份表均已挂到 `docs/manual/README.md`。

### R9（WebGPU 回退冒烟）

- `segmentation.worker.ts` 会话建立后输出
  `[segmentation] 推理后端 provider=…`；WebGPU 推理失败回退 WASM 时输出
  warn 日志。
- `docs/SEGMENTATION.md` 6.1 节：本地命令（构建期 env）、后端确认方法、
  回退保证检查单；E2E / CI 仍走默认 WASM，不把 WebGPU 做成必过。

### R5（多主体 · 仅方案）

- `docs/PROPOSAL_MULTI_SUBJECT.md`：现有 Mask 契约下用连通域拆分显著性图的
  方案（阈值 / 最小面积 / 最多 N 个）、风险、3 个验收用例；明确这是后处理
  而非实例分割。未改 src。

### R4 / R6（缺外部数据，未改代码）

- R4 更大分割模型：`public/models/` 只有 u2netp.onnx，无新模型文件 →
  **缺模型，未改代码**。
- R6 自备色卡：未提供符合 S01 字段与许可的色卡 JSON → 未开工。

## 未完成

- 未 `git commit`（未要求提交）。
- MARD / Perler / 自备色卡未锁定。
- R4 / R6 等模型文件与色卡数据到位后单独开工。
- R5 等方案评审结论，未授权不实现。
- 性能记时表与盲测记录表为空模板，待人工实测填写。
- 真实 ONNX 路径未纳入 Playwright（E2E 用 `?mock-detection=1` 保隐私零外站请求）；本地冒烟走 `pnpm smoke:segmentation`。

## 风险

- R1 图层：「另存副本」与旧草稿为展平矩阵（无基底侧车）；隐藏精修层会改变
  可见矩阵并标记未保存（保存导出的即当前可见矩阵）。
- R2 平移/旋转的 clipped 像素会真正丢弃（值不可恢复），undo 可回退但重做后仍缺失。
- HEX 非 Artkal 官方色度。
- TypeScript 必须钉在 5.x。
- PNG 图例是色块；每格色号文字在制作版 PDF / CSV。
- PDF 用 Helvetica，中文色名以 CSV / JSON / 界面为准。
- 主包约 786 kB（含 pdf-lib），gzip 约 293 kB。
- 200×200 规格时限未写成失败门禁。
- 正方形图 EXIF 2/3/4 静默忽略问题仍在。
- 主体分割：u2netp 为单主体模型，不做实例分割；首次识别需下载 4.4 MB 模型，
  ORT wasm 27 MB（gzip 6.4 MB）；无 COOP/COEP 时单线程，实测约 3.5–4 s。
- WebGPU 路径已实现并带回退，但未纳入自动冒烟。

## 需要决策

1. contain 的留白语义是否接受。
2. 对照滑块把整块裁剪拉伸到整个网格。
3. 空采样失败而不是生成全空图纸。
4. 是否接受 PDF 图例不写 CJK 色名。

## 测试结果

S13：`pnpm typecheck` 通过；`pnpm vitest run src/export` **7 tests** 通过。  
S14/S15：`pnpm test` **16 files / 238 tests** 通过。

C1–C3：`pnpm typecheck` 通过；`pnpm lint` 通过；
`pnpm vitest run src/core src/storage` **18 files / 294 tests** 通过。
其中 C2 蒙版后处理 **28 tests**、C3 构图引擎 **30 tests**。

C4：`pnpm typecheck` 通过；`pnpm lint` 通过；
`pnpm test` **33 files / 382 tests** 通过；`pnpm build` 通过；
`pnpm vitest run src/core/subject/segmentation src/workers/segmentation`
**6 files / 40 tests** 通过。
`pnpm smoke:segmentation` 通过（真实照片：首次 3720 ms / 缓存命中 3509 ms，
模型请求 1 → 0，蒙版 1000×667，前景 162097 px，置信度 0.969）。

C5：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm build` 通过；
`pnpm test` **34 files / 397 tests** 通过（新增 `alpha.test.ts` 15 个红线用例）；
`pnpm vitest run src/core/pipeline` **2 files / 26 tests** 通过。

C6：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test` **38 files / 419 tests** 通过；
`pnpm build` 通过，产物含 `dist/assets/segmentation.worker-*.js`（425.60 kB）；
新增 `detect.test.ts`、`preview.test.ts`、`subject-flow.test.ts`（共 19 个用例），
覆盖检测 → 构图 → 采样 → 生成的直通路径与“透明不产生黑豆”红线。

> 此前 `src/features/image-import/import-classify.test.ts` 的文案失败已由 UI 侧修正，
> 全量用例当前无失败。

S15 门禁（本轮原始输出）：

- `pnpm lint`：通过（exit 0）
- `pnpm typecheck`：通过（exit 0）
- `pnpm test`：`Test Files 16 passed (16)` / `Tests 238 passed (238)`
- `pnpm test:e2e`：`3 passed`（privacy + 主链路 + 取消再生）
- `pnpm build`：通过（vite 287 modules）

失败用例：**无**。

隐私审查：`src` 对 `fetch|axios|XMLHttpRequest|sendBeacon|WebSocket` **零命中**。

浏览器：生产预览 `http://127.0.0.1:4175/` 可见导出入口、保存状态「未保存」、隐私说明、无画笔。完整上传→生成→保存→刷新→导出由 Playwright 走通。

## 测试结果（R 轮门禁原始输出）

- `pnpm lint`：通过（exit 0，无输出）。
- `pnpm typecheck`：通过（exit 0）。
- `pnpm test`：**Test Files 47 passed (47) / Tests 480 passed (480)**。
  其中新增：layers.test.ts 7、workspace-store.layers.test.ts 6、
  draft-repository 新增 2、regen-sample.test.ts 4、selection.test.ts 新增 9。
- `pnpm test:e2e`：**11 passed**（privacy + 主链路 + 取消再生 + compose 全套）。
- `pnpm build`：通过（vite 构建，segmentation.worker 与 ort wasm 产物正常）。

说明：E2E 两处 `toHaveText("生成完成")` 改为 `toContainText("生成完成")`，
因 R7 状态栏新增真实耗时后缀；断言意图（生成完成可判定）未变，
非为掩盖失败改断言。

失败用例：**无**。

## 下一步建议

1. 真实模型质量不够时按 R4 流程换 `model-manifest.json` 中的更大 u2net / isnet（需模型文件与许可）。
2. 授权数据到位后按 R6 流程加 MARD / Perler 或自备色卡。
3. R5 多主体方案评审（`docs/PROPOSAL_MULTI_SUBJECT.md`）通过后单独授权实现。
4. 人工填写性能记时表与盲测记录表。
