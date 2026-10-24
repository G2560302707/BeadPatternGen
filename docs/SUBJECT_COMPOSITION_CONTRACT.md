# 二期契约说明 · 主体识别与智能构图（C1–C6 交付）

> 代码入口：`src/core/subject/`（类型 + 守卫 + 蒙版后处理 + 分割算法 + 检测装配）、
> `src/core/composition/`（构图引擎 + 预览装配）、`src/workers/segmentation*`（Worker 与客户端）、
> `src/workers/subject-service.ts`（浏览器接线）、`src/storage/subject-repository.ts`（持久化）。
> 本文是 Claude Code（核心层）与 Cursor（UI 层）之间的接口约定。
> 第一至六节为 C1 数据契约与存储；第七节为 C2 蒙版后处理；第八节为 C3 构图引擎；
> 第九节为 C4 分割算法与 Worker 接入；第十节为 C6 核心集成；第十一节为验收与测试。
> 分割算法（C4）与核心集成（C6）均已接线，识别默认走真实 Worker。
> 最后更新：2026-10-24。

## 一、通用约定

| 约定      | 内容                                                                  |
| --------- | --------------------------------------------------------------------- |
| id        | 非空字符串，调用方生成，推荐 `crypto.randomUUID()`                    |
| 时间      | ISO 8601 字符串，如 `new Date().toISOString()`                        |
| 坐标系    | 蒙版、`bbox` 一律使用**原图像素坐标系**，原点左上角                   |
| 蒙版编码  | `raw-alpha8`：每像素 1 字节、行优先、`data.length === width × height` |
| 前景判定  | `data[i] > threshold` 视为主体像素                                    |
| core 约束 | `src/core/subject/` 不引用 DOM 类型，像素只用 typed array             |

## 二、核心类型（`src/core/subject/types.ts`）

### 2.1 `BBox`

| 字段               | 类型     | 说明                           |
| ------------------ | -------- | ------------------------------ |
| `x` / `y`          | `number` | 左上角坐标，原图像素，非负整数 |
| `width` / `height` | `number` | 尺寸，正整数                   |

### 2.2 `SubjectMask`

| 字段               | 类型                   | 说明                                              |
| ------------------ | ---------------------- | ------------------------------------------------- |
| `sourceImageId`    | `string`               | 所属原图 id，用于校验不串图                       |
| `width` / `height` | `number`               | 必须与当前处理版本的原图尺寸一致                  |
| `encoding`         | `"raw-alpha8"`         | 目前唯一取值；压缩编码为后续扩展点                |
| `data`             | `Uint8ClampedArray`    | 前景置信度 0–255，长度 `width × height`           |
| `threshold`        | `number`               | 0–255，默认 `DEFAULT_MASK_THRESHOLD = 128`        |
| `model`            | `SegmentationModelRef` | `{ id, version, license? }`，结果复现与许可证追溯 |
| `createdAt`        | `string`               | ISO 时间                                          |

> UI 叠加预览直接用 `data`；需要上屏时把 1 字节置信度映射到 RGBA（例如前景 `#3B82F6`、Alpha = `data[i]`）。

### 2.3 `Subject`（已落库的元数据）

| 字段            | 类型     | 说明                                                             |
| --------------- | -------- | ---------------------------------------------------------------- |
| `id`            | `string` | 主体 id                                                          |
| `sourceImageId` | `string` | 来源图片 id                                                      |
| `maskId`        | `string` | **蒙版存储键**，用 `subjectRepository.loadMask(maskId)` 取回像素 |
| `bbox`          | `BBox`   | 有效边界框（已忽略孤立噪点）                                     |
| `confidence`    | `number` | 0–1                                                              |
| `label`         | `string` | 二期固定 `SUBJECT_LABEL_MAIN = "main-subject"`                   |
| `createdAt`     | `string` | ISO 时间                                                         |

`SubjectWithMask extends Subject` 额外带 `mask: SubjectMask`，仅在需要像素时使用。
**列表 / Zustand state 里只放 `Subject`，不要放 `SubjectMask`**，避免大数组进入响应式状态。

### 2.4 `SubjectCandidate`（模型候选，未落库）

