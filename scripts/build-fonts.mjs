// 自托管可爱风字体子集管线：
//   1. 下载 OFL 字体源文件（GitHub 直连失败自动走 gh-proxy.com 前缀 + 断点续传）
//   2. 按站点词汇表 + 通用安全集子集化为 woff2，输出 public/fonts/
//   3. 下载 OFL 许可文本一并存放
// 产物随仓库分发；字体缺失时应用自动回退系统字体（font-display: swap）。
// 运行：pnpm fonts
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import subsetFont from "subset-font";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, "scripts", ".font-cache");
const outDir = join(root, "public", "fonts");
mkdirSync(cacheDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const FONTS = [
  {
    id: "zcool-kuaile",
    label: "ZCOOL KuaiLe（站酷快乐体）",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf",
    licenseUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolkuaile/OFL.txt",
    output: "ZCOOLKuaiLe-subset.woff2",
    // 仅拉丁 + 常用标点：中文交给系统字体栈（快乐体子集只做门面点缀会缺中文，因此快乐体必须含站点中文词汇）。
    unicode: true,
  },
  {
    id: "baloo2",
    label: "Baloo 2（数字与拉丁）",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/baloo2/Baloo2%5Bwght%5D.ttf",
    licenseUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/baloo2/OFL.txt",
    output: "Baloo2-subset.woff2",
    unicode: false, // 仅拉丁/数字
  },
  {
    id: "zcool-xiaowei",
    label: "ZCOOL XiaoWei（站酷小薇 · 优雅细宋）",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf",
    licenseUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolxiaowei/OFL.txt",
    output: "ZCOOLXiaoWei-subset.woff2",
    unicode: true,
  },
  {
    id: "ma-shan-zheng",
    label: "Ma Shan Zheng（马善政楷书 · 手写手账）",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/mashanzheng/MaShanZheng-Regular.ttf",
    licenseUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/mashanzheng/OFL.txt",
    output: "MaShanZheng-subset.woff2",
    unicode: true,
  },
  {
    id: "zcool-qingke-huangyou",
    label: "ZCOOL QingKe HuangYou（庆科黄油体 · 元气粗圆）",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolqingkehuangyou/ZCOOLQingKeHuangYou-Regular.ttf",
    licenseUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolqingkehuangyou/OFL.txt",
    output: "ZCOOLQingKeHuangYou-subset.woff2",
    unicode: true,
  },
  {
    id: "quicksand",
    label: "Quicksand（几何圆拉丁 · 素雅主题）",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/quicksand/Quicksand%5Bwght%5D.ttf",
    licenseUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/quicksand/OFL.txt",
    output: "Quicksand-subset.woff2",
    unicode: false, // 仅拉丁/数字
  },
  {
    id: "silkscreen",
    label: "Silkscreen（像素拉丁 · 像素工坊）",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/silkscreen/Silkscreen-Regular.ttf",
    licenseUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/silkscreen/OFL.txt",
    output: "Silkscreen-subset.woff2",
    unicode: false, // 仅拉丁/数字
  },
  {
    // 缝合像素（简中）：完整 CJK 像素字体，走 fontsource npm 包拿单文件 woff2。
    id: "fusion-pixel-12",
    label: "Fusion Pixel 12px Proportional SC（缝合像素简中 · 像素工坊）",
    packUrl:
      "https://registry.npmmirror.com/@fontsource/fusion-pixel-12px-proportional-sc/-/fusion-pixel-12px-proportional-sc-5.3.0.tgz",
    packFile: "package/files/fusion-pixel-12px-proportional-sc-latin-400-normal.woff2",
    licensePackFile: "package/LICENSE",
    output: "FusionPixel12-subset.woff2",
    unicode: true,
  },
];

async function fetchWithFallback(url) {
  const attempts = [url, `https://gh-proxy.com/${url}`];
  let lastError;
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt, { redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      console.warn(`  ↓ 尝试失败（${attempt}）：${error.message}`);
    }
  }
  throw lastError;
}

