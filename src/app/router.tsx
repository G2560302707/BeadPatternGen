import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { LoadingNotice } from "../components/LoadingNotice";
import { AppShell } from "./AppShell";

const HomePage = lazy(() => import("../pages/home/HomePage"));
const ImportPage = lazy(() => import("../pages/import/ImportPage"));
const ComposePage = lazy(() => import("../pages/compose/ComposePage"));
const CanvasPage = lazy(() => import("../pages/canvas/CanvasPage"));
const GeneratePage = lazy(() => import("../pages/generate/GeneratePage"));
const RefinePage = lazy(() => import("../pages/refine/RefinePage"));
const ExportPage = lazy(() => import("../pages/export/ExportPage"));
const LegalPage = lazy(() => import("../pages/legal/LegalPage"));
const HelpPage = lazy(() => import("../pages/help/HelpPage"));
const NotFoundPage = lazy(() => import("../pages/NotFoundPage"));

function PageFallback() {
  return (
    <div className="page" style={{ alignItems: "center", padding: "60px 0" }}>
      <LoadingNotice label="页面加载中…" />
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <Suspense fallback={<PageFallback />}>
              <HomePage />
            </Suspense>
          }
        />
        <Route path="make">
          <Route
            path="import"
            element={
              <Suspense fallback={<PageFallback />}>
                <ImportPage />
              </Suspense>
            }
          />
          <Route
            path="compose"
            element={
              <Suspense fallback={<PageFallback />}>
                <ComposePage />
              </Suspense>
            }
          />
          <Route
            path="canvas"
            element={
              <Suspense fallback={<PageFallback />}>
                <CanvasPage />
              </Suspense>
            }
          />
          <Route
            path="generate"
            element={
              <Suspense fallback={<PageFallback />}>
                <GeneratePage />
              </Suspense>
            }
          />
          <Route
            path="refine"
            element={
              <Suspense fallback={<PageFallback />}>
                <RefinePage />
              </Suspense>
            }
          />
          <Route
            path="export"
            element={
              <Suspense fallback={<PageFallback />}>
                <ExportPage />
              </Suspense>
            }
          />
        </Route>
        <Route
          path="privacy"
          element={
            <Suspense fallback={<PageFallback />}>
              <LegalPage kind="privacy" />
            </Suspense>
          }
        />
        <Route
          path="terms"
          element={
            <Suspense fallback={<PageFallback />}>
              <LegalPage kind="terms" />
            </Suspense>
          }
        />
        <Route
          path="help"
          element={
            <Suspense fallback={<PageFallback />}>
              <HelpPage />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <Suspense fallback={<PageFallback />}>
              <NotFoundPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
