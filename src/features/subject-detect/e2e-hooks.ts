import { useWorkspaceStore } from "../../state/workspace-store";
import { getMockDetectScenario, setMockDetectScenario } from "./mock-detect";
import { USE_MOCK_DETECTION } from "./source";

declare global {
  interface Window {
    __beadMockDetect?: {
      setMockDetectScenario: typeof setMockDetectScenario;
      getMockDetectScenario: typeof getMockDetectScenario;
    };
    __beadWorkspace?: typeof useWorkspaceStore;
  }
}

/** 仅 mock 模式挂到 window，供 Playwright 切换场景 / 改网格。生产真实识别不会出现。 */
export function installMockE2eHooks(): () => void {
  if (!USE_MOCK_DETECTION || typeof window === "undefined") {
    return () => undefined;
  }
  window.__beadMockDetect = { setMockDetectScenario, getMockDetectScenario };
  window.__beadWorkspace = useWorkspaceStore;
  return () => {
    delete window.__beadMockDetect;
    delete window.__beadWorkspace;
  };
}
