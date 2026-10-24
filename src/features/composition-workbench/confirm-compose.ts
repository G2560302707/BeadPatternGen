import type { RgbaImage } from "../../core/composition";
import { composeImage } from "../../core/composition";
import { createDraftPattern } from "../../core/pattern";
import type { GenerationSettings } from "../../core/pattern";
import type { CompositionParams, SubjectCandidate } from "../../core/subject";
import { startGeneration } from "../../state/generation";
import { useWorkspaceStore } from "../../state/workspace-store";
import {
  composePreviewInBrowser,
  persistSubjectMaskInBrowser,
} from "../../workers/subject-service";
import { lockedPalette, lockedPaletteColors } from "../palette-panel/locked-palette";
import { sampleBitmapToGrid } from "../image-import/sample-bitmap";

function pixelsFromBitmap(bitmap: ImageBitmap): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("E_COMPOSE_CANVAS: 无法读取原图像素");
  }
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

function toRgbaImage(image: ImageData): RgbaImage {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  };
}

async function composeViaContract(
  candidate: SubjectCandidate,
  source: RgbaImage,
  params: CompositionParams,
  backgroundImage?: RgbaImage,
): Promise<RgbaImage> {
  const saved = await persistSubjectMaskInBrowser(candidate);
  const extra = backgroundImage ? { backgroundImage } : {};
  if (saved) {
    const preview = await composePreviewInBrowser({
      subjectId: candidate.id,
      params,
      source,
      persist: true,
      ...extra,
    });
    return preview.image;
  }
  return composeImage({
    source,
    mask: candidate.mask,
    bbox: candidate.bbox,
    params,
    ...extra,
  }).image;
}

export async function confirmComposition(): Promise<void> {
  const store = useWorkspaceStore.getState();
  const { image, selectedSubjectId, subjectCandidates, compositionParams } = store;
  const candidate =
    subjectCandidates.find((item) => item.id === selectedSubjectId) ?? subjectCandidates[0];
  if (!image || !candidate) {
    store.setError({ code: "E_NO_SUBJECT", message: "请先完成主体识别，再确认构图。" });
    return;
  }

  const locked = { ...compositionParams, subjectLocked: true };
  store.setCompositionParams(locked);

  const sourcePixels = pixelsFromBitmap(image.bitmap);
  const composed = await composeViaContract(
    candidate,
    toRgbaImage(sourcePixels),
    locked,
    store.compositionBackgroundImage ?? undefined,
  );

  const composedBitmap = await createImageBitmap(
    new ImageData(composed.data, composed.width, composed.height),
  );
  try {
    const sampled = sampleBitmapToGrid({
      bitmap: composedBitmap,
      crop: { x: 0, y: 0, width: composed.width, height: composed.height },
      gridW: store.gridW,
      gridH: store.gridH,
      fitMode: store.fitMode,
      alphaPolicy: store.alphaPolicy,
      backgroundHex: store.backgroundHex,
    });
    const settings: GenerationSettings = {
      maxColors: store.maxColors,
      dithering: store.dithering,
      colorMetric: store.colorMetric,
      transparentPolicy: store.alphaPolicy,
    };
    if (store.alphaPolicy === "background") {
      settings.backgroundHex = store.backgroundHex;
    }
    const draft = createDraftPattern({
      id:
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `draft-${Date.now()}`,
      title: image.fileName,
      width: store.gridW,
      height: store.gridH,
      palette: lockedPaletteColors(),
      mode: store.mode,
      paletteId: lockedPalette.paletteId,
      paletteVersion: lockedPalette.version,
      settings,
      source: {
        originalWidth: composed.width,
        originalHeight: composed.height,
        aspectRatio: composed.width / composed.height,
        crop: { x: 0, y: 0, width: composed.width, height: composed.height },
      },
    });
    store.applySample(sampled, draft);
    store.setWorkbenchMode("classic");
    startGeneration();
  } finally {
    composedBitmap.close();
  }
}
