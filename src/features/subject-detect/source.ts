/**
 * 识别数据源开关。
 *
 * 默认走真实分割 Worker；以下情况退回 mock（用于无模型 / 弱网 / E2E 稳定截图）：
 * - 构建期：`VITE_SUBJECT_DETECTION=mock`
 * - 运行期：URL 带 `?mock-detection=1`
 *
 * mock 只替换“分割结果从哪里来”，后续后处理、落库、构图与真实链路完全一致。
 */

function queryWantsMock(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("mock-detection") === "1";
  } catch {
    return false;
  }
}

export const USE_MOCK_DETECTION =
  import.meta.env.VITE_SUBJECT_DETECTION === "mock" || queryWantsMock();
