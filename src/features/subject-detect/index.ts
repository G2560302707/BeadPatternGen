import { startSubjectDetection } from "./detect-session";

export { USE_MOCK_DETECTION } from "./source";
export {
  startSubjectDetection,
  restoreOrDetectSubjects,
  cancelSubjectDetection,
  disposeSubjectDetection,
} from "./detect-session";
export { setMockDetectScenario, getMockDetectScenario } from "./mock-detect";
export type { MockDetectScenario } from "./mock-detect";

/** 重新识别：强制再跑分割（replaceExisting）。 */
export function detectSubjects(): void {
  startSubjectDetection();
}
