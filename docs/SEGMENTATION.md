# C4 · 浏览器端主体分割（onnxruntime-web + Worker）

> 状态：已实现并通过真实图片冒烟。核心集成（C6）已完成接线，识别默认走真实 Worker。
> 契约类型见 `src/core/subject/types.ts`；数据 / 存储 / 构图契约见
> `docs/SUBJECT_COMPOSITION_CONTRACT.md`。

## 一、范围

| 做                                             | 不做                            |
| ---------------------------------------------- | ------------------------------- |
| 浏览器内 WASM 推理，Worker 不阻塞 UI           | 训练 / 微调模型                 |
| 单主体前景蒙版，输出原图坐标系 `SubjectMask`   | 多主体实例分割                  |
| 模型按需下载、SHA-256 校验、Cache Storage 缓存 | 随包分发模型文件                |
| WebGPU 可选，创建或推理失败自动回退 WASM       | 构图引擎与 UI（C3 / K2–K6）     |
| 真实照片冒烟 + 单元测试                        | E2E CI 门禁（冒烟脚本按需运行） |

## 二、文件布局

```text
src/core/subject/segmentation/     # 纯计算，不依赖 DOM / ORT
  types.ts                         # RgbaImage / 模型规格 / 会话抽象
  errors.ts                        # SegmentationError + C1 错误码
  model-manifest.json              # 模型单一事实来源（下载脚本共用）
  models.ts                        # 清单校验、默认模型、路径
  preprocess.ts                    # 双线性缩放 → 白底合成 → CHW 归一化
  postprocess.ts                   # min-max → 上采样 → 蒙版 / bbox / 置信度
  pipeline.ts                      # runSegmentation：阶段、取消、错误收口
  index.ts                         # 公共出口

src/workers/segmentation/          # 浏览器 API 边界
  model-loader.ts                  # fetch + 字节进度 + SHA-256 + Cache Storage
  ort-session.ts                   # ORT 会话、EP 选择、WebGPU 回退
  decode.ts                        # createImageBitmap + OffscreenCanvas → RGBA
  runtime.ts                       # Worker 协议运行时（可注入依赖，测试友好）

src/workers/segmentation.worker.ts # Worker 入口
src/workers/segmentation-client.ts # 主线程客户端（taskId 闸门 / 取消 / 错误）
scripts/download-models.mjs        # 按清单下载并校验模型
scripts/sync-ort-assets.mjs        # 复制 wasm 运行时到 public/ort（predev/prebuild）
scripts/smoke-segmentation.mjs     # 真实浏览器冒烟（Vite dev + Playwright）
```

core 层只接受 `{ width, height, data: Uint8ClampedArray }`，所以 40 个 C4 单测
全部在 Node 中运行，不需要浏览器或 ORT。

## 三、模型

| 项        | 值                                                                                            |
| --------- | --------------------------------------------------------------------------------------------- |
| id / 版本 | `u2netp` / `rembg-0.0.0`                                                                      |
| 文件      | `public/models/u2netp.onnx`（4.4 MB，fp32）                                                   |
| 许可证    | Apache-2.0（U-2-Net）                                                                         |
| 来源      | <https://github.com/danielgatis/rembg/releases/tag/v0.0.0>                                    |
| 上游      | <https://github.com/xuebinqin/U-2-Net>                                                        |
| 输入      | `input.1`，`float32[1,3,320,320]`，RGB，mean `[0.485,0.456,0.406]`，std `[0.229,0.224,0.225]` |
| 输出      | 取第 0 个输出（`d1`），`float32[1,1,320,320]`                                                 |
| 校验      | `byteLength = 4574861`，`sha256 = 309c8469…4ddd8`                                             |

选型理由：u2netp 只有 4.4 MB，首次下载与移动端内存都可接受；isnet /
u2net 完整版约 176 MB，量化版收益有限且许可与链路更复杂，留给后续按质量需要替换。
模型不是量化版；当前质量在测试照片上已可用（见第七节）。

模型不随仓库分发（`.gitignore`），首次开发执行：

```bash
pnpm models:download          # 已存在且校验通过时跳过
pnpm models:download --force  # 强制重下
```

运行时模型 URL 为 `${BASE_URL}models/u2netp.onnx`，因此 Vite 子路径部署也可用。

## 四、运行时行为

### 4.1 加载与缓存

1. 先查 Cache Storage 桶 `bead-pattern-segmentation-models-v1`；
   命中直接读字节，**不再发网络请求**。
