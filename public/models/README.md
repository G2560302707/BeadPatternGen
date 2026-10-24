# 分割模型（不随仓库分发）

模型文件按 `src/core/subject/segmentation/model-manifest.json` 下载：

```bash
pnpm models:download
```

| 模型     | 文件          | 大小   | 许可证     | 来源                                                                                                                        |
| -------- | ------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `u2netp` | `u2netp.onnx` | 4.4 MB | Apache-2.0 | [rembg release](https://github.com/danielgatis/rembg/releases/tag/v0.0.0) / [U-2-Net](https://github.com/xuebinqin/U-2-Net) |

`.onnx` 已被 `.gitignore` 忽略，避免仓库膨胀。运行时首次识别会下载并写入
Cache Storage（`bead-pattern-segmentation-models-v1`），之后离线可用。
下载后会按清单中的 `byteLength` 与 `sha256` 做完整性校验。
