/**
 * S1a · 蒙版质量闸门（纯函数）。
 *
 * 背景：置信度 = 前景像素平均响应，衡量的是 blob「内部」多自信，
 * blob 范围错得再离谱它照样接近 1。这里用两个可直接观测的异常信号
 * 补上诚实的提示，而不是拦死（用户仍可继续 / 手绘修正）：
 * - 前景占比过高：显著性 blob 膨胀吃进背景；
 * - bbox 贴住图片边缘：主体蒙版几乎不该精确贴边。
 */

import type { BBox, SubjectMask } from "./types";

/** 前景占比超过该值视为可疑（真正的「主体」很少占半张图）。 */
export const MASK_SUSPICIOUS_FOREGROUND_RATIO = 0.45;

/** bbox 贴边数达到该值视为可疑。 */
export const MASK_SUSPICIOUS_EDGE_CONTACTS = 2;

export interface MaskQualityAssessment {
  /** 前景像素占比（0–1）。 */
  foregroundRatio: number;
  /** bbox 贴住图片边缘的条数（0–4）。 */
  edgeContacts: number;
  /** 是否存在可疑信号。 */
  suspicious: boolean;
  /** 面向用户的提示文案；无可疑信号时为 null。 */
  warning: string | null;
}

export function assessMaskQuality(mask: SubjectMask, bbox: BBox): MaskQualityAssessment {
  let foreground = 0;
  for (const value of mask.data) {
    if (value > mask.threshold) foreground += 1;
  }
  const foregroundRatio = mask.data.length > 0 ? foreground / mask.data.length : 0;
  const edgeContacts =
    (bbox.x <= 0 ? 1 : 0) +
    (bbox.y <= 0 ? 1 : 0) +
    (bbox.x + bbox.width >= mask.width ? 1 : 0) +
    (bbox.y + bbox.height >= mask.height ? 1 : 0);

  const reasons: string[] = [];
  if (foregroundRatio > MASK_SUSPICIOUS_FOREGROUND_RATIO) {
    reasons.push(`前景占比 ${(foregroundRatio * 100).toFixed(0)}% 异常高，可能混入大片背景`);
  }
  if (edgeContacts >= MASK_SUSPICIOUS_EDGE_CONTACTS) {
    reasons.push(`主体边界贴住图片 ${edgeContacts} 条边`);
  }

  return {
    foregroundRatio,
    edgeContacts,
    suspicious: reasons.length > 0,
    warning:
      reasons.length > 0
        ? `自动识别可能不可靠：${reasons.join("；")}。可切换高精度模型重试，或用画笔手动修正。`
        : null,
  };
}
