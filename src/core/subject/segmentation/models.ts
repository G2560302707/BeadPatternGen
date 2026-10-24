/**
 * C4 · 分割模型清单（单一事实来源）。
 *
 * 清单同时被浏览器代码与 `scripts/download-models.mjs` 读取：
 * 下载脚本按 `sourceUrl / sha256 / byteLength` 校验文件，
 * 运行时按同一份清单做完整性校验，避免"文档里写的哈希"和实际文件不一致。
 *
 * 新增模型只需编辑 `model-manifest.json`，不改算法代码。
 */

import manifestJson from "./model-manifest.json";
import type { SegmentationModelManifest, SegmentationModelSpec } from "./types";

/** 默认模型：4.4 MB 的 u2netp，移动端与低配机器也能跑。 */
export const DEFAULT_SEGMENTATION_MODEL_ID = "u2netp";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseTriple(value: unknown, label: string): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`模型清单字段 ${label} 必须是长度为 3 的数组`);
  }
  const [a, b, c] = value;
  if (
    typeof a !== "number" ||
    typeof b !== "number" ||
    typeof c !== "number" ||
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !Number.isFinite(c)
  ) {
    throw new Error(`模型清单字段 ${label} 必须全部是有限数字`);
  }
  return Object.freeze([a, b, c] as [number, number, number]);
}

function parseModel(value: unknown, index: number): SegmentationModelSpec {
  const where = `模型清单 models[${index}]`;
  if (!isRecord(value)) throw new Error(`${where} 必须是对象`);
  for (const key of ["id", "version", "license", "upstream", "sourceUrl", "fileName", "sha256"]) {
    if (!isNonEmptyString(value[key])) throw new Error(`${where}.${key} 必须是非空字符串`);
  }
  if (!/^[0-9a-f]{64}$/.test(value.sha256 as string)) {
    throw new Error(`${where}.sha256 必须是 64 位小写十六进制`);
  }
  if (!isPositiveInteger(value.byteLength)) throw new Error(`${where}.byteLength 必须是正整数`);
  if (!isPositiveInteger(value.inputWidth) || !isPositiveInteger(value.inputHeight)) {
    throw new Error(`${where}.inputWidth/inputHeight 必须是正整数`);
  }
  if (!isNonNegativeInteger(value.outputIndex)) {
    throw new Error(`${where}.outputIndex 必须是非负整数`);
  }
  if (value.inputName !== undefined && !isNonEmptyString(value.inputName)) {
    throw new Error(`${where}.inputName 必须是非空字符串`);
  }

  const inputName = value.inputName as string | undefined;
  return {
    id: value.id as string,
    version: value.version as string,
    license: value.license as string,
    upstream: value.upstream as string,
    sourceUrl: value.sourceUrl as string,
    fileName: value.fileName as string,
    sha256: value.sha256 as string,
    byteLength: value.byteLength as number,
    ...(inputName === undefined ? {} : { inputName }),
    inputWidth: value.inputWidth as number,
    inputHeight: value.inputHeight as number,
    mean: parseTriple(value.mean, `${where}.mean`),
    std: parseTriple(value.std, `${where}.std`),
    outputIndex: value.outputIndex as number,
  };
}

function parseManifest(value: unknown): SegmentationModelManifest {
  if (!isRecord(value)) throw new Error("模型清单必须是对象");
  if (!isNonEmptyString(value.cacheName)) throw new Error("模型清单 cacheName 必须是非空字符串");
  if (!Array.isArray(value.models) || value.models.length === 0) {
    throw new Error("模型清单 models 必须是非空数组");
  }
  const models = value.models.map(parseModel);
  const ids = new Set(models.map((model) => model.id));
  if (ids.size !== models.length) throw new Error("模型清单存在重复的模型 id");
  return { cacheName: value.cacheName as string, models };
}

/** 已校验并冻结的模型清单。导入时立即校验，坏清单在启动阶段就暴露。 */
export const SEGMENTATION_MODEL_MANIFEST: Readonly<SegmentationModelManifest> = Object.freeze(
  parseManifest(manifestJson as unknown),
);

/** Cache Storage 桶名。 */
export const SEGMENTATION_MODEL_CACHE_NAME = SEGMENTATION_MODEL_MANIFEST.cacheName;

/** 按 id 取模型；不传 id 时返回默认模型。未知 id 抛错，由调用方转成 `E_MODEL_UNSUPPORTED`。 */
export function getSegmentationModelSpec(modelId?: string): SegmentationModelSpec {
  const id = modelId ?? DEFAULT_SEGMENTATION_MODEL_ID;
  const spec = SEGMENTATION_MODEL_MANIFEST.models.find((model) => model.id === id);
  if (!spec) {
    throw new Error(`不支持的分割模型：${id}`);
  }
  return spec;
}

/** 模型在静态资源目录下的相对路径（不含部署 base）。 */
export function segmentationModelPath(spec: SegmentationModelSpec): string {
  return `models/${spec.fileName}`;
}
