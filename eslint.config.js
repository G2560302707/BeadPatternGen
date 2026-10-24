import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";

const tsconfigRootDir = fileURLToPath(new URL(".", import.meta.url));

export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      "public/ort",
      "拆解文档",
      ".workbuddy",
      "tests/e2e",
      "playwright.config.ts",
    ],
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.js", "vite.config.ts"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        atob: "readonly",
        caches: "readonly",
        console: "readonly",
        fetch: "readonly",
        performance: "readonly",
        process: "readonly",
        URL: "readonly",
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  eslintConfigPrettier,
);