2. 未命中则流式下载，按字节上报 `load-model` 进度。
3. 下载完成后校验字节数与 SHA-256；不匹配删除坏缓存并返回 `E_MODEL_LOAD_FAILED`。
4. 校验通过写回 Cache Storage，之后离线可用。
5. Cache Storage 不可用（隐私模式等）时降级为纯网络加载，不阻塞识别。

Worker 内还会缓存已加载的字节与会话；同一模型第二次识别不再下载、不再初始化 ORT。
模型清单升级时同时递增 `cacheName` 与 `version`，避免旧缓存污染结果。

### 4.2 预处理 / 后处理

```text
RGBA 原图
  → 双线性缩放至 320×320
  → alpha 合成到白底（透明像素不会变成黑色）
  → (value/255 − mean) / std，RGB 平面分离（CHW）
  → ORT 推理
  → 输出全图 min-max 归一化到 0–255（与 rembg 一致）
  → 双线性上采样回原图尺寸
  → SubjectMask(raw-alpha8) + bbox + confidence
```

语义：

- 前景判定仍是 C1 的 `data[i] > threshold`（默认 128）。
- `confidence` = 前景像素归一化值的平均值 / 255。
- 前景占比低于 `DEFAULT_MIN_FOREGROUND_RATIO = 0.05%` 视为 `E_NO_SUBJECT`。
- C4 **不做**去噪 / 填孔 / 羽化，这些由 C2 `postProcessMask()` 负责，C6 串联。

单主体模型只返回一个候选；`maxCandidates` 目前不改变输出数量（协议保留给未来）。

### 4.3 执行提供者与回退

- 默认 `wasm`，`ort.env.wasm.numThreads` 在无 COOP/COEP 时强制为 1；
  页面若开启跨源隔离则最多 4 线程。
- 设置 `VITE_SEGMENTATION_WEBGPU=1` 构建时，若浏览器有 `navigator.gpu`，
  先尝试 WebGPU；会话创建失败回退 WASM；推理中设备丢失也会回退 WASM 并重试一次。
- ORT wasm 资源从 `${BASE_URL}ort/` 加载，由 `pnpm ort:sync` 复制
  （`ort-wasm-simd-threaded.jsep.{mjs,wasm}`，wasm 27 MB / gzip 6.4 MB）。

### 4.4 Worker 协议与进度

请求 / 响应类型沿用 C1：

```ts
{ type: "segment-subject", taskId, payload: { sourceImageId, imageBytes, mimeType, modelId? } }
{ type: "cancel", taskId }
```

进度阶段与含义：

| 阶段          | 粒度 | 说明                                   |
| ------------- | ---- | -------------------------------------- |
| `load-model`  | 字节 | 下载 / 读取缓存 / 初始化会话           |
| `preprocess`  | 2 步 | 图片解码 + 缩放归一化                  |
| `inference`   | 1 步 | ORT 推理（无法细分进度，结束后报 1/1） |
| `postprocess` | 1 步 | 归一化、上采样、蒙版                   |

`done` 消息中的 `mask.data.buffer` 通过 Transferable 转移，避免大数组结构化克隆。
`cancel` 会中止模型下载，并在推理完成后丢弃结果；取消统一返回
`E_CANCELLED`。新任务会作废旧任务，旧任务不再落地任何消息。

错误码（与 C1 一致）：`E_MODEL_LOAD_FAILED` / `E_MODEL_UNSUPPORTED` /
`E_INFERENCE_FAILED` / `E_NO_SUBJECT` / `E_INPUT_INVALID` / `E_CANCELLED`。
`recoverable=false` 时 UI 不应展示重试按钮；其余错误可直接再次调用 `segment()` 重试。

## 五、主线程用法

> 生产代码不直接调用 `SegmentationClient`，而是调用 C6 的
> `detectSubjectsInBrowser()`（`src/workers/subject-service.ts`）：
> 它负责分割 → C2 后处理 → C1 落库。下面的客户端 API 是 C6 的底层依赖。

```ts
import { SegmentationClient } from "@/workers/segmentation-client";

const client = new SegmentationClient();

try {
  const candidates = await client.segment(
    {
      sourceImageId: image.id,
      imageBytes, // Uint8Array，原始 PNG / JPEG 字节
      mimeType: image.mimeType,
    },
    {
      onProgress: ({ stage, done, total }) => {
        // 用 SEGMENTATION_STAGE_LABELS[stage] 展示中文阶段
      },
    },
  );
  // candidates[0] 用于 C2 后处理 / 落库
} catch (error) {
  // SegmentationError：code / recoverable
}
```

- `segment()` 会复制 `imageBytes` 再转移给 Worker，调用方数组不会被 detach，
  可以重复识别或继续用于构图。
