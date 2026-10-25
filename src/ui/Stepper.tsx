export interface StepperStep {
  key: string;
  label: string;
  emoji: string;
  /** 「可选」小标（如构图步） */
  optional?: boolean;
  state: "done" | "current" | "todo";
}

interface StepperProps {
  steps: StepperStep[];
  onSelect: (key: string) => void;
}

/**
 * 顶部步进器：每个节点是一颗拼豆，当前步有豆豆坐镇（CSS 绘制），
 * 已完成的步点亮。所有步都可点击跳转，缺前置条件由目标页给出引导。
 */
export function Stepper({ steps, onSelect }: StepperProps) {
  return (
    <nav className="stepper" aria-label="制作步骤">
      {steps.map((step, index) => (
        <button
          key={step.key}
          type="button"
          className={`stepper__item stepper__item--${step.state}`}
          data-testid={`step-${step.key}`}
          data-state={step.state}
          onClick={() => onSelect(step.key)}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          <span className="stepper__bead" aria-hidden="true">
            <i>{step.emoji}</i>
          </span>
          <span className="stepper__text">
            <span className="stepper__label">
              {step.label}
              {step.optional ? <em className="stepper__optional">可选</em> : null}
            </span>
          </span>
          {index < steps.length - 1 ? <span className="stepper__dash" aria-hidden="true" /> : null}
        </button>
      ))}
    </nav>
  );
}
