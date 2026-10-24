# Claude Code 任务提示词（C1–C6）

> 用法：按顺序逐个任务执行，每个任务完成并验证后再进入下一个。C1 必须最先完成。
> 配套约束见同目录 `00_功能拆解与分工.md`。

---

## C1 — 数据契约层与存储扩展（最先执行，是双方唯一契约源）

```text
你正在 d:\Tabletop\桌面项目BOX\拼豆 的纯前端拼豆图纸生成器中工作（React 19 + TS + Vite + Zustand +
Web Worker + IndexedDB，一期功能已落地）。现在开始"主体识别与智能构图"二期开发，本次只做 C1。

【目标】建立主体识别与构图的数据契约层，这是与另一协作方（负责 UI）的唯一契约源，类型定义必须完整、
自解释、带 JSDoc。

【任务】
1. 新建 src/core/subject/types.ts，定义：
   - SubjectMask：蒙版数据（宽高、Uint8ClampedArray 或压缩表示、来源模型与版本）
   - BBox：主体边界框（原图坐标系）
   - Subject：id、sourceImageId、mask 引用、bbox、confidence、label、createdAt
   - SubjectCandidate：分割模型的候选输出（含蒙版缩略引用）
   - CompositionParams：canvasWidth、canvasHeight、subjectScale、offsetX、offsetY、
     backgroundType（transparent | solid | image）、backgroundValue、margin、subjectLocked
   - Composition：CompositionParams + 关联 subjectId，可序列化
   - 分割任务与进度事件的类型（沿用 src/core/pipeline/protocol.ts 的消息风格）
2. 扩展 src/storage/：
   - 新增对象仓 subjects、compositions（DB_VERSION 递增，写迁移逻辑，保证旧数据不丢失）
   - 蒙版二进制以 Blob 存储，记录保存元数据与 Blob 引用；沿用 project-repository.ts 的封装风格
   - 组件不得直接打开 IDB
3. 写单元测试：迁移（旧版本库升级）、Blob 存取往返、类型守卫；可用现有 fake-indexeddb 依赖。
4. 运行 pnpm typecheck、pnpm lint、pnpm test 全部通过。

【约束】
- core 层不依赖 DOM。
- 不实现分割算法和 UI，只做契约与存储。
- 完成后在 docs/ 或本目录追加简短的契约说明（字段表 + 用途），供 UI 协作方直接阅读。
【验收】迁移安全、测试通过、契约文档可被另一方独立理解。
```

---

## C2 — 蒙版后处理与边界框

```text
延续同一项目（契约见 src/core/subject/types.ts，C1 已完成）。本次只做 C2：蒙版后处理与边界框。

【任务】
1. 新建 src/core/subject/mask.ts，纯函数实现：
   - 去噪：清除小面积孤立前景噪点（可配置面积阈值）
   - 填孔：填补蒙版内部明显孔洞（如透明饰品、纹理导致的空洞）
   - 边缘平滑：轻度抗锯齿 / 羽化，强度可配置，默认保守
   - 有效边界框：忽略孤立噪点计算 bbox；输出原图坐标系
   - 后处理管线可按步骤开关（smoothDenoise / fillHoles / feather 各自可选）
2. 全部纯 TypeScript、不依赖 DOM；输入输出用 C1 的类型。
3. Vitest 单元测试：合成蒙版用例（噪点、孔洞、贴近边缘主体、空蒙版、全前景），
   断言不可过度处理（发丝类细结构在保守参数下不被抹除）。
4. pnpm typecheck / lint / test 通过。

【验收】参数保守时细节保留，参数增强时噪点清除；测试覆盖边界场景。
```

---

## C3 — 构图引擎

```text
延续同一项目（契约见 src/core/subject/types.ts）。本次只做 C3：构图引擎。

【任务】
1. 新建 src/core/composition/：
   - 计算模块（纯函数）：根据源图尺寸、主体 bbox、CompositionParams 计算最终构图——
     裁切区域、主体缩放占比（subjectScale，如 0.5–0.9）、画布内定位（居中 / 偏上 / 偏下 / 左 / 右 /
     自由 offsetX offsetY）、自动边距（主体不贴边）、画布比例（1:1 / 竖版 / 横版）。
   - 合成模块：用 OffscreenCanvas 或纯像素运算输出合成结果（ImageData），
     背景支持 transparent（保留 Alpha）、solid（纯色）、image（自定义背景图，P1 可先留接口）。
   - 校验：主体蒙版必须完全位于画布范围内，超界时报明确错误或返回可修正建议。
2. Vitest 单元测试：占比换算、定位换算、边距、超界检测、透明背景 Alpha 保留
   （断言 Alpha=0 区域不被填充为黑色）。
3. pnpm typecheck / lint / test 通过。

【约束】不实现 UI 与模型调用；合成结果可直接交给现有 src/core/pipeline 作为输入图像。
【验收】同样输入与参数在算法版本一致时输出可重复（确定性），测试固化。
```