| 字段            | 类型               | 说明                                       |
| --------------- | ------------------ | ------------------------------------------ |
| `id`            | `string`           | 候选 id                                    |
| `sourceImageId` | `string`           | 必须与 `mask.sourceImageId` 一致           |
| `mask`          | `SubjectMask`      | 完整蒙版，供 UI 立即叠加                   |
| `thumbnail?`    | `MaskThumbnailRef` | 缩略蒙版引用 `{ id, width, height }`，可选 |
| `bbox`          | `BBox`             | 候选边界框                                 |
| `confidence`    | `number`           | 0–1                                        |
| `label`         | `string`           | 同上                                       |
| `createdAt`     | `string`           | ISO 时间                                   |

候选 → 落库：`saveSubject(subject, mask)`；`maskId` 由调用方生成并写入 `Subject.maskId`。

### 2.5 `CompositionParams`

单位全部与具体像素解耦，UI 在不同缩放下拖拽时直接改归一化值即可。

| 字段                           | 类型                                  | 说明                                                                  |
| ------------------------------ | ------------------------------------- | --------------------------------------------------------------------- |
| `canvasWidth` / `canvasHeight` | `number`                              | 画布像素尺寸，正整数                                                  |
| `subjectScale`                 | `number`                              | 主体最长边占"画布内容区"的比例，`(0, 1]`，常用 0.5–0.9                |
| `offsetX`                      | `number`                              | 主体中心相对画布中心的水平偏移，单位 = 画布宽度，`[-1, 1]`，正值向右  |
| `offsetY`                      | `number`                              | 同上，单位 = 画布高度，正值向下                                       |
| `backgroundType`               | `"transparent" \| "solid" \| "image"` | 透明 / 纯色 / 自定义图片（image 为 P1 预留）                          |
| `backgroundValue`              | `string \| null`                      | transparent → `null`；solid → `#RRGGBB`；image → 资源 id              |
| `margin`                       | `number`                              | 主体到画布边缘的最小留白，单位 = `min(画布宽, 高)` 的比例，`[0, 0.5]` |
| `subjectLocked`                | `boolean`                             | true 时 UI 禁止拖动 / 缩放                                            |

默认值（UI 可直接作为初始 state）：

```ts
import { DEFAULT_COMPOSITION_PARAMS } from "@/core/subject";

DEFAULT_COMPOSITION_PARAMS;
// { canvasWidth: 1024, canvasHeight: 1024, subjectScale: 0.7,
//   offsetX: 0, offsetY: 0, backgroundType: "transparent",
//   backgroundValue: null, margin: 0.05, subjectLocked: true }
```

### 2.6 `Composition`（可序列化持久对象）

| 字段                      | 类型                | 说明                    |
| ------------------------- | ------------------- | ----------------------- |
| `schemaVersion`           | `"1.0"`             | 固定                    |
| `id`                      | `string`            | 构图 id                 |
| `subjectId`               | `string`            | 关联主体                |
| `sourceImageId`           | `string`            | 冗余来源图 id，便于检索 |
| `params`                  | `CompositionParams` | 完整参数                |
| `createdAt` / `updatedAt` | `string`            | ISO 时间                |

> 合成像素不落库。需要预览时由 C3 按 `params` 重算，保证同输入 + 同算法版本输出确定。

## 三、分割 Worker 消息协议

沿用 `src/core/pipeline/protocol.ts` 的 `type + taskId + progress/done/error` 风格：

```ts
// 主线程 → Worker
{ type: "segment-subject", taskId: number, payload: SegmentationInput }
{ type: "cancel", taskId: number }

// Worker → 主线程
{ type: "progress", taskId, stage, done, total }
{ type: "done", taskId, sourceImageId, candidates: SubjectCandidate[] }
{ type: "error", taskId, code, message, recoverable }
```

阶段：`load-model`（加载模型，字节进度）→ `preprocess` → `inference` → `postprocess`。
中文标签使用 `SEGMENTATION_STAGE_LABELS`。

`SegmentationInput`：`sourceImageId`、`imageBytes: Uint8Array`（原图编码字节，可 Transferable）、
`mimeType`、可选 `maxCandidates`（默认 1）、可选 `modelId`。

错误码：`E_MODEL_LOAD_FAILED` / `E_MODEL_UNSUPPORTED` / `E_INFERENCE_FAILED` /
`E_NO_SUBJECT` / `E_INPUT_INVALID` / `E_CANCELLED`。
`recoverable = false` 时 UI 不再给"重试"按钮。

