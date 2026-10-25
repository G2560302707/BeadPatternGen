import { useEffect, useRef, useState, type ReactNode } from "react";

interface PopoverProps {
  /** 触发器渲染函数；open 与切换函数由内部管理 */
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  /** data-testid */
  testId?: string;
}

/** 轻量弹层：点外部 / Esc 关闭。样式走 .popover 系列。 */
export function Popover({ trigger, children, align = "right", testId }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="popover" ref={rootRef}>
      {trigger(open, () => setOpen((value) => !value))}
      {open ? (
        <div
          className={`popover__panel popover__panel--${align}`}
          data-testid={testId}
          role="dialog"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
