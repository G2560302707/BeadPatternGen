import type { CompositionPlan } from "../../core/composition";

const SIDES: Array<{ key: keyof CompositionPlan["overflow"]; label: string }> = [
  { key: "left", label: "左" },
  { key: "top", label: "上" },
  { key: "right", label: "右" },
  { key: "bottom", label: "下" },
];

export function hasOverflow(plan: CompositionPlan): boolean {
  return (
    plan.adjusted ||
    plan.overflow.left > 0 ||
    plan.overflow.top > 0 ||
    plan.overflow.right > 0 ||
    plan.overflow.bottom > 0
  );
}

/** UI 只消费 C3 计划：把 overflow / adjusted / suggestion 转成可读提示。 */
export function describeOverflow(plan: CompositionPlan): string | null {
  if (!hasOverflow(plan)) return null;
  const sides = SIDES.filter((side) => plan.overflow[side.key] > 0.5).map((side) => {
    const px = Math.round(plan.overflow[side.key]);
    return `${side.label} ${px}px`;
  });
  if (sides.length > 0) {
    return `主体超出画布（${sides.join("、")}）。预览已夹紧到内容区，可采纳建议位置。`;
  }
  return "当前占比 / 位置 / 画布比例组合被边距夹紧。预览已贴齐内容区，可采纳建议位置。";
}