**落地前请用守卫校验，并自行比对 `taskId`**（沿用 `createMessageGate`）：

```ts
import { isSegmentationWorkerResponse } from "@/core/subject";

worker.onmessage = (event) => {
  const message = event.data;
  if (message.taskId !== currentTaskId) return; // 过期响应直接丢弃
  if (!isSegmentationWorkerResponse(message)) return; // 结构不符直接丢弃
  // switch (message.type) { ... }
};
```

## 四、类型守卫（`src/core/subject/guards.ts`）

| 守卫                                    | 用途                                     |
| --------------------------------------- | ---------------------------------------- |
| `isBBox`                                | bbox 非负整数 + 正尺寸                   |
| `isSubjectMask`                         | 蒙版结构、尺寸自洽、阈值 / 时间合法      |
| `isSubject` / `isSubjectWithMask`       | 主体元数据；后者额外校验蒙版属于同一原图 |
| `isSubjectCandidate`                    | 候选结构，含缩略引用与来源图一致性       |
| `isCompositionParams` / `isComposition` | 构图参数值域 + 背景类型联动              |
| `isSegmentationWorkerResponse`          | Worker 三类响应统一校验                  |

所有守卫都是纯函数，可直接用于 Worker 消息、IndexedDB 读取、导入 JSON 的入口。

## 五、存储（`src/storage/`）

### 5.1 版本与迁移

- `DB_VERSION` 由 **1 → 2**。新增 `subjects`、`compositions` 两个对象仓。
- 迁移只做增量：`oldVersion < 2` 时创建新仓与索引，**不读写、不删除旧仓**，一期项目数据原样保留。
- `subjects` 仓索引：`by-kind`、`by-source-image`。
- `compositions` 仓索引：`by-subject`、`by-updated-at`。
- 升级逻辑集中在 `migrateDatabase()`，有独立的迁移测试（新建库 / v1 升级 / 重复打开）。

### 5.2 `subjects` 仓的记录结构

同一个仓内两类记录，用 `kind` 区分（也允许 `by-kind` 索引过滤）：

```text
{ kind: "subject", id, sourceImageId, maskId, bbox, confidence, label, createdAt }
{ kind: "mask", id, sourceImageId, width, height, encoding, threshold,
  model, blob: Blob, byteLength, createdAt }
```

- 蒙版像素编码为 `Uint8Array` 后以 **Blob** 存储，记录同时保存 `byteLength` 与模型元数据。
- 主体记录通过 `maskId` 引用蒙版记录；列表查询返回的永远是 `Subject`，不会携带 Blob。
- `saveSubject` 在一个事务内原子写入元数据 + 蒙版；`removeSubject` 同时删除两者。
- id 冲突（例如 `maskId` 撞上另一个主体的 `id`）会抛 `E_ID_CONFLICT`，不会覆盖已有记录。

### 5.3 仓库 API（`createSubjectRepository(factory?)`）

| 方法                           | 返回              | 说明                                   |
| ------------------------------ | ----------------- | -------------------------------------- |
| `saveSubject(subject, mask)`   | `Subject`         | 校验后原子写入                         |
| `loadSubject(id)`              | `SubjectWithMask` | 元数据 + Blob 转回 `Uint8ClampedArray` |
| `listSubjects(sourceImageId?)` | `Subject[]`       | 按来源图过滤，按 `createdAt` 升序      |
| `removeSubject(id)`            | `void`            | 幂等删除                               |
| `loadMask(maskId)`             | `SubjectMask`     | 单独读取蒙版                           |
| `saveComposition(composition)` | `Composition`     | 校验后写入                             |
| `loadComposition(id)`          | `Composition`     | 缺失抛 `E_NOT_FOUND`                   |
| `listCompositions(subjectId?)` | `Composition[]`   | 按 `updatedAt` 降序                    |
| `removeComposition(id)`        | `void`            | 幂等删除                               |

错误统一用 `StorageError`（`code` 字段）：
`E_SUBJECT_INVALID`、`E_COMPOSITION_INVALID`、`E_ID_CONFLICT`、`E_CORRUPT_RECORD`、
`E_NOT_FOUND`、`E_IDB_UNAVAILABLE`。

