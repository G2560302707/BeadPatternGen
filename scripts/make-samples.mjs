// 生成内置示例图（public/samples/*.png）：
// 三张透明底像素小图 + 一张渐变日落风景，供新用户零门槛试玩。
// 运行：pnpm samples
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encode } from "fast-png";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "samples");
mkdirSync(outDir, { recursive: true });

function makeCanvas(size) {
  return { size, data: new Uint8Array(size * size * 4) };
}

function paintPixel(canvas, x, y, [r, g, b, a = 255]) {
  const i = (y * canvas.size + x) * 4;
  canvas.data[i] = r;
  canvas.data[i + 1] = g;
  canvas.data[i + 2] = b;
  canvas.data[i + 3] = a;
}

/** 把字符像素画放大铺到 size×size 画布正中。'.' 与 ' ' = 透明。 */
function stampPixelArt(rows, palette, size, scale) {
  const canvas = makeCanvas(size);
  const artH = rows.length;
  const artW = Math.max(...rows.map((row) => row.length));
  const offsetX = Math.floor((size - artW * scale) / 2);
  const offsetY = Math.floor((size - artH * scale) / 2);
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx += 1) {
      const color = palette[row[rx]];
      if (!color) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          paintPixel(canvas, offsetX + rx * scale + dx, offsetY + ry * scale + dy, color);
        }
      }
    }
  });
  return canvas;
}

// ── 爱心（上浅下深两段粉）──
const heartRows = [
  ".XX...XX.",
  "XXXXXXXXX",
  "XXXXXXXXX",
  "XXXXXXXXX",
  ".XXXXXXX.",
  "..XXXXX..",
  "...XXX...",
  "....X....",
];
const heart = stampPixelArt(
  heartRows.map((row, i) => (i <= 1 ? row : row)),
  { X: [247, 110, 156] },
  256,
  26,
);
// 顶部两行换成浅粉
for (let y = 0; y < heart.size; y += 1) {
  for (let x = 0; x < heart.size; x += 1) {
    const i = (y * heart.size + x) * 4;
    if (heart.data[i + 3] === 255 && y < 128) {
      heart.data[i] = 255;
      heart.data[i + 1] = 156;
      heart.data[i + 2] = 191;
    }
  }
}

// ── 星星 ──
const starRows = [
  ".....X.....",
  "....XXX....",
  "....XXX....",
  "XXXXXXXXXXX",
  ".XXXXXXXXX.",
  "..XXXXXXX..",
  "..XXXXXXX..",
  ".XXXX.XXXX.",
  ".XX.....XX.",
];
const star = stampPixelArt(starRows, { X: [255, 205, 84] }, 256, 20);

// ── 草莓 ──
const berryRows = [
  "..G......G..",
  "..GG....GG..",
  "...GGGGGG...",
  "..RRRRRRRR..",
  ".RRWRRRRWRR.",
  ".RRRRRWRRRR.",
  ".RWRRRRRRWR.",
  ".RRRRWRRRRR.",
  "..RRWRRRRR..",
  "..RRRRRWRR..",
  "...RRRRRR...",
  "....RRRR....",
  "....G..G....",
];
const berry = stampPixelArt(
  berryRows,
  { R: [242, 84, 91], W: [255, 244, 244], G: [123, 201, 111] },
  256,
  18,
);

// ── 日落风景（程序化：渐变天空 + 太阳 + 双层山）──
function makeSunset(size) {
  const canvas = makeCanvas(size);
  const skyTop = [255, 226, 168];
  const skyMid = [255, 158, 125];
  const skyLow = [232, 111, 164];
  const ridgeFar = [178, 108, 148];
  const ridgeNear = [110, 68, 106];
  for (let y = 0; y < size; y += 1) {
    const t = y / (size - 1);
    const sky = t < 0.5
      ? lerp(skyTop, skyMid, t / 0.5)
      : lerp(skyMid, skyLow, (t - 0.5) / 0.5);
    for (let x = 0; x < size; x += 1) {
      paintPixel(canvas, x, y, sky);
    }
  }
  // 太阳 + 光晕
  const sun = { x: size * 0.62, y: size * 0.3, r: size * 0.09 };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - sun.x, y - sun.y);
      if (d < sun.r) paintPixel(canvas, x, y, [255, 244, 195]);
      else if (d < sun.r * 1.8) paintPixel(canvas, x, y, lerp([255, 244, 195], skyAt(y), (d - sun.r) / (sun.r * 0.8)));
    }
  }
  function skyAt(y) {
    const t = y / (size - 1);
    return t < 0.5 ? lerp(skyTop, skyMid, t / 0.5) : lerp(skyMid, skyLow, (t - 0.5) / 0.5);
  }
  // 两层山脊
  const ridges = [
    { base: 0.62, amp: size * 0.05, freq: 2.2, phase: 0.8, color: ridgeFar },
    { base: 0.74, amp: size * 0.06, freq: 3.1, phase: 2.1, color: ridgeNear },
  ];
  for (const { base, amp, freq, phase, color } of ridges) {
    for (let x = 0; x < size; x += 1) {
      const h = base * size + Math.sin((x / size) * Math.PI * 2 * freq + phase) * amp;
      for (let y = Math.floor(h); y < size; y += 1) {
        paintPixel(canvas, x, y, color);
      }
    }
  }
  return canvas;
}

function lerp(a, b, t) {
  return a.map((av, i) => Math.round(av + (b[i] - av) * t));
}

const sunset = makeSunset(256);

const files = [
  ["heart.png", heart],
  ["star.png", star],
  ["strawberry.png", berry],
  ["sunset.png", sunset],
];
for (const [name, canvas] of files) {
  const png = encode({
    width: canvas.size,
    height: canvas.size,
    data: canvas.data,
    channels: 4,
    depth: 8,
  });
  writeFileSync(join(outDir, name), png);
  console.log(`✓ ${name} (${png.length} bytes)`);
}
console.log(`示例图已生成到 ${outDir}`);