async function downloadTo(url, target) {
  if (existsSync(target) && statSync(target).size > 0) {
    console.log(`  已有缓存 ${target}`);
    return;
  }
  console.log(`  下载 ${url}`);
  const response = await fetchWithFallback(url);
  const tmp = `${target}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tmp));
  renameSync(tmp, target);
}

/** 站点词汇表：扫描 src 内全部源码字符串，另加安全集。 */
function buildCharset() {
  const chars = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else if (/\.(tsx?|md|json)$/.test(name.name)) {
        const text = readFileSync(p, "utf8");
        for (const ch of text) {
          const code = ch.codePointAt(0);
          if (code >= 0x2e80 || (code >= 0x20 && code < 0x7f)) chars.add(ch);
        }
      }
    }
  };
  walk(join(root, "src"));
  // 安全补充：全角标点、数字相关、常见界面符号
  for (const ch of "，。！？；：、·…（）【】《》「」『』％℃㎡×÷±—–‑‧★☆✓✗→←↑↓•●○◆■□▲▼π") {
    chars.add(ch);
  }
  return [...chars].join("");
}

async function main() {
  const charset = buildCharset();
  const latinOnly = charset.replace(/[^\u0020-\u007e]/g, "");
  console.log(`词汇表：全部 ${charset.length} 字 · 拉丁 ${latinOnly.length} 字`);
  const notices = [];
  for (const font of FONTS) {
    console.log(`▶ ${font.label}`);
    try {
      let input;
      let licenseText;
      if (font.packUrl) {
        // fontsource npm 包：下载 tgz → tar 解包 → 取 woff2 与 LICENSE
        // 注意：tar 参数一律用相对路径 + cwd，避免 Windows 盘符冒号被当作远程主机。
        const tgzPath = join(cacheDir, `${font.id}.tgz`);
        const packDir = join(cacheDir, `${font.id}-pack`);
        await downloadTo(font.packUrl, tgzPath);
        if (!existsSync(join(packDir, font.packFile))) {
          mkdirSync(packDir, { recursive: true });
          execFileSync("tar", ["-xzf", `${font.id}.tgz`, "-C", `${font.id}-pack`], {
            cwd: cacheDir,
          });
        }
        input = readFileSync(join(packDir, font.packFile));
        licenseText = readFileSync(join(packDir, font.licensePackFile));
      } else {
        const ttfPath = join(cacheDir, `${font.id}.ttf`);
        const licensePath = join(cacheDir, `${font.id}-OFL.txt`);
        await downloadTo(font.url, ttfPath);
        await downloadTo(font.licenseUrl, licensePath);
        input = readFileSync(ttfPath);
        licenseText = readFileSync(licensePath);
      }
      const text = font.unicode ? charset : latinOnly;
      let woff2;
      try {
        woff2 = await subsetFont(input, text, { targetFormat: "woff2" });
      } catch (error) {
        // woff2 输入子集化失败时退回原文件（体积大一点但可用）
        console.warn(`  ⚠ 子集化失败（${error.message}），整包拷贝。`);
        woff2 = input;
      }
      writeFileSync(join(outDir, font.output), woff2);
      writeFileSync(join(outDir, `${font.id}-OFL.txt`), licenseText);
      console.log(`  ✓ ${font.output}：${(woff2.length / 1024).toFixed(0)} KB（${text.length} 字）`);
      notices.push(font);
    } catch (error) {
      console.warn(`  ⚠ 失败：${error.message}。跳过该字体（应用将回退系统字体）。`);
    }
  }
  if (notices.length > 0) {
    writeFileSync(
      join(outDir, "SOURCES.md"),
      notices
        .map((f) =>
          f.packUrl
            ? `- ${f.label}：${f.packUrl}（SIL Open Font License，见同目录 OFL.txt）`
            : `- ${f.label}：${f.url}（SIL Open Font License，见同目录 OFL.txt）`,
        )
        .join("\n") + "\n",
    );
  }
  console.log("字体子集完成 → public/fonts/");
}

main().catch((error) => {
  console.error(`字体构建失败：${error.message}`);
  process.exitCode = 1;
});