**组件不得直接打开 IndexedDB**，一律经由 `defaultSubjectRepository.get()` 或
`createSubjectRepository(factory)`（测试注入 `fake-indexeddb`）。

## 六、UI 接入示例（假数据 → 真数据）

```ts
import {
  DEFAULT_COMPOSITION_PARAMS,
  SUBJECT_LABEL_MAIN,
  isSubjectCandidate,
  type Subject,
} from "@/core/subject";
import { defaultSubjectRepository } from "@/storage/subject-repository";

// 1. 用假蒙版搭界面（无需等模型）：直接构造 SubjectCandidate
const mockMask = {
  sourceImageId: "img-1",
  width: 320,
  height: 240,
  encoding: "raw-alpha8" as const,
  data: new Uint8ClampedArray(320 * 240).fill(255),
  threshold: 128,
  model: { id: "mock", version: "0" },
  createdAt: new Date().toISOString(),
};
const mockCandidate = {
  id: "cand-1",
  sourceImageId: "img-1",
  mask: mockMask,
  bbox: { x: 0, y: 0, width: 320, height: 240 },
  confidence: 1,
  label: SUBJECT_LABEL_MAIN,
  createdAt: new Date().toISOString(),
};
isSubjectCandidate(mockCandidate); // true

// 2. 真实数据接入后：保存主体
const subject: Subject = {
  id: "s1",
  sourceImageId: "img-1",
  maskId: "mask-1",
  bbox: mockCandidate.bbox,
  confidence: 1,
  label: SUBJECT_LABEL_MAIN,
  createdAt: new Date().toISOString(),
};
await defaultSubjectRepository.get().saveSubject(subject, mockMask);

// 3. 构图：state 只存参数，不存像素
const params = { ...DEFAULT_COMPOSITION_PARAMS, subjectScale: 0.8 };
```

## 七、C2 · 蒙版后处理与有效边界框（`src/core/subject/mask.ts`）

```ts
import {
  postProcessMask,
  computeMaskBBox,
  denoiseMask,
  fillMaskHoles,
  featherMask,
  DEFAULT_MASK_POST_PROCESS,
} from "@/core/subject";
```

| API                                 | 返回                                              | 说明                                   |
| ----------------------------------- | ------------------------------------------------- | -------------------------------------- |
| `postProcessMask(mask, options?)`   | `{ mask, bbox, removedComponents, filledPixels }` | 完整管线：去噪 → 填孔 → 算 bbox → 羽化 |
| `computeMaskBBox(mask, threshold?)` | `BBox \| null`                                    | 只算阈值边界；空蒙版返回 `null`        |
| `denoiseMask(mask, minArea)`        | `SubjectMask`                                     | 清除面积小于 `minArea` 的前景连通块    |
| `fillMaskHoles(mask, maxArea)`      | `SubjectMask`                                     | 填充面积不超过 `maxArea` 的封闭孔洞    |
| `featherMask(mask, radius)`         | `SubjectMask`                                     | 保细节的边缘羽化                       |

默认参数（`DEFAULT_MASK_POST_PROCESS`）：`smoothDenoise: true` / `denoiseMinArea: 8` /
`fillHoles: true` / `fillHolesMaxArea: 16` / `feather: true` / `featherRadius: 1`。

语义约定（实现契约，改动需同步测试）：

- 前景判定严格大于阈值：`data[i] > threshold`。
- 去噪用 **8 邻域**（斜向发丝不被拆碎）；填孔用 **4 邻域**（斜缝不算封闭孔洞）。
- `bbox` 在羽化**之前**计算，因此羽化不会把边界框撑大；需要羽化后的范围请再调用
  `computeMaskBBox(result.mask)`。
- 羽化保细节：原前景像素最多向模糊值混合 25%，且不低于 `threshold + 1`；
  原背景像素的羽化结果封顶到 `threshold`。1 像素宽的细线不会被抹除。
- 所有函数不修改入参；错误统一为 `MaskError`，`code` 为
  `INVALID_MASK` / `INVALID_OPTIONS`。

## 八、C3 · 构图引擎（`src/core/composition/`）

```ts
import { computeCompositionPlan, composeImage } from "@/core/composition";

const plan = computeCompositionPlan(sourceWidth, sourceHeight, subject.bbox, params);
const { image, plan: samePlan } = composeImage({
  source, // { width, height, data: Uint8ClampedArray }，RGBA 直通 alpha
  mask, // SubjectMask，尺寸必须与 source 一致
  bbox: subject.bbox,
  params,
  backgroundImage, // 仅 backgroundType === "image" 时需要
});
```

