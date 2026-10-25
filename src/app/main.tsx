import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { AppRoutes } from "./router";
import { applyTheme, loadInitialTheme } from "./theme";
import "./styles.css";

// 渲染前应用主题，避免首帧闪错色
applyTheme(loadInitialTheme());

const root = document.getElementById("root");
if (!root) {
  throw new Error("E_DOM_ROOT: #root is missing");
}

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  </StrictMode>,
);
