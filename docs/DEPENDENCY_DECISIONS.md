# 依赖选型记录

S13 引入运行时导出库之前写入本文件。体积为 npm 页面 / bundle 的近似值，不是本仓库实测 gzip。

## onnxruntime-web（C4）

| 项         | 内容                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 名称       | `onnxruntime-web`                                                                                                                                          |
| 版本       | `1.30.0`（`pnpm-lock.yaml`，钉死版本）                                                                                                                     |
| 许可证     | MIT（`onnxruntime` 项目）                                                                                                                                  |
| 包体积     | `node_modules/onnxruntime-web` 约 33 MB；生产使用时只加载 `dist/` 中的一个 wasm 运行时                                                                     |
| 运行时资源 | `ort-wasm-simd-threaded.jsep.wasm` 27 MB（gzip 约 6.4 MB）+ `.mjs` 约 46 KB                                                                                |
| 替代方案   | `@tensorflow/tfjs` + 自转换模型（体积与算子覆盖不确定）、`onnxruntime-node`（不适用浏览器）、服务端推理（违背纯前端与隐私约束）                            |
| 选用理由   | 直接跑 rembg 生态的 ONNX 模型，无需模型转换；WASM 执行提供者可在无 COOP/COEP 时单线程运行；同一构建可选 WebGPU 并在失败时回退 WASM；MIT 许可与本项目一致。 |

### 模型：u2netp（Apache-2.0）

| 项       | 内容                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文件     | `public/models/u2netp.onnx`，4 574 861 字节（约 4.4 MB，fp32）                                                                                     |
| 许可证   | **Apache-2.0**（U-2-Net，`xuebinqin/U-2-Net`）                                                                                                     |
| 来源     | <https://github.com/danielgatis/rembg/releases/tag/v0.0.0>（`u2netp.onnx`）                                                                        |
| 完整性   | SHA-256 `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`，字节数同时校验                                                         |
| 分发方式 | **不随仓库 / 不随 JS bundle 分发**，`.gitignore` 忽略；`pnpm models:download` 按清单下载，运行时进 Cache Storage                                   |
| 替代方案 | `isnet-general-use`（约 176 MB，质量更好但首次下载不可接受）、`u2net` 完整版（约 176 MB）、量化版（未验证质量，且 rembg 发布页未提供稳定量化产物） |

模型清单（唯一事实来源）在 `src/core/subject/segmentation/model-manifest.json`，
下载脚本与运行时共用，升级模型只改这一处并递增 `version` / `cacheName`。
架构、缓存策略、冒烟数据与限制见 `docs/SEGMENTATION.md`。

构建脚本 `pnpm ort:sync`（`predev` / `prebuild` 自动执行）把 jsep wasm 运行时复制到
`public/ort/`，该目录同样被忽略，部署时需随 `dist/` 上传。

## pdf-lib

| 项       | 内容                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 名称     | `pdf-lib`                                                                                                                                            |
| 版本     | `1.17.1`（`pnpm-lock.yaml`）                                                                                                                         |
| 许可证   | MIT                                                                                                                                                  |
| 体积     | 压缩前约 600–800 KB；gzip 约 150–250 KB（无 fontkit）                                                                                                |
| 替代方案 | `jspdf`（API 偏命令式、CJK 同样困难）、`pdfkit`（偏 Node / 流，浏览器打包重）                                                                        |
| 选用理由 | 纯 TypeScript、无原生绑定、浏览器与 Vitest/Node 都能生成与解析 PDF；S13 测试需要读回页数。不把整图栅格塞进 PDF，按 `computePages()` 的格子矢量绘制。 |

中文色名：标准 Helvetica 不含 CJK。一期 PDF 图例以**色号 + HEX + 颗数**为主，完整中文色名以 CSV / JSON / 界面为准。见 `docs/KNOWN_LIMITATIONS.md`。

## fast-png

| 项       | 内容                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 名称     | `fast-png`                                                                                                                       |
| 版本     | `8.0.0`（`pnpm-lock.yaml`）                                                                                                      |
| 许可证   | MIT                                                                                                                              |
| 体积     | 很小（数十 KB 量级）                                                                                                             |
| 替代方案 | 浏览器 `canvas.toBlob('image/png')`（Node 单测没有真实 Canvas 像素契约）、`pngjs`（亦可，API 更重）                              |
| 选用理由 | 纯 JS 编解码，导出不依赖 Canvas 平滑；测试能解码 PNG 并抽样格心像素。大图在 CPU 缓冲区分带写入，不分配边长 &gt; 8000 的 Canvas。 |

## fake-indexeddb（仅测试）

| 项         | 内容                       |
| ---------- | -------------------------- |
| 名称       | `fake-indexeddb`           |
| 用途       | S14 单元测试模拟 IndexedDB |
| 许可证     | CC0 / 公开                 |
| 不进生产包 | 是                         |

## @playwright/test（仅 S15）

| 项         | 内容               |
| ---------- | ------------------ |
| 名称       | `@playwright/test` |
| 用途       | E2E、隐私拦截      |
| 许可证     | Apache-2.0         |
| 不进生产包 | 是                 |