### 8.1 `computeCompositionPlan`

纯几何、不读像素，UI 可先用它画参考线。

| 输出字段      | 含义                                                   |
| ------------- | ------------------------------------------------------ |
| `contentRect` | 画布四边各内缩 `margin` 后的内容区                     |
| `crop`        | 源图裁剪区域（= 主体 bbox）                            |
| `desiredRect` | 按 offset 算出的期望矩形（未夹紧）                     |
| `subjectRect` | 最终矩形，已夹紧到内容区，**保证不越界**               |
| `scale`       | 画布像素 / 源图像素                                    |
| `adjusted`    | 是否发生夹紧                                           |
| `suggestion`  | 可写回参数面板的 `offsetX / offsetY`（夹紧后的等效值） |
| `overflow`    | 期望矩形相对画布四边的溢出像素数（用于提示"已贴边"）   |

换算规则：

```text
marginPx      = round(margin × min(canvasWidth, canvasHeight))
content       = 画布四边各内缩 marginPx
targetLongest = subjectScale × min(content.width, content.height)
scale         = targetLongest / max(bbox.width, bbox.height)
中心           = 画布中心 + (offsetX × canvasWidth, offsetY × canvasHeight)
```

错误：`E_SOURCE_INVALID` / `E_BBOX_INVALID` / `E_PARAMS_INVALID` / `E_MARGIN_TOO_LARGE`。

### 8.2 `composeImage`

| 背景类型      | 输出像素语义                                                              |
| ------------- | ------------------------------------------------------------------------- |
| `transparent` | 主体外 `(0,0,0,0)`；主体 alpha = `mask × sourceAlpha / 255`；RGB 保持原色 |
| `solid`       | 画布不透明，主体与纯色做 source-over                                      |
| `image`       | 背景图按 **cover**（等比铺满、居中裁切）映射；背景 alpha 先合成到白色     |

- 蒙版置信度直接作为 alpha 权重（保留 C2 羽化过渡）；噪点由 C2 负责清理。
- 采样固定为最近邻，算法版本 `COMPOSITION_ALGORITHM_VERSION = "1.0"`；
  同输入 + 同版本逐字节确定。
- 输出 `image` 结构兼容 `ImageData`（`width` / `height` / `data`），
  C6 在 Worker 边界转成 `ImageData` 后即可交给现有 `sampleToGrid` / pipeline。
- **透明背景的量化语义见 `docs/ALPHA_QUANTIZATION.md`**：`(0,0,0,0)` 在
  `empty` 策略下成为空格（-1），在 `background` 策略下被替换为背景色；
  两种模式下都不会生成黑色拼豆。C6 不得在集成层重新实现该判定。

## 九、C4 · 分割算法与 Worker（`src/core/subject/segmentation/`、`src/workers/segmentation*`）

完整架构、缓存策略与实测数据见 `docs/SEGMENTATION.md`；本节只列对接面。

### 9.1 主线程客户端（推荐 UI 直接使用）

```ts
import { SegmentationClient } from "@/workers/segmentation-client";

const client = new SegmentationClient();

const candidates = await client.segment(
  {
    sourceImageId: image.id,
    imageBytes, // Uint8Array：原始 PNG / JPEG 字节
    mimeType: image.mimeType,
    // modelId?: string  默认 "u2netp"
  },
  {
    onProgress: ({ stage, done, total }) => {
      // stage: load-model | preprocess | inference | postprocess
      // 中文标签见 SEGMENTATION_STAGE_LABELS[stage]
    },
  },
);

client.cancel(); // 取消进行中的任务（回 E_CANCELLED）
client.dispose(); // 终止 Worker
```

| 方法                       | 返回                          | 说明                          |
| -------------------------- | ----------------------------- | ----------------------------- |
| `segment(input, options?)` | `Promise<SubjectCandidate[]>` | 第二次调用会取消上一次        |
| `cancel()`                 | `void`                        | 幂等；无进行中任务时无副作用  |
| `dispose()`                | `void`                        | 终止 Worker，之后实例不可再用 |

