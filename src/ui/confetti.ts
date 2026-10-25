import confetti from "canvas-confetti";

/**
 * 庆祝时刻（导出成功等）的撒花：颜色读当前主题令牌，
 * 尊重 prefers-reduced-motion，失败静默（动效不该挡住主流程）。
 */
export function celebrate(): void {
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const styles = getComputedStyle(document.documentElement);
    const colors = ["--primary", "--primary-deep", "--accent-blue", "--accent-mint", "--accent-lemon"]
      .map((name) => styles.getPropertyValue(name).trim())
      .filter(Boolean);
    if (colors.length === 0) return;
    confetti({
      particleCount: 110,
      spread: 78,
      startVelocity: 42,
      origin: { y: 0.62 },
      colors,
      disableForReducedMotion: true,
    });
    window.setTimeout(() => {
      confetti({
        particleCount: 55,
        spread: 100,
        startVelocity: 32,
        scalar: 0.85,
        origin: { x: 0.18, y: 0.7 },
        colors,
        disableForReducedMotion: true,
      });
    }, 180);
    window.setTimeout(() => {
      confetti({
        particleCount: 55,
        spread: 100,
        startVelocity: 32,
        scalar: 0.85,
        origin: { x: 0.82, y: 0.7 },
        colors,
        disableForReducedMotion: true,
      });
    }, 320);
  } catch {
    // 撒花只是锦上添花，任何环境下都不能报错
  }
}
