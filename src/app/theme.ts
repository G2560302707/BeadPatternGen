/** 主题注册表与切换引擎：`<html data-theme>` + localStorage 记忆。 */

export interface ThemeMeta {
  id: string;
  name: string;
  emoji: string;
  /** 一句话人格描述（主题选择器里展示） */
  desc: string;
  /** 主题选择器里的小色卡（迷你豆片预览） */
  swatch: [string, string, string, string];
  dark?: boolean;
}

export const THEMES: readonly ThemeMeta[] = [
  {
    id: "sakura",
    name: "樱粉少女",
    emoji: "🌸",
    desc: "圆滚滚的少女心旗舰",
    swatch: ["#f76e9c", "#ffdce9", "#7fbdf7", "#fff4f8"],
  },
  {
    id: "taro",
    name: "香芋啵啵",
    emoji: "🍇",
    desc: "梦幻紫的优雅慢时光",
    swatch: ["#9a63d2", "#ecdffb", "#f78fb0", "#f7f2fc"],
  },
  {
    id: "matcha",
    name: "抹茶手账",
    emoji: "🍵",
    desc: "方格纸上的治愈手写",
    swatch: ["#64a957", "#e3f2d8", "#d98a5f", "#f5f9ee"],
  },
  {
    id: "soda",
    name: "海盐汽水",
    emoji: "🥤",
    desc: "粗描边的元气气泡",
    swatch: ["#3d9fd1", "#d9effa", "#ff8a5c", "#eff8fc"],
  },
  {
    id: "luna",
    name: "月夜宫阙",
    emoji: "🌙",
    desc: "霓虹发光的二次元夜",
    swatch: ["#ff8fc5", "#4a3d6b", "#8fd4f7", "#221c30"],
    dark: true,
  },
  {
    id: "cloud",
    name: "云朵白",
    emoji: "☁️",
    desc: "安静克制的素雅工作台",
    swatch: ["#7b93e0", "#e3eafc", "#58b98a", "#f5f7fa"],
  },
  {
    id: "paper",
    name: "复古信笺",
    emoji: "✉️",
    desc: "老信纸般的优雅文艺",
    swatch: ["#b4714f", "#f4e9d8", "#8a9a5b", "#faf3e6"],
  },
  {
    id: "pixel",
    name: "像素工坊",
    emoji: "👾",
    desc: "8-bit 街机风拼豆实验室",
    swatch: ["#2ec4b6", "#1d2b35", "#ffd23f", "#e8f1f2"],
  },
];

export const DEFAULT_THEME_ID = "sakura";
const STORAGE_KEY = "bead.theme";

function isThemeId(value: string): value is ThemeMeta["id"] {
  return THEMES.some((theme) => theme.id === value);
}

export function loadInitialTheme(): ThemeMeta["id"] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isThemeId(saved)) return saved;
  } catch {
    // localStorage 不可用（隐私模式等）时静默用默认
  }
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "luna" : DEFAULT_THEME_ID;
}

export function applyTheme(id: ThemeMeta["id"]): void {
  document.documentElement.dataset.theme = id;
  // 浏览器窗口标题栏/手机状态栏跟随主题底色
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = themeById(id).swatch[3];
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 同上，忽略存储失败
  }
}

export function themeById(id: string): ThemeMeta {
  return THEMES.find((theme) => theme.id === id) ?? FALLBACK_THEME;
}

const FALLBACK_THEME: ThemeMeta = THEMES[0] as ThemeMeta;