- `imageBytes` 在客户端**复制**后转移，调用方数组不会被 detach。
- 失败统一抛 `SegmentationError`，字段 `code` / `message` / `recoverable`。
- 当前模型只产出一个候选（单主体）。

### 9.2 纯计算入口（测试 / Worker 之外）

```ts
import { runSegmentation, getSegmentationModelSpec } from "@/core/subject";

const candidate = await runSegmentation({
  image, // { width, height, data: Uint8ClampedArray }
  sourceImageId: "img-1",
  model: getSegmentationModelSpec(), // 或自定义规格
  session, // { provider, run(Float32Array) => Float32Array }
  onProgress: (stage, done, total) => {},
  shouldCancel: () => false,
});
```

`session` 是抽象接口，C6 的集成测试、K 层演示都可以注入假会话，不需要 ORT。

### 9.3 输出语义

- 蒙版尺寸 = 原图尺寸（内部 320×320 推理后双线性上采样）。
- 前景判定、`threshold`、`model`、`createdAt` 与 C1 `SubjectMask` 完全一致。
- **不做**去噪 / 填孔 / 羽化：C6 应先 `runSegmentation()`，再
  `postProcessMask()`（C2），最后落库或交给 C3。
- 前景占比低于 `DEFAULT_MIN_FOREGROUND_RATIO`（0.05%）抛 `E_NO_SUBJECT`。

### 9.4 C6 串联顺序（已实现）

下述顺序已固化在 `detectSubjects()` 内，UI 不再自行拼接：

```text
原始图片字节
  → detectSubjects()
  → SegmentationClient.segment()            # C4
  → postProcessMask(candidate.mask)         # C2（去噪 / 填孔 / bbox / 羽化）
  → saveSubject()                           # C1 存储
  → Subject[] + 后处理后的 SubjectCandidate[]
  → composeImage() / composePreview()       # C3
```

## 十、C6 · 核心集成

### 10.1 `detectSubjects(input, deps)` — `src/core/subject/detect.ts`

纯函数装配，不 import DOM / Worker / 存储；浏览器与测试各自注入依赖。

| 参数（`DetectSubjectsInput`） | 类型       | 说明                                             |
| ----------------------------- | ---------- | ------------------------------------------------ |
| `sourceImageId`               | `string`   | 必填；所有候选 / 主体的来源图 id                 |
| `imageBytes`                  | `Uint8Array` | 必填；原图编码字节（PNG / JPEG / WebP）        |
| `mimeType`                    | `string`   | 必填；与字节一致                                 |
| `modelId` / `maxCandidates`   | 可选       | 透传给 C4；二期候选上限默认 1                    |
| `persist`                     | `boolean`  | 缺省 `true`；`false` 只检测不落库（预览 / 测试） |
| `replaceExisting`             | `boolean`  | 缺省 `false`；`true` 时落库前先删除同一 `sourceImageId` 的旧主体 |

| 依赖（`DetectSubjectsDeps`） | 说明                                                       |
| ---------------------------- | ---------------------------------------------------------- |
| `segment`                    | 必填；生产为 `SegmentationClient.segment`，测试可注入假实现 |
| `saveSubject`                | 可选；不传则跳过 C1 落库                                   |
| `listSubjects` / `removeSubject` | 可选；仅在 `replaceExisting: true` 时需要，用于清理旧记录 |
| `postProcess`                | 可选；缺省使用 C2 保守默认值                               |
| `taskId`                     | 可选；进度事件携带，UI 用它过滤过期任务                    |
| `onProgress`                 | 可选；接收完整链路阶段（见 10.4）                          |
| `createId` / `now`           | 可选；测试注入确定性 id / 时间                             |

返回值：

| 字段               | 说明                                                    |
| ------------------ | ------------------------------------------------------- |
| `candidates`       | 后处理后的候选（蒙版已被 C2 改写，bbox 已重算）         |
| `subjects`         | 已落库的 `Subject[]`；未落库时为空数组                  |
| `postProcessed`    | 每个候选的去噪 / 填孔统计                               |
| `droppedCandidates`| 后处理后整块消失、被丢弃的候选数                        |
| `replaced`         | `replaceExisting: true` 时被删除的旧主体；否则空数组     |

约定：

