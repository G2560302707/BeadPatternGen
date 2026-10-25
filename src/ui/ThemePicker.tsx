import { useState } from "react";
import { THEMES, applyTheme, themeById } from "../app/theme";
import { Popover } from "./Popover";

/** 主题切换弹层：迷你豆片色卡预览，点击即时换肤并记忆。 */
export function ThemePicker() {
  const [current, setCurrent] = useState(() => themeById(document.documentElement.dataset.theme ?? "sakura"));

  const pick = (id: string) => {
    applyTheme(id as typeof current.id);
    setCurrent(themeById(id));
  };

  return (
    <Popover
      testId="theme-picker"
      trigger={(open, toggle) => (
        <button
          type="button"
          className={`btn theme-picker__btn${open ? " theme-picker__btn--open" : ""}`}
          data-testid="theme-toggle"
          onClick={toggle}
          aria-label={`切换主题（当前：${current.name}）`}
          title={`主题：${current.name}`}
        >
          <span aria-hidden="true">{current.emoji}</span>
          <span className="theme-picker__name">{current.name}</span>
        </button>
      )}
    >
      {(close) => (
        <ul className="theme-menu">
          {THEMES.map((theme) => (
            <li key={theme.id}>
              <button
                type="button"
                className={`theme-menu__item${theme.id === current.id ? " theme-menu__item--active" : ""}`}
                onClick={() => {
                  pick(theme.id);
                  close();
                }}
              >
                <span className="theme-menu__beads" aria-hidden="true">
                  {theme.swatch.map((color) => (
                    <i key={color} style={{ background: color }} />
                  ))}
                </span>
                <span className="theme-menu__text">
                  <span className="theme-menu__title">
                    {theme.emoji} {theme.name}
                  </span>
                  <span className="theme-menu__desc">{theme.desc}</span>
                </span>
                {theme.id === current.id ? <span className="theme-menu__check">✓</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