---

## C4 — 浏览器端主体分割（onnxruntime-web + Worker）

```text
延续同一项目。本次只做 C4：在浏览器端运行主体分割模型。

【任务】
1. 引入 onnxruntime-web（WASM 执行提供者，WebGPU 可选启用并带 WASM 回退）。
2. 选型落地：默认使用 rembg 生态、可量化的单主体背景移除模型（如 u2netp / isnet 量化版），
   模型文件放 public/models/（若体积大可用脚本下载并 gitignore），记录来源与许可证到 docs/。
3. 新建 src/core/subject/segmentation/：
   - 模型加载器：首次按需加载，Cache Storage 缓存；失败给出明确错误类型（沿用 core 的 errors 模式）
   - 预处理：大图先降采样到模型输入尺寸（记录映射），推理后上采样回原图坐标系
   - 推理封装：输入 ImageData / Blob，输出 SubjectMask（C1 类型）
4. 集成到 Web Worker（扩展 src/workers/ 或新增分割 worker）：
   - 推理不阻塞 UI；通过 postMessage 推送"加载模型 / 推理中 / 完成 / 失败"阶段与进度
   - 消息协议扩展遵循 src/core/pipeline/protocol.ts 的既有模式
5. 验证：真实图片冒烟（可用 Playwright 或手动脚本），确认输出蒙版合理；
   WASM 单线程回退路径可用（无 COOP/COEP 头时不得崩溃）。
6. pnpm typecheck / lint / test 通过；模型许可证、体积、来源写入 docs/DEPENDENCY_DECISIONS.md 或新文档。

【约束】不训练模型；不做多主体实例分割；不实现 UI。
【验收】典型单主体图片能产出可用蒙版；模型加载有缓存；失败路径有明确错误与重试入口（协议层）。
```

---

## C5 — Alpha 与颜色量化专项

```text
延续同一项目。本次只做 C5：透明像素与颜色量化的正确性专项。

【背景】现有 src/core/pipeline/generate.ts 以 RGB 为主。二期会输入带 Alpha 的构图结果
（透明背景），验收红线：透明区域不得被映射为黑色拼豆。

【任务】
1. 审查 pipeline 从采样到颜色映射对 Alpha 的处理路径，找出透明 / 半透明像素会被如何处理
   （是否被当成黑色、是否参与抖动、是否污染邻域误差扩散）。
2. 定义并实现正确行为：与 UI 协作方约定两种模式——
   a) 透明背景强制转纯色（如白色）再量化（默认，安全）；
   b) 保留透明的输出模式（如适用），透明格不消耗豆子、不参与误差扩散。
   行为写入代码注释与 docs。
3. Vitest 测试：全透明图、半透明边缘、透明区域邻接深色主体等用例，固化红线行为。
4. pnpm typecheck / lint / test 通过。

【验收】透明区域在两种模式下都符合定义行为；测试作为长期回归红线。
```

---

## C6 — 核心集成（detectSubjects / composePreview）

```text
延续同一项目（C1–C5 已完成）。本次只做 C6：把各模块组装成第 8 章定义的函数契约。

【任务】
1. 组装（建议新建 src/core/subject/index.ts 与 src/core/composition/index.ts 的门面）：
   - importImage → 沿用 src/core/image/validate，返回预检结果与 imageId
   - detectSubjects(image) → 分割 worker 调用 + C2 后处理 + C1 存储，返回 Subject[]
   - composePreview(subjectId, CompositionParams) → C3 构图引擎 + 存储，返回合成结果
   - generatePattern 对接：构图结果直接作为现有 pipeline 输入（不重复实现已有功能）
2. 扩展 Worker 消息协议（阶段、进度、taskId、错误码），保持与 protocol.ts 风格一致。
3. 状态接线支持：在 src/state/ 预定义 subject / composition 相关 store 切片类型（只定义类型与
   默认值，不接 UI），并在契约文档中登记，供 UI 协作方绑定。
4. 集成测试：mock 模型输出跑通 detect → compose → generate 全链路（Vitest）。
5. pnpm typecheck / lint / test 通过；更新契约文档。

【验收】全链路集成测试通过；UI 协作方仅需替换 mock 数据源即可接入真实数据。
```