- 候选 id 直接复用为 `Subject.id`，UI 选中候选后可零映射查到落库记录；
- 蒙版使用独立 `maskId`（`createId()`），避免与主体 id 撞键；
- 去噪后没有任何前景的候选被丢弃；全部丢弃时抛 `E_NO_SUBJECT`。
- `replaceExisting: true` 会在分割**成功后**、写入新记录**前**删除旧主体，
  因此即使新识别失败，旧记录仍然完好；删除本身失败会抛 `E_STORAGE_FAILED`。

### 10.2 `composePreview(input, deps)` — `src/core/composition/preview.ts`

```text
loadSubject(subjectId) → composeImage() → saveComposition()（可选）
```

- 返回 `{ subject, composition, image, plan }`；`image` 可直接上屏或交给 `sampleToGrid`。
- `composition` 固定 `schemaVersion: "1.0"`；更新已有构图时传 `compositionId` / `createdAt`，
  不覆盖原记录的创建时间。
- 合成像素不落库，按参数可重算（同输入 + 同算法版本逐字节一致）。
- 存储依赖同样注入：`loadSubject` 必填，`saveComposition` 可选。

### 10.3 浏览器接线 — `src/workers/subject-service.ts`

UI 只调用以下函数，不直接 `new Worker`、不直接开 IDB：

| 函数                                   | 说明                                                     |
| -------------------------------------- | -------------------------------------------------------- |
| `detectSubjectsInBrowser(options)`     | 单例 `SegmentationClient` + `defaultSubjectRepository`   |
| `composePreviewInBrowser(options)`     | 读取主体 → C3 合成 →（缺省）保存构图记录                 |
| `listSubjectsForImage(sourceImageId)`  | 某张图已保存的主体元数据                                 |
| `loadSubjectsWithMasksForImage(sourceImageId)` | 含蒙版的主体，供再导入跳过分割                    |
| `persistSubjectMaskInBrowser(candidate)` | 写回或新建主体记录；IDB 不可用时返回 `false`           |
| `cancelSubjectDetectionInBrowser()`    | 取消当前识别，Promise 以 `E_CANCELLED` 拒绝               |
| `disposeSubjectDetectionInBrowser()`   | 终止 Worker，释放模型内存                                 |

### 10.3.1 `importImage()` — `src/core/subject/import.ts`

第 8 章的图片预检入口：字节 → 魔数 / 尺寸 / 大小校验 → 稳定 `imageId`。
**不做解码**（解码是 `features/image-import/decode-image.ts` 的职责），
因此没有 DOM 依赖。

| 输入               | 类型          | 说明                          |
| ------------------ | ------------- | ----------------------------- |
| `imageBytes`       | `Uint8Array`  | 必填；原图编码字节            |
| `fileName`         | `string?`     | 仅用于错误文案，不参与校验    |
| `createId`         | `() => string` | 缺省随机生成；生产请传入 `imageIdFromBytes()` |

`imageIdFromBytes(bytes)` 对原图做 SHA-256，得到 `img-` + 64 位 hex，跨会话稳定。
`mimeTypeForFormat()` 把校验格式映射为 Worker MIME。

返回 `{ imageId, format, dimensions, byteLength }`；头部不完整（例如截断 JPEG）时
`dimensions` 为 `null`，但文件仍可交给解码器判断。
错误沿用 C1 的 `ImageImportError`（`EMPTY_FILE` / `FILE_TOO_LARGE` /
`UNSUPPORTED_FORMAT` / `DIMENSION_LIMIT` / `RESOLUTION_TOO_LOW`），短边低于 16px 为后者。

`imageId` 是后续 `detectSubjects()` 的 `sourceImageId`。

### 10.3.2 `getSubjects(imageId)`

即 `listSubjectsForImage(sourceImageId)`：按 `sourceImageId` 返回已落库的主体元数据
（不含蒙版像素），按 `createdAt` 升序。恢复预览用 `loadSubjectsWithMasksForImage()`。

导入 UI 会先查库：同一内容哈希且蒙版尺寸匹配则跳过分割。

### 10.4 完整链路协议与错误码 — `src/core/subject/protocol.ts`

阶段在 C4 四段之后追加两个主线程阶段：

```text
load-model → preprocess → inference → postprocess → mask-cleanup → persist
```

- 进度事件统一为 `{ taskId, stage, done, total }`，落地前必须比对 `taskId`。
- 任务状态：`pending | running | succeeded | failed | cancelled`（对应架构文档 8.1）。
- 错误码收口为 `SubjectIntegrationError`：

