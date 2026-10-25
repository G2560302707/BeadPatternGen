import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Mascot, type MascotMood } from "../design/mascot/Mascot";

/** 步骤页头：emoji + 标题 + 一句话说明（页面职责文案）。 */
export function StepIntro({
  emoji,
  title,
  sub,
  mood = "idle",
}: {
  emoji: string;
  title: string;
  sub: string;
  mood?: MascotMood;
}) {
  return (
    <header className="step-intro">
      <Mascot mood={mood} size={72} className="step-intro__mascot" />
      <div>
        <h1 className="step-intro__title">
          <span aria-hidden="true">{emoji}</span> {title}
        </h1>
        <p className="step-intro__sub">{sub}</p>
      </div>
    </header>
  );
}

/** 步骤页底部的上一步 / 下一步导航。 */
export function StepNav({
  prev,
  next,
}: {
  prev?: { to: string; label: string };
  next?: {
    to: string;
    label: string;
    disabled?: boolean | undefined;
    testId?: string | undefined;
    hint?: string | undefined;
  };
}) {
  return (
    <div className="step-nav">
      {prev ? (
        <Link className="btn" to={prev.to}>
          ← {prev.label}
        </Link>
      ) : (
        <span />
      )}
      <div className="step-nav__next">
        {next?.hint ? <p className="hint step-nav__hint">{next.hint}</p> : null}
        {next ? (
          next.disabled ? (
            <button type="button" className="btn btn--primary" disabled data-testid={next.testId}>
              {next.label} →
            </button>
          ) : (
            <Link className="btn btn--primary" to={next.to} data-testid={next.testId}>
              {next.label} →
            </Link>
          )
        ) : null}
      </div>
    </div>
  );
}

/** 路由守卫占位页：缺前置条件时不报错，豆豆指路。 */
export function GatePlaceholder({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: { to: string; label: string };
}) {
  return (
    <div className="gate" data-testid="step-gate">
      <Mascot mood="sad" size={110} />
      <h2>{title}</h2>
      <p>{body}</p>
      <Link className="btn btn--primary" to={action.to}>
        {action.label}
      </Link>
    </div>
  );
}

/** 内容卡片：首页动作入口 / 导出方式选择等。 */
export function ActionCard({
  emoji,
  title,
  body,
  onClick,
  to,
  testId,
  badge,
}: {
  emoji: string;
  title: string;
  body: string;
  onClick?: () => void;
  to?: string;
  testId?: string;
  badge?: string;
}) {
  const inner = (
    <>
      {badge ? <span className="action-card__badge">{badge}</span> : null}
      <span className="action-card__emoji" aria-hidden="true">
        {emoji}
      </span>
      <span className="action-card__title">{title}</span>
      <span className="action-card__body">{body}</span>
    </>
  );
  if (to) {
    return (
      <Link className="action-card" to={to} data-testid={testId}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className="action-card" onClick={onClick} data-testid={testId}>
      {inner}
    </button>
  );
}

/** 简单包装：给控制区一个统一外框（替代旧三栏 panel 语义）。 */
export function SidePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="panel">
      <header className="panel__head">
        <h2>{title}</h2>
      </header>
      {children}
    </aside>
  );
}
