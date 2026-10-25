/**
 * 豆豆 —— 品牌吉祥物：一颗有腮红的圆拼豆。
 * 纯内联 SVG，颜色走主题令牌；所有状态见 MascotMood。
 */

export type MascotMood =
  | "idle" // 待机：轻轻浮动
  | "happy" // 开心（保存成功等）
  | "working" // 加油（生成/识别中）
  | "sad" // 委屈（错误/空态）
  | "celebrate"; // 庆祝（导出完成，带彩带）

interface MascotProps {
  mood?: MascotMood;
  /** 渲染尺寸（px），默认 96 */
  size?: number;
  className?: string;
}

const CONFETTI = [
  { x: 8, y: 18, c: "var(--accent-lemon)", r: -18 },
  { x: 104, y: 14, c: "var(--accent-blue)", r: 24 },
  { x: 14, y: 86, c: "var(--accent-mint)", r: 40 },
  { x: 100, y: 90, c: "var(--primary)", r: -30 },
  { x: 58, y: 4, c: "var(--accent-blue)", r: 8 },
  { x: 112, y: 52, c: "var(--accent-lemon)", r: -12 },
];

export function Mascot({ mood = "idle", size = 96, className }: MascotProps) {
  const ink = "var(--ink)";
  const showConfetti = mood === "celebrate";
  return (
    <svg
      className={["mascot", `mascot--${mood}`, className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 124 124"
      role="img"
      aria-label={`吉祥物豆豆（${mood}）`}
    >
      {showConfetti
        ? CONFETTI.map((piece, index) => (
            <rect
              key={index}
              className="mascot__confetti"
              x={piece.x}
              y={piece.y}
              width={7}
              height={10}
              rx={2.5}
              fill={piece.c}
              transform={`rotate(${piece.r} ${piece.x + 3.5} ${piece.y + 5})`}
              style={{ animationDelay: `${index * 0.12}s` }}
            />
          ))
        : null}

      {/* 身体：圆拼豆 */}
      <circle cx="62" cy="66" r="44" fill="var(--primary)" stroke="var(--primary-deep)" strokeWidth="4" />
      {/* 中孔 */}
      <circle cx="62" cy="66" r="13" fill="var(--bg)" stroke="var(--primary-deep)" strokeWidth="3.5" opacity="0.95" />
      {/* 高光 */}
      <ellipse cx="44" cy="42" rx="14" ry="9" fill="#ffffff" opacity="0.5" transform="rotate(-24 44 42)" />
      {/* 腮红 */}
      <ellipse cx="38" cy="78" rx="7" ry="4.5" fill="#ffffff" opacity="0.55" />
      <ellipse cx="86" cy="78" rx="7" ry="4.5" fill="#ffffff" opacity="0.55" />

      {/* 眼睛 */}
      {mood === "happy" ? (
        <>
          <path d="M42 62 q6 -9 12 0" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />
          <path d="M70 62 q6 -9 12 0" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="48" cy="60" r="4.6" fill={ink} />
          <circle cx="76" cy="60" r="4.6" fill={ink} />
          <circle cx="49.6" cy="58.4" r="1.5" fill="#ffffff" />
          <circle cx="77.6" cy="58.4" r="1.5" fill="#ffffff" />
        </>
      )}

      {/* 嘴 */}
      {mood === "happy" || mood === "celebrate" ? (
        <>
          <path d="M52 72 q10 12 20 0 z" fill="var(--primary-deep)" />
          <path d="M56 77 q6 5 12 0 z" fill="#ff9eb8" />
        </>
      ) : mood === "sad" ? (
        <path d="M55 80 q7 -7 14 0" fill="none" stroke={ink} strokeWidth="3.5" strokeLinecap="round" />
      ) : mood === "working" ? (
        <circle cx="62" cy="76" r="4" fill="none" stroke={ink} strokeWidth="3.2" />
      ) : (
        <path d="M55 74 q7 7 14 0" fill="none" stroke={ink} strokeWidth="3.5" strokeLinecap="round" />
      )}

      {/* 状态小道具 */}
      {mood === "working" ? (
        <g className="mascot__sweat">
          <path d="M98 38 q6 8 0 12 q-6 -4 0 -12" fill="var(--accent-blue)" />
        </g>
      ) : null}
      {mood === "sad" ? (
        <path d="M82 66 q6 9 0 14 q-6 -5 0 -14" fill="var(--accent-blue)" className="mascot__tear" />
      ) : null}
    </svg>
  );
}
