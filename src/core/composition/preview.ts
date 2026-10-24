/**
 * C6 · 构图预览的核心装配（纯逻辑，无 DOM）。
 *
 * 把 C1 的主体记录与 C3 的构图引擎串起来，形成文档第 8 章定义的
 * `composePreview(subjectId, composition)`：
 *
 * ```text
 * loadSubject(subjectId)   # C1：元数据 + 蒙版
 *   → composeImage()       # C3：几何 + 像素合成
 *   → saveComposition()    # C1：参数落库（同输入 + 同算法版本可复现）
 * ```
 *
 * 存储依赖通过 `deps` 注入，core 层不 import `src/storage`；
 * 生产接线见 `src/workers/subject-service.ts`。
 * 合成结果不落库：UI 用返回的 `image` 上屏，返回编辑时按参数重算即可。
 */

import { SubjectIntegrationError, wrapSubjectIntegrationError } from "../subject/protocol";
import type { Composition, CompositionParams, SubjectWithMask } from "../subject";
import { composeImage } from "./compose";
import type { CompositionPlan, RgbaImage } from "./types";

export interface ComposePreviewInput {
  subjectId: string;
  params: CompositionParams;
  /** 原图 RGBA；尺寸必须与主体蒙版一致。 */
  source: RgbaImage;
  /** 仅 `backgroundType === "image"` 时需要。 */
  backgroundImage?: RgbaImage;
  /** 更新已有构图时复用 id；缺省生成新 id（文档 7.1：修改构图不覆盖原记录）。 */
  compositionId?: string;
  /** 更新已有构图时保留原创建时间；缺省等于本次时间。 */
  createdAt?: string;
}

export interface ComposePreviewDeps {
  /** 必填：按 id 读取主体元数据与蒙版。 */
  loadSubject: (subjectId: string) => Promise<SubjectWithMask>;
  /** 可选：保存构图参数；不传则只预览、不落库。 */
  saveComposition?: (composition: Composition) => Promise<Composition>;
  createId?: () => string;
  now?: () => string;
}

export interface ComposePreviewResult {
  subject: SubjectWithMask;
  /** 可序列化的构图记录（与保存到 IndexedDB 的内容一致）。 */
  composition: Composition;
  /** 合成后的 RGBA 画布，可直接上屏或交给采样 / 生成流水线。 */
  image: RgbaImage;
  plan: CompositionPlan;
}

function defaultCreateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `composition-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function runComposePreview(
  input: ComposePreviewInput,
  deps: ComposePreviewDeps,
): Promise<ComposePreviewResult> {
  if (typeof input.subjectId !== "string" || input.subjectId.length === 0) {
    throw new SubjectIntegrationError("E_INPUT_INVALID", "subjectId 不能为空", false);
  }

  const subject = await deps.loadSubject(input.subjectId);
  const composed = composeImage({
    source: input.source,
    mask: subject.mask,
    bbox: subject.bbox,
    params: input.params,
    ...(input.backgroundImage === undefined ? {} : { backgroundImage: input.backgroundImage }),
  });

  const now = deps.now?.() ?? new Date().toISOString();
  const composition: Composition = {
    schemaVersion: "1.0",
    id: input.compositionId ?? deps.createId?.() ?? defaultCreateId(),
    subjectId: input.subjectId,
    sourceImageId: subject.sourceImageId,
    params: { ...input.params },
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };

  if (deps.saveComposition) {
    await deps.saveComposition(composition);
  }

  return {
    subject,
    composition,
    image: composed.image,
    plan: composed.plan,
  };
}

/**
 * 按主体 id 与构图参数生成一张预览画布，并（可选）保存构图记录。
 *
 * @throws {SubjectIntegrationError} 主体不存在 / 蒙版尺寸不匹配 / 参数非法 / 落库失败。
 */
export async function composePreview(
  input: ComposePreviewInput,
  deps: ComposePreviewDeps,
): Promise<ComposePreviewResult> {
  try {
    return await runComposePreview(input, deps);
  } catch (error) {
    throw wrapSubjectIntegrationError(error);
  }
}