- 重复调用 `segment()` 会自动取消上一次任务；`dispose()` 终止 Worker。
- 纯计算入口（不需要 Worker）是 `runSegmentation(options)`，
  它接受任意 `SegmentationSession`，C6 的集成测试可注入假会话。

## 六、构建与开发

```bash
pnpm ort:sync             # 复制 ORT wasm（predev / prebuild 自动执行）
pnpm models:download      # 下载并校验模型
pnpm dev
pnpm typecheck            # 通过
pnpm lint                 # 通过
pnpm test                 # 33 files / 382 tests
pnpm smoke:segmentation   # 真实浏览器冒烟（需 Chromium）
```

`public/ort/` 与 `public/models/*.onnx` 均被忽略，不进入 Git。
模型文件会进入 `dist/`，生产部署需一并上传。

### 6.1 WebGPU 回退冒烟（R9 · 人工，不进 CI）

CI 与 Playwright E2E 一律走默认 WASM 路径（E2E 还用 `?mock-detection=1` 不加载模型）；
WebGPU 依赖本机 GPU 与驱动，只做本地人工冒烟，不作为必过门禁。

本地命令：

```bash
# 开发服务器（flag 只在构建期生效，必须经 Vite 环境变量传入）
VITE_SEGMENTATION_WEBGPU=1 pnpm dev

# 或生产构建 + 预览
VITE_SEGMENTATION_WEBGPU=1 pnpm build
pnpm exec vite preview --host 127.0.0.1 --port 4175 --strictPort
```

Windows PowerShell 下用 `$env:VITE_SEGMENTATION_WEBGPU=1; pnpm build`，结束后
`Remove-Item Env:VITE_SEGMENTATION_WEBGPU`。

如何确认走了哪条后端：打开 DevTools → Console（注意切换到
`segmentation.worker-*.js` 的 Worker 上下文），会话建立后会输出：

```
[segmentation] 推理后端 provider=webgpu（已请求 WebGPU，失败自动回退 WASM）
[segmentation] 推理后端 provider=wasm（WASM 默认路径）
```

回退保证（失败不得白屏）：

- 无 `navigator.gpu`、会话创建失败 → 直接 WASM，仅多一次初始化；
- 推理中设备丢失 / 驱动错误 → 控制台输出
  `[segmentation] WebGPU 推理失败，已回退 WASM 重试`，同一请求内换 WASM 重试一次；
- 只有 WASM 也失败时才向上抛 `E_MODEL_LOAD_FAILED` / `E_INFERENCE_FAILED`，
  与默认路径的错误行为一致（UI 显示错误，可重试），不存在白屏路径。

冒烟检查单：flag 开启 → 控制台显示 `provider=webgpu`（或回退日志）→ 识别出
主体 → 关闭 flag 重新构建 → 仍显示 `provider=wasm` 且识别正常。

## 七、冒烟结果（2026-10-24）

环境：Windows 11 / Chromium（Playwright headless）/ Vite dev / 无 COOP-COEP（单线程 WASM）。

测试图：rembg `examples/animal-1.jpg`，1000×667。

| 指标         | 首次运行                                          | 新页面（Cache Storage 命中） |
| ------------ | ------------------------------------------------- | ---------------------------- |
| 总耗时       | 3720 ms                                           | 3509 ms                      |
| 模型网络请求 | 1                                                 | **0**                        |
| 阶段         | load-model → preprocess → inference → postprocess | 相同                         |
| 候选 / bbox  | 1 个，`{x:69,y:197,w:847,h:377}`                  | 相同                         |
| 蒙版         | 1000×667，前景 162097 px                          | 相同                         |
| 置信度       | 0.969                                             | 相同                         |

耗时含模型加载 / ORT 初始化 / 推理；缓存命中后主要成本是 wasm 初始化与推理。

## 八、已知限制

- **单主体**：u2net 家族输出一张显著性图，不区分多个实例；不满足多主体编辑。
- **模型质量**：u2netp 是小型模型，细发丝、透明物体、主体与背景同色时边缘会丢；
  量化版未验证，后续可替换清单中的模型而不改算法。
- **体积**：模型 4.4 MB + ORT wasm 27 MB（gzip 6.4 MB）；首次识别需要网络。
- **速度**：无 COOP/COEP 时单线程，测试图约 3.5–4 s；启用跨源隔离可多线程。
- **WebGPU** 路径已实现并带回退，但未纳入自动冒烟（默认构建关闭）。
- 分割 Worker 已随 C6 进入生产构建（`dist/assets/segmentation.worker-*.js`）。
- 冒烟脚本使用 rembg 仓库示例图，仅本地验证，不随仓库分发。
