// 构建 PDF 中文子集字体：public/fonts/pindou-zh-subset.otf
//   1. 源字体 Noto Sans SC Regular（OTF）：本地 .font-cache 命中则直接用；
//      否则经 gh-proxy.com 下载（直连 raw.githubusercontent 会被重置），支持断点续传
//   2. 按 scripts/pdf-font-charset.mjs 的字符集 + 可打印 ASCII 子集化（subset-font）
//   3. 用 pdf-lib 实际内嵌一遍并排版中文样张自检，失败即退出非零
// 运行：pnpm fonts:pdf
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import subsetFont from "subset-font";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { PDF_CJK_CHARSET } from "./pdf-font-charset.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, "scripts", ".font-cache");
const outDir = join(root, "public", "fonts");
const cacheFile = join(cacheDir, "NotoSansSC-VF.ttf");
const outFile = join(outDir, "pindou-zh-subset.ttf");
mkdirSync(cacheDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

// 必须用 TrueType 轮廓源：CFF/OTF（如 NotoSansCJKsc.otf）经 subset-font 子集后
// pdf-lib 能取到度量但画不出字形轮廓（渲染空白），TTF 子集实测正常。
const NOTO_SC_PATH = "google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf";
const SOURCE_URLS = [
  `https://gh-proxy.com/https://raw.githubusercontent.com/${NOTO_SC_PATH}`,
  `https://gh-proxy.com/https://github.com/${NOTO_SC_PATH.replace("main/", "raw/main/")}`,
];
const MIN_SOURCE_BYTES = 1_000_000;

async function download() {
  for (const url of SOURCE_URLS) {
    process.stdout.write(`下载源字体：${url}\n`);
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok || !response.body) {
        process.stdout.write(`  跳过：HTTP ${response.status}\n`);
        continue;
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(cacheFile));
      if (statSync(cacheFile).size >= MIN_SOURCE_BYTES) return true;
    } catch (error) {
      process.stdout.write(`  失败：${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  // 兜底：系统 curl（走代理前缀 + 断点续传）。
  for (const url of SOURCE_URLS) {
    try {
      execFileSync(
        "curl",
        ["-L", "--fail", "-C", "-", "--retry", "3", "-o", cacheFile, url],
        { stdio: "inherit" },
      );
      if (existsSync(cacheFile) && statSync(cacheFile).size >= MIN_SOURCE_BYTES) return true;
    } catch {
      // 继续尝试下一个 URL
    }
  }
  return false;
}

if (!existsSync(cacheFile) || statSync(cacheFile).size < MIN_SOURCE_BYTES) {
  const ok = await download();
  if (!ok) {
    console.error("源字体下载失败。可手动下载 NotoSansSC-VF.ttf 放到 scripts/.font-cache/ 后重跑。");
    process.exit(1);
  }
}
process.stdout.write(`源字体就绪：${(statSync(cacheFile).size / 1024 / 1024).toFixed(1)} MB\n`);

// 子集文本：中文字符集 + 可打印 ASCII + 常用全角符号。
let ascii = "";
for (let code = 0x20; code <= 0x7e; code += 1) ascii += String.fromCharCode(code);
const subsetText = PDF_CJK_CHARSET + ascii + "×·（）：，。、！？—…";

const source = readFileSync(cacheFile);
const subset = await subsetFont(source, subsetText, { targetFormat: "truetype" });
process.stdout.write(`子集完成：${(subset.byteLength / 1024).toFixed(1)} KB\n`);

// 自检：pdf-lib 真实内嵌 + 排版中文样张 + 保存。
const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const font = await doc.embedFont(subset, { subset: true });
const sample = "拼豆图纸分享 · 规格色数 52×52 · 第 1/4 页";
const width = font.widthOfTextAtSize(sample, 9);
if (!(width > 0)) {
  console.error("自检失败：中文样张宽度异常");
  process.exit(1);
}
const page = doc.addPage([200, 60]);
page.drawText(sample, { x: 8, y: 40, size: 9, font });
await doc.save();
writeFileSync(outFile, subset);
process.stdout.write(`已写入 ${join("public", "fonts", "pindou-zh-subset.ttf")}（pdf-lib 内嵌自检通过）\n`);