| 来源                         | 对外 code              | recoverable           |
| ---------------------------- | ---------------------- | --------------------- |
| C4 `SegmentationError`       | 原样保留六个 `E_*`     | 原样保留              |
| C2 `MaskError`               | `E_SUBJECT_INVALID`    | `false`               |
| C3 `CompositionError`        | `E_COMPOSITION_FAILED` | `true`                |
| C1 `StorageError`            | `E_STORAGE_FAILED`     | 记录损坏 / 不可用时为 `false` |
| 未知异常                     | `E_INTEGRATION_FAILED` | `true`                |

### 10.5 UI 接入与状态切片

- `src/features/subject-detect/detect-session.ts`：导入走 `restoreOrDetectSubjects()`，
  能恢复则跳过分割；否则 `detectSubjectsInBrowser()`（过期任务与 `E_CANCELLED` 静默丢弃）。
  首次识别 `replaceExisting: false`；「重新识别」为 `true`。
- mock 仅作为显式降级：`VITE_SUBJECT_DETECTION=mock` 或 `?mock-detection=1`。
  mock runner 只替换 C4，后处理 / 落库 / `composePreview` 与真实一致。
- `image-input.ts`：有未旋转原字节则直接交给 Worker；否则从已纠正位图重编码。
- `subject-slice.ts` 已绑定；`subjectProgress.stage` 含 `mask-cleanup` / `persist`。
- 构图确认：`persistSubjectMaskInBrowser` → `composePreviewInBrowser` → 采样 → `generatePattern`。

## 十一、验收与测试

C1–C3 交付时以下命令全部通过：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

对应测试：

- `src/core/subject/guards.test.ts`：全部守卫的正常 / 异常用例。
- `src/core/subject/mask.test.ts`：噪点、孔洞、贴边、空 / 全前景、细结构保留、羽化、开关与校验。
- `src/core/composition/geometry.test.ts`：占比、定位、边距、margin 上限、超界夹紧与建议。
- `src/core/composition/compose.test.ts`：透明 Alpha 保留、纯色 / 图片背景、半透明混合、确定性。
- `src/storage/subject-repository.test.ts`：Blob 往返、按图过滤、级联删除、id 冲突、损坏记录。
- `src/storage/migration.test.ts`：v0（新库）建仓、v1 升级不丢数据、重复打开稳定。

C4 追加：

- `src/core/subject/segmentation/preprocess.test.ts`：缩放、白底合成、归一化、尺寸校验。
- `src/core/subject/segmentation/postprocess.test.ts`：min-max、全等输出、上采样、bbox / 置信度、无主体。
- `src/core/subject/segmentation/pipeline.test.ts`：进度序列、取消、错误收口、前景门槛。
- `src/core/subject/segmentation/models.test.ts`：清单校验、默认模型、未知模型。
- `src/workers/segmentation/runtime.test.ts`：完成、会话复用、取消、未知模型、空输入、dispose。
- `src/workers/segmentation-client.test.ts`：进度 / 完成、字节复制、取消、错误映射、过期响应、崩溃、dispose。

C6 追加：

- `src/core/subject/detect.test.ts`：后处理改写、进度顺序、落库 / 跳过落库、空主体、丢弃候选、
  错误码映射、来源图不一致、输入校验；`replaceExisting` 的删除顺序、缺依赖与清理失败。
- `src/core/subject/import.test.ts`：格式 / 尺寸识别、稳定与随机 `imageId`、空文件、
  非图片、尺寸越界、截断头部。
- `src/core/composition/preview.test.ts`：与 C3 引擎逐字节一致、构图记录字段、更新复用 id、
  背景图透传、存储 / 构图错误映射。
- `src/test/subject-flow.test.ts`：固定蒙版模拟模型输出，跑通
  `detectSubjects → composePreview → sampleToGrid → generatePattern`；
  校验落库蒙版已去噪、构图记录已保存、透明背景不会变成黑豆（empty / background 两种策略）。

`pnpm build` 现在会产出 `dist/assets/segmentation.worker-*.js`，
真实浏览器验证：`pnpm models:download && pnpm smoke:segmentation`
（Vite dev + Playwright Chromium，验证真实照片蒙版与 Cache Storage 命中）。
