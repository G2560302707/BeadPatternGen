# -*- coding: utf-8 -*-
"""拼豆项目分阶段拆解数据源（唯一事实源）。"""

SPEC = "拼豆图纸生成器_技术实施规格_v1.1_修正版.docx"
DOCVER = "拆解版 v1.0（基于技术规格 v1.1 修正版）"

# ---------------------------------------------------------------- 全局提示词

CURSOR_GLOBAL = """你正在参与开发「拼豆图纸生成器」——纯前端产品（React + TypeScript + Vite + pnpm），
把照片 / 动漫 / Logo / 风景图片转换成可以用真实拼豆一格格拼出来的图纸。

【项目铁律 · 每个阶段都适用，不得违反】
1. 一期范围：生成 → 只读预览 → 质量诊断 → 颜色统计 → 导出（PNG / 分页 PDF / JSON / CSV）。
   一期绝不实现逐颗人工编辑：画笔、橡皮、吸管、区域填充、手工颜色替换、选区复制粘贴、移动 / 镜像 / 旋转、
   编辑撤销重做、编辑过程自动保存、局部重新生成、图层与编辑版本管理。
   除非我逐字说「现在授权开始二期」，否则不得编写任何修改 cells 的交互入口（含隐藏入口、DEBUG 入口、注释掉的原型）。
2. 所有按钮必须有真实功能。禁止假数据、假统计、假进度、假色卡、无功能菜单、静默吞异常。
3. 图纸每个格子的颜色必须来自所选真实色卡；禁止把量化产生的合成色当作最终豆子颜色输出。
4. 核心算法必须是纯 TypeScript，放在 src/core，不依赖 React、不依赖 DOM；UI 层不得内联算法。
5. 耗时计算走 Web Worker；启动新任务时旧任务结果不得覆盖新结果（任务 ID 校验）。
6. 未经我明确授权，不得把用户图片上传到任何第三方服务；不得调用任何大模型 API 参与颜色映射。
7. 不得为了让测试变绿而删除、跳过、放宽断言或改写测试用例。
8. 真实色卡数据必须可溯源（品牌 / 系列 / 版本 / 色号 / HEX / 来源 / 许可），未核验的色卡不得进入正式 palette。

【每个阶段的工作方式】
1. 先读 docs/TECHNICAL_SPEC.md 与 docs/IMPLEMENTATION_STATUS.md；文件不存在就明确指出，不要臆造内容。
2. 先检查仓库真实现状（目录树、package.json、git status），给出「准备新增 / 修改的文件清单 + 方案 + 风险 + 验收方式」，再动手。
3. 只完成本轮提示词指定的那一个阶段，做完即停。不顺手做下一阶段，不大规模重构无关文件。
4. 真实执行 lint / typecheck / unit test / build，并粘贴原始输出。无法运行的必须标记「未运行」并说明原因。
5. 结尾更新 docs/IMPLEMENTATION_STATUS.md：已完成 / 未完成 / 风险 / 测试结果 / 下一步建议。
6. 需求与文档冲突时，先指出冲突并停下，不要擅自扩大范围。"""

DOMESTIC_GLOBAL = """你是算法与数据结构工程师。你交付的 TypeScript 代码会被另一位工程师原样粘贴进工程，
并用 Vitest 逐条断言执行。因此请把「能被断言独立验证」当作唯一成功标准：正确性 > 优雅，确定性 > 巧妙。

【环境与限制】
- 目标：TypeScript 5.x（strict）、Vitest、Node 20 / 现代浏览器。
- 你看不到我的仓库，也没有任何既有代码可以参照。因此：
  · 不得假设任何你没有亲手写出来的类型、函数、常量、配置存在；
  · 需要的类型一律在交付包内自行完整定义并导出；
  · import 只允许指向我在「交付物」里明确给出的相对路径，其余零依赖。
- 禁止任何第三方库（chroma.js / culori / d3 / lodash / delta-e 等一律不许）。
- 禁止 DOM、Canvas、window、document、fetch、fs、process、localStorage、requestAnimationFrame。
- 必须是纯函数：相同输入必得相同输出。禁止 Math.random、Date.now、performance.now，
  禁止依赖对象键顺序、Map / Set 插入顺序、数组 sort 的不稳定行为（比较函数必须给全序）。
- 所有阈值、容差、魔数必须集中定义成具名常量，并在注释里标明来源（标准编号 / 公式推导 / 经验值）。

【输出规范】
- 每个文件给出完整全文。「// 省略」「…」「其余同上」「参考上文实现」一律不接受。
- 不要写寒暄和空泛解释；解释只允许出现在我明确要求的 VECTORS.md / PARAMS.md / PROOF.md 里，
  且必须具体到公式、数字、推导步骤，不许出现「显著提升」「适当调整」这类模糊措辞。
- 交付末尾必须附「自检表」，逐条对照我给的验收清单，结论只能填「通过 / 不通过 / 未验证」并给出依据
  （依据必须是测试向量编号、推导步骤或行号，不许写「已检查」）。"""

HANDOFF_TEMPLATE = """【落地任务】上一轮由另一个模型交付了下面这批文件。你的工作只有「接入 + 验证」，不是重新实现。

要落地的文件：
{files}

1. 按指定路径原样创建这些文件。不允许改写函数名、参数顺序、导出名、类型字段名。
2. 若与既有代码存在类型冲突：只允许在调用侧做适配，不允许改核心实现。确需改动时先说明理由并列出差异清单。
3. 接入点：{integration}
4. 运行下面的命令并粘贴原始输出：
{cmds}
5. 如果测试失败：禁止修改断言、禁止放宽容差、禁止改实现去迎合测试。请先按下面格式把失败最小化回传给我：
   FAIL_CASE: 函数=<名称> | 输入=<可复制的最小输入> | 期望=<VECTORS 中的值> | 实际=<实测值> | 差异=<绝对误差>
6. 报告：文件清单 / 命令原始输出 / 失败用例 / 是否需要回传重做。"""

# ---------------------------------------------------------------- 阶段数据

STAGES = []


def S(**kw):
    STAGES.append(kw)


# ============================================================ 01
S(
    code="S01", anchor="s01", origin="原文 P0",
    title="仓库体检 · 色卡锁定 · 许可审计",
    group="立项", owner="cursor", days="2–4 天", deps="无（项目起点）",
    goal="在写第一行产品代码之前，先钉死两件会拖垮整个项目的事：仓库现状到底能不能用，真实色卡从哪里来、许可是否干净。这两件事没定，后面 14 个阶段全部建在流沙上。",
    outputs=[
        "docs/OSS_EVALUATION.md", "docs/LICENSE_AUDIT.md", "docs/ALGORITHM_REVIEW.md",
        "docs/IMPLEMENTATION_PLAN.md", "docs/PALETTE_DECISION.md",
        "src/core/palette/fixtures/<brand>@<version>.json", "scripts/validate-palette.mjs",
    ],
    task="""1) 仓库体检
   - 报告：是否为空仓库、有无 package.json、现有 src 结构、git 状态、有无历史遗留代码。
   - 若能 install / build / test，真实跑一遍并贴输出；跑不了就写明卡在哪一步。

2) 色卡锁定（本阶段唯一不可延期的产出）
   - 产出至少一套可直接投产的色卡 JSON，字段固定为：
     { "paletteId": string, "brand": string, "series": string, "version": string,
       "sourceUrl": string, "license": string, "fetchedAt": string,
       "colors": [ { "code": string, "name": string, "hex": "#RRGGBB" } ] }
   - 每条颜色必须能溯源到 sourceUrl；hex 统一为归一化大写 #RRGGBB。
   - 必须写清「官方色号 → 屏幕 HEX」的转换方式（官方公开 / 第三方实测 / 你自己换算），
     以及由此产生的不确定性（例如官方只给近似色名，HEX 只能按厂商图取色）。文字要具体，不许含糊。
   - 若找不到许可清晰的数据源：禁止编造。改为输出《色卡数据获取清单》——
     把需要我提供的品牌、系列、字段、格式写清楚，并保留一份只含 3–5 条示例的模板文件。

3) 许可证审计
   - 列出你计划使用的每个第三方包 / 数据集：名称、版本、许可证、是否允许商业分发、
     是否需保留 NOTICE、是否存在传染性（GPL 类）。逐条给结论，不要只列清单。

4) 算法落地拆解（只拆解，不实现）
   - 把规格 4.1 的流程拆成函数级步骤清单，每步写明：输入类型、输出类型、失败模式、能否纯函数化。
   - 标注哪些步骤可以脱离浏览器在 Node 里被测（这些后续外包给纯算法模型），
     哪些必须依赖 Canvas / 浏览器与真实文件（这些你自己做）。这份标注将决定后面谁在做哪一段。

5) 写一个可真实运行的色卡校验脚本 scripts/validate-palette.mjs
   - 校验：hex 格式合法、色号唯一、hex 唯一、字段齐全、colors 非空、version 非空。
   - 校验失败必须以非 0 退出码结束（不许 try 之后静默通过）。""",
    cmds=[
        "node scripts/validate-palette.mjs \"src/core/palette/fixtures/<你的色卡文件>.json\"",
        "git status --short",
    ],
    risk="色卡许可若无法确认，S03 之后所有阶段都建立在不可信数据上。宁可只交一份示例模板 + 获取清单，也不要造数据。",
    handoff="",
)

# ============================================================ 02
S(
    code="S02", anchor="s02", origin="原文 P1",
    title="工程骨架与质量门禁",
    group="立项", owner="cursor", days="2–3 天", deps="S01",
    goal="把「能跑质量门禁」这件事变成常态。后面每个阶段的验收都靠这套命令，它必须先绿、必须可信。",
    outputs=[
        "React + TS + Vite + pnpm 工程", "tsconfig（strict）", "ESLint / Prettier / Vitest 配置",
        "src/{app,components,features,core,workers,render,storage,export,test}",
        "docs/IMPLEMENTATION_STATUS.md",
    ],
    task="""1) 工程初始化
   - React + TypeScript + Vite + pnpm；提交 pnpm-lock.yaml。
   - tsconfig 打开 strict、noUncheckedIndexedAccess、noImplicitOverride、exactOptionalPropertyTypes。
   - ESLint + Prettier + Vitest（jsdom 环境按需）。

2) 目录骨架（严格按此命名，命名本身是范围约束）
   src/app、src/components、src/features/{image-import,image-crop,generation-settings,
   pattern-preview,palette-panel,quality-report,export}、src/core、src/workers、src/render、
   src/storage、src/export、src/state、src/test。
   - 注意：是 pattern-preview，不是 pattern-editor。这个命名就是一期边界，不许改。

3) 页面空壳
   - 三栏工作区骨架：左侧参数面板 / 中央画布区 / 右侧颜色面板 + 底部状态栏 + 顶部导航。
   - 统一的加载态、空状态、错误提示组件（错误必须能被用户看到并重试，不许 alert）。
   - 骨架阶段所有面板可以是空态占位，但每个按钮要么有真实行为，要么不渲染。禁止渲染死按钮。

4) 最小类型与纯函数占位
   - 只建立 ImageMode / DitheringMode / BeadColor / BeadPattern 的类型骨架，
     以及 validatePattern() / computeStats() 的签名与「未实现」显式抛错（抛出带 code 的错误，不许返回假数据）。
   - 本阶段不实现任何图像算法。

5) package scripts：dev / build / lint / typecheck / test / test:e2e（e2e 可先空跑占位）。""",
    cmds=["pnpm install", "pnpm lint", "pnpm typecheck", "pnpm test", "pnpm build"],
    risk="最容易在这里埋下「死按钮」和「假数据占位」。占位一律用显式报错，不要用看起来像真的样例数据。",
    handoff="",
)

# ============================================================ 03
S(
    code="S03", anchor="s03", origin="原文 P2",
    title="图纸数据模型 · 统计 · JSON 编解码",
    group="立项", owner="cursor", days="3–4 天", deps="S02",
    goal="把 BeadPattern 定成整个项目的合同。后面 12 个阶段、两个模型的所有代码都对齐这份类型和不变量。",
    outputs=[
        "src/core/pattern/types.ts", "src/core/pattern/validate.ts",
        "src/core/pattern/stats.ts", "src/core/pattern/codec.ts",
        "src/core/pattern/*.test.ts",
    ],
    task="""1) 类型（严格对齐规格 5.1，字段名一个都不许改）
   BeadColor / BeadPattern / GenerationSettings / PaletteDefinition / QualityDiagnostic / ImageMode / DitheringMode / ColorMetricName。
   cells 内存中用 Int16Array，-1 表示空格。

2) 不变量校验 validatePattern()
   - cells.length === width * height
   - 每格 ∈ {-1} ∪ [0, palette.length)
   - palette 内 code 唯一、hex 唯一
   - width / height 为正整数且在配置上限内
   - 失败时抛出带 code 的类型化错误（错误码如 E_CELLS_LENGTH、E_INDEX_OUT_OF_RANGE、E_DUP_CODE），
     不许 throw 字符串，不许返回 null 让调用方猜。

3) 颜色用量统计 computeStats()
   - 从 cells 重新扫描，空格 -1 不计数。
   - 输出每色 { code, name, hex, count, percentage }。
   - 内部断言 sum(counts) === nonEmptyCells，不一致必须抛错而不是修正。

4) 版本化 JSON 编解码 encodeProject / decodeProject
   - 序列化：Int16Array → 普通 number[]；反序列化：number[] → new Int16Array(arr)。
     禁止依赖 JSON.stringify(Int16Array) 的默认行为（它产出对象而不是数组）。
   - 必须写入 schemaVersion / paletteId / paletteVersion / paletteHash（若无 hash 则写明 TODO 并留字段）。
   - decode 必须做：schema 校验、尺寸上限校验、索引越界校验、palette 引用存在性校验、未知 schemaVersion 明确拒绝。
   - 预留 migrate(raw, fromVersion) 钩子，当前只实现 1.0 → 1.0 恒等，但要留出结构与注释。

5) 单元测试必须覆盖
   - 非法索引、cells 长度不符、0×0 空图、重复色号、未知 schemaVersion、超大尺寸拒绝、
   - 编码 → 解码往返后矩阵与全部参数完全一致、
   - 统计总和等于非空格数。""",
    cmds=["pnpm typecheck", "pnpm vitest run src/core/pattern", "pnpm build"],
    risk="JSON 编解码是保存 / 导出的命门。往返测试必须比对到每个格子，不能只比长度。",
    handoff="",
)

# ============================================================ 04
S(
    code="S04", anchor="s04", origin="原文 P4（拆出）",
    title="颜色科学内核：sRGB / Lab / Oklab / CIEDE2000",
    group="内核", owner="domestic", days="2–3 天", deps="S03",
    goal="整条流水线的地基。这一层错了，后面所有色卡匹配、抖动、诊断全错，而且错得很隐蔽——图看起来还行，但颜色永远配不准。",
    files=[
        "src/core/color/types.ts",
        "src/core/color/srgb.ts",
        "src/core/color/lab.ts",
        "src/core/color/oklab.ts",
        "src/core/color/ciede2000.ts",
        "src/core/color/hex.ts",
        "src/core/color/index.ts",
        "src/core/color/VECTORS.md",
        "src/core/color/color.test.ts",
    ],
    task="""【函数签名必须逐字照抄，不许改名、不许加参数、不许改返回结构】
```ts
// types.ts
export interface RGB { r: number; g: number; b: number }   // 0–255
export interface Lab { L: number; a: number; b: number }   // CIE L*a*b*, D65
export interface Oklab { L: number; a: number; b: number }
export type ColorMetricName = "ciede2000" | "oklab";

// srgb.ts
export function srgbToLinear(c: number): number;   // 输入 0–1
export function linearToSrgb(c: number): number;   // 输出 0–1

// lab.ts
export function rgbToLab(rgb: RGB): Lab;
export function labToRgb(lab: Lab): RGB;           // 结果 clamp 到 0–255 并四舍五入

// oklab.ts
export function rgbToOklab(rgb: RGB): Oklab;
export function oklabToRgb(ok: Oklab): RGB;

// ciede2000.ts
export function deltaE2000(a: Lab, b: Lab): number;
export function deltaEOklab(a: Oklab, b: Oklab): number;

// hex.ts
export function hexToRgb(hex: string): RGB;        // 支持 #abc / #AABBCC / 大小写
export function rgbToHex(rgb: RGB): string;        // 输出大写 #RRGGBB
```

【实现要求】
1. sRGB 传递函数用标准分段式（线性段斜率 12.92，伽马段 1.055/2.4，阈值 0.0031308 / 0.04045）。
2. XYZ 使用 sRGB D65 矩阵，白点 Xn=0.95047、Yn=1.0、Zn=1.08883，写进具名常量并注明来源。
3. Oklab 必须走标准 M1/M2 矩阵路线（线性 sRGB → LMS → 立方根 → Lab），不要用近似幂函数替代。
4. CIEDE2000 必须完整实现：kL=kC=kH=1，色相角用 atan2 归一化到 [0,360)，
   色相差 Δh 必须处理 ±360 回绕，旋转项 RT 与 SL/SC/SH 全部按 CIE 标准公式。
5. 输入越界（NaN、负数、>255）的行为必须明确选择「抛错」或「clamp」，二者选一并写进注释与 VECTORS.md，
   全包保持一致。
6. 不得缓存跨调用状态；不得使用全局可变变量。

【VECTORS.md 必须包含】
- 一张「CIEDE2000 标准验证对」表：至少 10 组，取自 Sharma / Wu / Dalal (2005) 公开的测试对，
  给出 Lab1、Lab2、期望 ΔE00、本实现输出、绝对误差。这是本阶段最重要的一张表。
- 一张往返表：黑 #000000、白 #FFFFFF、中灰 #808080、纯红、纯绿、纯蓝、
  以及 3 个随机但固定的中间色，给出 RGB → Lab → RGB 与 RGB → Oklab → RGB 的最大通道误差（0–255 尺度）。
- 一张边界表：hex 短写 #abc、大小写、非法输入（"#GGG"、"12ab"、空串）的预期行为。""",
    checklist=[
        "CIEDE2000 与标准测试对的绝对误差 ≤ 1e-4（逐条列出）",
        "RGB→Lab→RGB 往返最大通道误差 ≤ 1（0–255 尺度）",
        "RGB→Oklab→RGB 往返最大通道误差 ≤ 1（0–255 尺度）",
        "hex 短写 / 大小写 / 非法输入行为与 VECTORS.md 一致",
        "全包零 import、零第三方依赖、零 DOM 引用",
        "没有任何 Math.random / Date.now / 依赖遍历顺序的写法",
    ],
    warn="最大的翻车点是 CIEDE2000 的色相回绕与 RT 项。请先把 10 组标准测试对算到 1e-4 再往下写别的函数——先证明公式对，再谈代码整洁。",
    integration="src/core/color/index.ts 的导出将被 S05 色卡匹配、S07 抖动、S08 诊断三处直接 import，导出名必须与上面签名完全一致。",
    hcmds=["pnpm typecheck", "pnpm vitest run src/core/color", "pnpm build"],
    risk="若误差不达标，绝不允许放宽容差或改测试向量。这是纯数学，错了就是实现错了。",
)

# ============================================================ 05
S(
    code="S05", anchor="s05", origin="原文 P4（拆出）",
    title="色卡索引与最近邻匹配 · 颜色数上限",
    group="内核", owner="domestic", days="2–3 天", deps="S04",
    goal="把「一个 RGB 该落到哪个真实色号」做成可复用、可缓存、结果确定的索引层。这是用户最终买什么豆子的直接依据。",
    files=[
        "src/core/palette/types.ts",
        "src/core/palette/index-builder.ts",
        "src/core/palette/subset.ts",
        "src/core/palette/index.ts",
        "src/core/palette/VECTORS.md",
        "src/core/palette/palette.test.ts",
    ],
    task="""【函数签名逐字照抄】
```ts
// types.ts
export interface BeadColor {
  code: string; name: string; hex: string;
  manufacturer: string; series?: string;
}
export interface PaletteMatch { index: number; distance: number }
export interface PaletteIndex {
  readonly size: number;
  nearest(color: RGB, candidates?: readonly number[]): PaletteMatch;
}

// index-builder.ts
export function buildPaletteIndex(
  palette: readonly BeadColor[],
  metric: ColorMetricName
): PaletteIndex;

// subset.ts
export function selectPaletteSubset(
  samples: readonly RGB[],
  palette: readonly BeadColor[],
  maxColors: number,
  metric: ColorMetricName
): number[];   // 返回升序的 palette 索引
```
可 import 的唯一外部路径：`../color`（S04 交付的 rgbToLab / rgbToOklab / deltaE2000 / deltaEOklab / hexToRgb）。

【实现要求】
1. buildPaletteIndex 内部一次性把色卡转成目标色彩空间并缓存（Lab 或 Oklab 二选一，由 metric 决定）。
2. nearest 必须支持 candidates 子集查询（后续抖动 / 局部优化要高频繁用）。
3. 距离完全相等时，必须取 index 更小的那个（写死，保证确定性）。
4. 色卡为空、含非法 hex、含重复 code 时，buildPaletteIndex 必须抛带 code 的错误。
5. selectPaletteSubset（对应规格「最大颜色数」约束，必须严格实现）：
   - 结果必须 ⊆ palette 的真实颜色索引，禁止产生混合 / 平均出来的合成色（这是规格红线）。
   - 用加权 k-medoids：medoid 只能是真实色卡色；样本权重为出现次数。
   - 初始化必须确定性：第一个 medoid 取「覆盖样本最多」的色卡色（并列取索引小者）；
     之后每次取「到已选集合最小距离 × 权重」之和最大的样本所对应的最近色卡色。
   - maxColors >= palette.length 时，返回全部索引（升序）。
   - maxColors <= 0、样本为空、palette 为空时，抛带 code 的错误（不要静默返回空数组）。
6. 复杂度写进注释：说明为什么在 ≤ 500 色的规模下线性扫描足够，不要引入 KD-tree 过度设计。

【VECTORS.md 必须包含】
- 3 色极小色卡上，若干 RGB 的最近邻结果与距离（手算过程写出来）。
- 平局构造：两个色卡色到同一 RGB 距离相等时，返回较小 index 的证明。
- selectPaletteSubset 在 10 色色卡 + 指定样本分布 + maxColors=4 时的完整期望输出索引数组。""",
    checklist=[
        "平局必取较小 index，且有构造用例",
        "selectPaletteSubset 结果严格 ⊆ palette 且长度 = min(maxColors, palette.length)",
        "非法输入全部抛带 code 的错误，无静默返回",
        "同输入连续调用两次结果完全一致",
        "零第三方依赖，仅 import ../color",
    ],
    warn="最常见的错误是「用样本均值当颜色」——那会造出真实色卡里不存在的颜色，且用户买不到。任何返回颜色必须是 palette 里的某一项。",
    integration="src/core/palette/index.ts 将被 S06 之后的生成流水线与 S13 导出直接 import。",
    hcmds=["pnpm typecheck", "pnpm vitest run src/core/palette", "pnpm build"],
    risk="selectPaletteSubset 的初始化若用了随机种子，必须落成固定常量序列，否则整条链路不可复现。",
)

# ============================================================ 06
S(
    code="S06", anchor="s06", origin="原文 P3",
    title="图片输入 · 裁剪 · 面积采样",
    group="生成链路", owner="cursor", days="3–4 天", deps="S02, S03",
    goal="把用户随手一张照片变成「每格一个代表色」的规整采样矩阵。这一步决定了细节能不能留得住，也是所有浏览器 API 风险最集中的地方。",
    outputs=[
        "src/features/image-import/", "src/features/image-crop/",
        "src/core/sampling/*.ts", "src/core/sampling/*.test.ts",
        "src/core/image/validate.ts",
    ],
    task="""1) 图片导入与真实校验
   - 支持 JPG / PNG / WebP。不仅看扩展名和 MIME，必须校验文件头魔数
     （FFD8FF / 89504E47 / RIFF....WEBP），并确认 createImageBitmap 真的解码成功。
   - 硬限制：单文件 ≤ 20MB、单边 ≤ 8192px、总像素 ≤ 4000 万。超限给明确文案并拒绝，不许静默降级。
   - 损坏文件必须走可恢复的错误路径（提示 + 可重选），不许白屏、不许 console 一扔了之。

2) EXIF 方向
   - 用 createImageBitmap(file, { imageOrientation: "from-image" }) 处理；
     若浏览器不支持该选项，必须回退并提示，不许让图片倒着处理。

3) 裁剪
   - 自由裁剪、锁定比例、按目标图纸宽高比自动适配（fill / contain 由用户选，默认 fill）。
   - 裁剪结果以源图像素坐标记录到 source.crop，写进 BeadPattern。

4) 透明策略
   - 默认 "empty"（空格，不拼豆子），可选 "background" + backgroundHex。
   - 透明度信息不得在采样中被静默丢掉：输出必须保留每格 alpha。

5) 面积采样（核心，放 src/core/sampling，纯函数）
   签名固定为：
   export function sampleToGrid(img: ImageData, gridW: number, gridH: number,
     crop: { x: number; y: number; width: number; height: number },
     alphaPolicy: "empty" | "background", backgroundHex?: string
   ): { rgb: Uint8ClampedArray; alpha: Uint8Array };   // 长度均为 gridW*gridH*3 / *1
   - 每个输出格 = 对应源区域按面积加权的平均色（sRGB 空间加权，不转线性光）。
   - 权重必须是真实覆盖面积，处理格子边界与像素边界不对齐的情况（非整数比）。
   - 采样区域小于 1 个像素时（放大网格），必须退化为最近的单像素，不许出现 0 面积。
   - alpha 为本格平均 alpha；alphaPolicy="empty" 且平均 alpha < 阈值（默认 128）时标记为该格为空，
     该判定必须写在 VECTORS 里并注明阈值。

6) 单元测试
   - 2×2 纯色 → 1×1 网格：期望为该四色面积平均，给出精确数值。
   - 4×4 灰阶渐变 → 2×2 网格：给出手算期望值。
   - 1×1 全透明像素 + empty 策略 → 该格 alpha=0 且标记为空。
   - 非整数比例（源 7×5 → 网格 3×2）：断言权重总和为 1，不出现 0 面积。
   - 损坏文件 / 超限文件：断言走错误分支。

7) 本阶段不做的事
   - 不做色卡匹配（S04/S05 已就绪，但接入放到 S07 及之后的流水线装配里）。
   - 不接 Worker（S10 统一接入）。但必须保证 sampleToGrid 是纯函数、无 DOM 依赖，
     便于将来整体搬进 Worker——这条要写进注释。""",
    cmds=["pnpm typecheck", "pnpm vitest run src/core/sampling", "pnpm build"],
    risk="面积采样最容易在「非整数缩放」上出偏差：权重没归一化会导致整体偏亮或偏暗，肉眼很难发现但会导致颜色统计整体漂移。必须用测试锁死。",
    handoff="",
)

# ============================================================ 07
S(
    code="S07", anchor="s07", origin="原文 P4（拆出）",
    title="确定性抖动：Floyd–Steinberg",
    group="内核", owner="domestic", days="1–2 天", deps="S04, S05",
    goal="给渐变区域补上「用有限色卡模拟更多层次」的能力，同时保证结果完全可复现——抖动一旦不确定，整个项目的测试体系就废了。",
    files=[
        "src/core/dithering/types.ts",
        "src/core/dithering/floyd-steinberg.ts",
        "src/core/dithering/index.ts",
        "src/core/dithering/VECTORS.md",
        "src/core/dithering/dithering.test.ts",
    ],
    task="""【函数签名逐字照抄】
```ts
// types.ts
export interface DitherOptions {
  strength: number;    // 0–1，误差扩散强度的缩放系数，默认 1
  metric: ColorMetricName;
}
export interface DitherResult {
  indices: Int16Array;        // 长度 = width*height；-1 表示空格
  residualError: number;      // 全部被丢弃的边界误差绝对值之和，用于诊断
}

// floyd-steinberg.ts
export function floydSteinberg(
  samples: readonly RGB[],       // 长度 = width*height，行优先
  alphaMask: readonly boolean[], // true = 空格，不参与扩散
  width: number,
  height: number,
  palette: readonly BeadColor[],
  index: PaletteIndex,
  options: DitherOptions
): DitherResult;
```
可 import 的唯一外部路径：`../color`、`../palette`。

【实现要求（这些是实现契约，不是建议）】
1. 遍历顺序写死：从左到右，从上到下。不做蛇形扫描（蛇形会破坏确定性测试的可读性）。
2. 误差扩散系数写死为 7/16、3/16、5/16、1/16，对应右、左下、下、右下。
3. 边界误差直接丢弃，不回绕到下一行行首。丢弃量必须累加进 residualError。
4. strength 缩放扩散误差量（newErr = err * strength），默认 1；strength=0 时必须退化为逐格最近邻。
5. alphaMask 为 true 的格子：输出 -1，且不接收、不发射误差。
6. 量化必须走 PaletteIndex.nearest，不许自己再写一遍最近邻。
7. 内部使用 Float32Array 保存累积浮点颜色，禁止用整数中间值（会导致误差被截断）。

【VECTORS.md 必须包含（这是本阶段验收的核心）】
- 一个 3×3 灰度输入 + 2 色色卡（#000000 / #FFFFFF）的完整手算表：
  逐格写出「累积值 → 最近色 → 误差 → 扩散到邻居的各分量」，
  最后一格一列列出最终 indices 数组与 residualError 的精确值。
- strength=0 与 strength=1 两种结果的对比表。
- 一个含 alphaMask 的用例，证明空格切断扩散链。""",
    checklist=[
        "3×3 手算用例逐格一致（含 residualError 精确相等）",
        "strength=0 时结果等于逐格最近邻（构造对拍用例）",
        "遍历顺序与扩散系数与规格逐字一致",
        "空格不接收也不发射误差",
        "同输入两次调用结果完全一致",
        "仅 import ../color 与 ../palette",
    ],
    warn="手算表必须真的手算，不能靠跑代码回填——如果实现和手算不一致，是其中一方错了，必须查清而不是改表。residualError 的浮点累加顺序写死（行优先），否则末位会出现 1e-7 级差异。",
    integration="src/core/dithering/index.ts 由 S10 的生成流水线在 settings.dithering === 'floyd-steinberg' 时调用。",
    hcmds=["pnpm typecheck", "pnpm vitest run src/core/dithering", "pnpm build"],
    risk="浮点累加顺序不确定会导致末位误差，进而让「确定性测试」随机失败。累加路径必须在实现里写死并注释。",
)

# ============================================================ 08
S(
    code="S08", anchor="s08", origin="原文 P4（拆出）",
    title="质量诊断：孤立豆 · 碎片 · 细线 · 高色差",
    group="内核", owner="domestic", days="2–3 天", deps="S03",
    goal="把「这张图拼出来会不会很废」变成用户看得懂的具体条目，而不是一个看起来精确但没有意义的百分比。这是产品可信度的来源。",
    files=[
        "src/core/quality/types.ts",
        "src/core/quality/isolated.ts",
        "src/core/quality/fragments.ts",
        "src/core/quality/thin-runs.ts",
        "src/core/quality/report.ts",
        "src/core/quality/index.ts",
        "src/core/quality/VECTORS.md",
        "src/core/quality/quality.test.ts",
    ],
    task="""【函数签名逐字照抄】
```ts
// types.ts
export interface PatternView { width: number; height: number; cells: Int16Array }

export interface FragmentInfo { size: number; cells: number[] }
export interface ThinRunInfo { row: number; col: number; length: number; orientation: "h" | "v" }

export interface DiagnosticReport {
  isolated: number[];              // 孤立豆格索引，升序
  fragments: FragmentInfo[];       // 小碎片，按 size 升序、同 size 按最小索引升序
  thinRuns: ThinRunInfo[];         // 细线风险，按 row、col 升序
  highDelta: number[];             // 高色差格索引，升序
  nonEmptyCells: number;
}

// isolated.ts
export function findIsolated(p: PatternView): number[];
// fragments.ts
export function findFragments(p: PatternView, maxSize: number): FragmentInfo[];
// thin-runs.ts
export function findThinRuns(p: PatternView, minRun: number): ThinRunInfo[];
// report.ts
export function buildReport(
  p: PatternView,
  perCellDelta: Float32Array,      // 长度 = width*height，空格位置忽略
  options: { maxFragmentSize: number; minThinRun: number; highDeltaThreshold: number }
): DiagnosticReport;
```
可 import 的唯一外部路径：无（本包自包含）。

【定义必须写死，逐字实现】
1. 邻域：4-邻域（上 / 下 / 左 / 右），不含对角。
2. 孤立豆：非空格，且 4-邻域内不存在与之同色的格子。越界视为「不同色」。
3. 碎片：同色的 4-连通分量，size ≤ maxFragmentSize。size 为 1 的分量同时也是孤立豆（允许重复计数，但在 VECTORS 里说明）。
4. 细线风险：某行（或某列）上连续同类游程长度 < minRun 的段。游程「同类」定义为同一色号。
   输出 row / col 取游程起点，orientation 区分水平段与垂直段。同一个格子同时属于横竖两段时允许输出两条。
5. 高色差：perCellDelta[i] > highDeltaThreshold 且该格非空。
6. 输出顺序必须确定（见签名注释），不许依赖 Map 迭代顺序。

【禁止】
- 不许输出「质量评分 87%」「还原度 92%」这类没有可靠定义的数字。本模块只输出可解释的计数与位置。
- 不许自动删除或修改任何格子。诊断只读。

【VECTORS.md 必须包含】
- 5 个手绘微型 pattern（3×3 到 5×5），每个给出 cells 数组、期望 isolated / fragments / thinRuns 的精确结果。
  至少一个用例要证明「对角相邻不算连通」。
- 一个空格被色块包围的用例，证明空格不会被判为孤立豆。
- 复杂度分析：说明本模块为 O(w*h)，不使用递归 DFS（避免大图爆栈），必须用显式栈或并查集。""",
    checklist=[
        "5 个手绘用例断言精确相等（不是「大于 0」这种弱断言）",
        "对角相邻不被判为连通",
        "空格不参与孤立豆判定，也不参与碎片统计",
        "输出顺序完全确定",
        "无递归实现（大图不爆栈）",
        "零 import、零依赖",
    ],
    warn="连通分量最容易写成递归 DFS，200×200 的满色图会直接爆栈。必须用显式栈或并查集，并在注释里说明选择理由。",
    integration="src/core/quality/index.ts 由 S12 的右侧诊断面板与 S13 的 PDF 图例调用。",
    hcmds=["pnpm typecheck", "pnpm vitest run src/core/quality", "pnpm build"],
    risk="语义漂移：产品文案写「孤立点」而代码判「4-邻域」，一旦不一致用户会认为工具在乱报。定义必须同步进 docs。",
)

# ============================================================ 09
S(
    code="S09", anchor="s09", origin="原文 P4（拆出）",
    title="四模式策略与局部优化目标函数",
    group="内核", owner="domestic", days="3–4 天", deps="S05, S08",
    goal="让同一张图在 photo / anime / logo / landscape 四种模式下产出明显不同的图纸。这是「高还原度」的落点，也是唯一需要靠参数调优而非纯正确性的模块。",
    files=[
        "src/core/modes/types.ts",
        "src/core/modes/profiles.ts",
        "src/core/modes/refine.ts",
        "src/core/modes/index.ts",
        "src/core/modes/PARAMS.md",
        "src/core/modes/modes.test.ts",
    ],
    task="""【函数签名逐字照抄】
```ts
// types.ts
export interface ModeProfile {
  defaultDithering: "none" | "floyd-steinberg";
  allowUserDithering: boolean;      // anime / logo 为 false（强制关闭）
  edgeProtectWeight: number;        // 边缘保护强度
  isolatedPenalty: number;          // 孤立点惩罚
  colorMergeThreshold: number;      // ΔE 小于该值的相邻色视为可合并
  localRefinePasses: number;        // 局部优化迭代轮数
  neighborCandidateCount: number;   // 每格参与比较的邻近色卡数量
}

export interface RefineOptions {
  width: number; height: number;
  cells: Int16Array;
  palette: readonly BeadColor[];
  index: PaletteIndex;
  metric: ColorMetricName;
  perCellDelta: Float32Array;       // 每格原始采样色到当前色的 ΔE
  edgeStrength: Float32Array;       // 每格边缘强度 0–1，由调用方提供
  profile: ModeProfile;
}

export function getModeProfile(mode: ImageMode): ModeProfile;
export function refineLocally(options: RefineOptions): Int16Array;   // 返回新数组，不修改入参
```
可 import 的唯一外部路径：`../color`、`../palette`。

【实现要求】
1. 四个 profile 的默认值必须逐条对齐规格 4.4 的表格：photo=可手动开弱 FS、anime=强制关、logo=强制关、landscape=可手动开。默认一律 none。
2. 目标函数必须写成可读公式，并实现为独立可测函数：
   score = ΔE(cell, candidate) * 1
         + isolatedPenalty * (该候选是否造成 4-邻域孤立)
         + edgeProtectWeight * (边缘格改色惩罚)
   - 所有权重为 0 时，refineLocally 输出必须严格等于输入（这是最强的回归断言）。
3. 候选集：每格只比较「当前色 + 最近邻前 N 个色卡色」，N = neighborCandidateCount（默认 8）。必须确定性生成。
4. 迭代：row-major 扫描 localRefinePasses 轮；每轮结束后若没有任何格子变化则提前退出。
5. 必须幂等或收敛：连续两次调用（第二次以第一次结果为输入）结果必须相同，或变化格数为 0。这是硬要求。
6. 禁止修改 cells 以外的任何东西；禁止在函数内部做 I/O 或缓存。

【PARAMS.md 必须包含】
- 每个参数：作用、可观察效果（画面会怎样变）、默认值、调整方向、建议调参顺序。
- 明确写出「哪些参数不要动」（例如 colorMergeThreshold 调太大会吃掉眼睛高光）。
- 一段反例说明：把 isolatedPenalty 调到极大时会发生什么（图纸变糊、细线断裂），用文字解释机制。""",
    checklist=[
        "权重全 0 时输出严格等于输入（逐格断言）",
        "四模式默认抖动值与规格表格逐条一致",
        "neighborCandidateCount 候选集确定性生成",
        "连续两次调用结果稳定（幂等或有明确收敛判据）",
        "不修改入参 cells（用 Object.freeze 或前置快照断言）",
        "PARAMS.md 每个参数都有可观察效果描述，无模糊措辞",
    ],
    warn="这个模块是唯一「没有唯一正确答案」的模块。因此不要试图在纯函数里塞进主观审美——把权重暴露成参数，默认值给保守值，让 Cursor 在真实图片上做后续调参。你的责任是机制正确 + 可调 + 可复现。",
    integration="refineLocally 由 S10 的生成流水线在采样 → 匹配 → 抖动之后调用；getModeProfile 由 S12 的参数面板读取以决定抖动开关是否可点。",
    hcmds=["pnpm typecheck", "pnpm vitest run src/core/modes", "pnpm build"],
    risk="如果 refinement 不收敛，生成耗时会随 passes 线性上升且结果不可复现。幂等断言是这一阶段的生命线。",
)

# ============================================================ 10
S(
    code="S10", anchor="s10", origin="原文 P4（装配）",
    title="生成流水线装配 · Worker · 进度 · 取消 · 竞态",
    group="生成链路", owner="cursor", days="4–5 天", deps="S06, S07, S08, S09",
    goal="把所有算法模块缝成一条能跑、能看进度、能取消、不会串结果的流水线。这是产品第一次真正「能出图」。",
    outputs=[
        "src/core/pipeline/generate.ts", "src/workers/generate.worker.ts",
        "src/core/pipeline/protocol.ts", "src/state/generation.ts",
        "src/core/pipeline/*.test.ts",
    ],
    task="""1) 流水线装配（纯函数编排，放 src/core/pipeline/generate.ts）
   顺序固定：采样 → 色卡子集选择（maxColors）→ 最近邻匹配 → 可选抖动 → 局部优化 → 诊断 → 统计 → BeadPattern。
   - 每步之间不做隐式降级；任一步抛错则整体失败并保留错误 code。
   - 输出必须是完整 BeadPattern（含 schemaVersion / paletteId / paletteVersion / settings / source）。

2) Worker 协议（src/core/pipeline/protocol.ts）
   - 请求：{ type:"generate", taskId, payload }、{ type:"cancel", taskId }
   - 响应：{ type:"progress", taskId, stage, done, total }、
           { type:"done", taskId, pattern }、{ type:"error", taskId, code, message }
   - 大数组用 Transferable 传递（cells 的 ArrayBuffer），避免结构化克隆拷贝。

3) 进度必须真实
   - done / total 来自实际处理格数或实际阶段完成数，不许用定时器造进度条。
   - 每个阶段都有名字（采样 / 选色 / 匹配 / 抖动 / 优化 / 诊断），状态栏显示阶段名 + 百分比。

4) 取消
   - 在阶段边界与匹配循环内设置检查点；收到 cancel 后尽快退出并回错误 code = "E_CANCELLED"。
   - 取消后 UI 必须回到可重试状态，不得残留半成品 Pattern。

5) 竞态保护
   - 维护单调递增 taskId；任何响应在落地前必须比对当前 taskId，不匹配直接丢弃。
   - 组件卸载后到达的响应不得 setState。

6) 测试
   - 单元测试：用 mock postMessage 驱动协议，覆盖 done / error / cancel 三条路径。
   - 竞态测试：发起 A → 取消 A → 发起 B → 断言最终 state 只来自 B。
   - 断言：同一输入 + 同一参数两次生成，cells 逐格相同（确定性回归）。

7) 本阶段不做
   - 不做预览渲染（S11）、不做导出（S13）。生成完成后只把 Pattern 放进 state 并显示「生成完成」。""",
    cmds=["pnpm typecheck", "pnpm vitest run src/core/pipeline", "pnpm build"],
    risk="竞态是这里唯一的致命 bug 来源。taskId 校验必须写在「落地」那一刻，而不是请求发出时。",
    handoff="",
)

# ============================================================ 11
S(
    code="S11", anchor="s11", origin="原文 P5（拆出）",
    title="只读预览画布：缩放 · 平移 · 网格 · 对照",
    group="输出与验收", owner="cursor", days="4–5 天", deps="S10",
    goal="把 Pattern 画成用户能真正看清的图纸：能放大看单格、能平移、能开关网格、能和原图对照。全程只读。",
    outputs=[
        "src/features/pattern-preview/", "src/render/canvas-renderer.ts",
        "src/features/palette-panel/（只读高亮）", "src/features/quality-report/",
    ],
    task="""1) 渲染器（src/render/canvas-renderer.ts，纯函数 + Canvas 2D）
   - 输入 BeadPattern + viewTransform（scale / offsetX / offsetY）+ 显示选项，输出绘制指令。
   - 只读同一份 Pattern 数据，渲染层不得自行计算或修改颜色矩阵。
   - 按可视区域裁剪渲染（只画屏幕内的格子），避免整图重绘。
   - 网格线密度随 scale 自动调整：scale 太小时不画网格，避免糊成一片。

2) 交互
   - 缩放：滚轮以鼠标位置为锚点；按钮放大 / 缩小 / 适应窗口 / 100%。
   - 平移：按住空格拖拽或中键拖拽（选一种并写进帮助文案）。
   - 网格开关、坐标开关、色号显示开关（色号只在 scale 足够大时可用，否则置灰并说明原因）。
   - 原图 / 结果对照：并排或滑块擦除，二选一实现。

3) 右侧颜色面板（只读）
   - 显示色号、色名、色块、颗数、占比。
   - 点击色号 → 在画布上高亮该色（其他色降低不透明度），再次点击取消高亮。
   - 绝对禁止出现「替换颜色」「编辑此色」入口。

4) 质量诊断面板（读 S08 的报告）
   - 分类列出：孤立豆数量、小碎片数量、细线风险、高色差格数量。
   - 点击某一项 → 画布定位并高亮对应格子（只读高亮，不可修改）。
   - 输出「可操作建议」文案（例如「细节低于单豆尺寸，建议把网格加到 120 宽以上」），不许输出无依据的百分比评分。

5) 边界条件
   - 200×200 网格首帧渲染必须可接受（记录实测耗时）；1×1、1×500 这类极端尺寸不得崩。
   - 缩放 / 平移不得改变真实图纸数据（用快照断言：操作前后 JSON 序列化完全一致）。

6) 硬性禁止
   - 画布上不得绑定任何会写入 cells 的事件；不得出现选中格 / 画笔 / 橡皮 / 填充 / 吸管的代码路径。""",
    cmds=["pnpm typecheck", "pnpm test", "pnpm build"],
    risk="最容易「顺手」加一个点击改色。请在提交前全局搜索 paint / brush / eraser / fill / editCell 等关键字，确认零命中。",
    handoff="",
)

# ============================================================ 12
S(
    code="S12", anchor="s12", origin="原文 P5（拆出）",
    title="分页切片几何（PDF 拼版数学）",
    group="内核", owner="domestic", days="1–2 天", deps="S03",
    goal="把一张 200×200 的大图纸切成能打印、能拼起来的 A4 页面。这是纯几何题，但算错一格的代价是用户整张图拼不上。",
    files=[
        "src/core/export/geometry/types.ts",
        "src/core/export/geometry/paginate.ts",
        "src/core/export/geometry/PROOF.md",
        "src/core/export/geometry/paginate.test.ts",
    ],
    task="""【函数签名逐字照抄】
```ts
// types.ts
export interface SliceRequest {
  width: number;         // 图纸总列数
  height: number;        // 图纸总行数
  maxColsPerPage: number;
  maxRowsPerPage: number;
  overlap: number;       // 重叠格数，1–4，默认 2
}
export interface PageSlice {
  page: number;          // 从 1 开始
  row: number; col: number;   // 页在拼版矩阵中的位置，从 0 开始
  x0: number; y0: number;     // 该页左上角在图纸中的格坐标
  cols: number; rows: number; // 该页实际包含的格数（含重叠）
  overlapRight: number; overlapBottom: number;  // 向右 / 向下与下一页重叠的格数
  isLastCol: boolean; isLastRow: boolean;
}
// paginate.ts
export function computePages(req: SliceRequest): PageSlice[];
```

【正确性要求 —— 这四条必须写成定理并在 PROOF.md 里证明】
T1 完整性：图纸中任意一格 (x,y) 至少被某一页的「非重叠核心区」覆盖一次，不重不漏。
T2 重叠精确：任意水平相邻两页之间，重叠列数恰好等于 min(overlap, 实际可用列数)。
T3 边界安全：任意页的 x0+cols ≤ width、y0+rows ≤ height，不越界、不产生空白补格。
T4 页数最少：在满足 T1–T3 的前提下，页数等于 ceil 的贪心下界（给出下界推导）。

【确定性】
- 页码顺序：先行后列（row-major），page 从 1 连续递增。
- 相同请求两次调用输出完全一致（深比较相等）。

【边界处理（必须逐条给结论，不许含糊）】
- width < maxColsPerPage：单页，cols = width，overlapRight = 0。
- overlap ≥ maxColsPerPage：抛错 E_OVERLAP_TOO_LARGE（重叠不能吃掉整页）。
- width = 1、height = 1、maxColsPerPage = 1：必须正常返回单页。
- overlap = 0：允许，但相邻页之间不重叠（此时 T2 退化为 0）。

【PROOF.md】
- 上面 4 条定理的形式化陈述与证明（可以简短，但必须是推导，不是举例）。
- 一张示例表：width=200, height=150, maxCols=40, maxRows=30, overlap=2 时的全部页切片（列出每页 x0/y0/cols/rows）。""",
    checklist=[
        "T1–T4 四条定理均给出证明",
        "width/height 1–60 全组合 × overlap 0–4 的覆盖矩阵断言通过（构造覆盖计数数组逐格验证）",
        "相邻页重叠格数精确相等",
        "无越界页，无空白补格",
        "overlap ≥ 每页容量时抛 E_OVERLAP_TOO_LARGE",
        "零 import、零依赖",
    ],
    warn="「重叠」有两种常见错法：一是把重叠算进页容量导致最后一列被挤掉；二是把重叠格重复计入覆盖检查导致漏格被掩盖。请在测试里用独立的「覆盖计数数组」逐格验证，不要用页数与总格数相减这种间接断言。",
    integration="src/core/export/geometry/paginate.ts 由 S13 的 PDF 导出直接调用，输出的 PageSlice 决定每页绘制的源矩形。",
    hcmds=["pnpm typecheck", "pnpm vitest run src/core/export/geometry", "pnpm build"],
    risk="这是纯数学题，一旦有格错位，用户打印出来拼不上，且几乎无法自查。测试必须逐格验证覆盖。",
)

# ============================================================ 13
S(
    code="S13", anchor="s13", origin="原文 P5（拆出）",
    title="导出：PNG · 分页 PDF · CSV · JSON",
    group="输出与验收", owner="cursor", days="4–6 天", deps="S11, S12",
    goal="把图纸变成能拿在手上用的东西。导出的每一格颜色必须与预览里看到的完全一致——这是用户唯一能验证的信任契约。",
    outputs=[
        "src/export/png.ts", "src/export/pdf.ts", "src/export/csv.ts",
        "src/export/json.ts", "src/features/export/", "src/export/*.test.ts",
    ],
    task="""1) PNG
   - 一个豆子格 = 固定输出单元（默认 16px，可配 8 / 16 / 24 / 32）。
   - 可选：网格线、行列坐标、每格色号、底部图例（色号 + 色块 + 颗数 + 总数）。
   - 颜色必须直接取自 pattern.palette，禁止重新采样或二次量化。
   - 大图必须分块离屏渲染后拼合，禁止一次性分配超大 Canvas（> 8000px 边长要分块）。

2) 分页 PDF
   - 调用 S12 的 computePages() 得到页切片，不得自行计算切片逻辑。
   - 支持 A4 / A3 / Letter；两种模式：单页缩略预览版、多页制作版（按切片，绝不把整图缩到一页）。
   - 每页内容：页码、图纸总页数、该页行列坐标区间、网格、每格色号（可选）、一角的拼接标记。
   - 末端附颜色清单页：色号、色名、颗数；清单过长时自动分页，不许截断。
   - 库选型必须先进 docs/DEPENDENCY_DECISIONS.md：名称、版本、许可证、体积（gzip）、替代方案、选它的理由。

3) CSV 材料清单
   - 表头：色号, 色名, HEX, 数量, 占比。
   - UTF-8 带 BOM（EF BB BF），否则 Excel 打开中文乱码。
   - 占比保留两位小数，且合计必须在末行给出校验（等于 100.00 或说明舍入差）。

4) JSON 项目文件
   - 直接复用 S03 的 encodeProject，不要另写一套序列化。

5) 一致性测试（本阶段的核心验收）
   - PNG：解码导出图，抽样每格中心像素，断言颜色严格 ∈ palette。
   - PDF：断言页数 === computePages 返回长度；每页绘制的格子数 === cols*rows。
   - CSV：断言首三字节为 EF BB BF；断言数量合计 === 非空格数。
   - JSON：导出 → 导入 → 逐格比对完全一致。

6) 导出前校验
   - 若 sum(counts) !== nonEmptyCells，必须中断导出并报错，不许「照旧导出」。""",
    cmds=["pnpm typecheck", "pnpm vitest run src/export", "pnpm build"],
    risk="PNG 用 Canvas 缩放渲染时如果开了 imageSmoothing，会把相邻格颜色混掉，导致「导出的颜色不在色卡里」。必须关闭平滑并确认像素对齐。",
    handoff="",
)

# ============================================================ 14
S(
    code="S14", anchor="s14", origin="原文 P6（拆出）",
    title="本地项目保存与恢复（IndexedDB）",
    group="输出与验收", owner="cursor", days="3–4 天", deps="S03, S13",
    goal="让用户关掉浏览器之后还能回来继续。保存状态必须是真的——只有真正写进库才算「已保存」。",
    outputs=[
        "src/storage/db.ts", "src/storage/project-repository.ts",
        "src/storage/*.test.ts", "src/features/export/import-project.tsx",
    ],
    task="""1) 数据库层（src/storage/db.ts）
   - IndexedDB，三个 store：projects（元数据）、patterns（格子矩阵，按版本独立记录）、thumbnails（可重建）。
   - 封装成 Promise API，组件不得直接碰 IDB 对象。

2) 仓库接口（project-repository.ts）
   - save(project, pattern) / load(id) / list() / remove(id) / exists(id)。
   - 大数组写入直接用 ArrayBuffer 或 Int16Array（IDB 支持结构化克隆），不要转 JSON 字符串。

3) 保存状态的真实性
   - 顶部「保存状态」只有三种：未保存 / 保存中 / 已保存 + 时间戳。
   - 必须等事务 oncomplete 之后才置为「已保存」。写入失败要显示可重试的错误，不许静默变绿。

4) 容量
   - 用 navigator.storage.estimate() 估算，接近配额时提前提示并给出「清理缩略图 / 导出后删除」的可行操作。
   - 超限写入失败必须可恢复（不丢当前内存中的 Pattern）。

5) 导入项目 JSON
   - 必须做：schema 校验、尺寸上限校验、palette 引用存在性校验、字符串长度上限、格子索引范围校验。
   - 任一项失败给出可读原因（不是 "invalid file"），且不改变当前工作区状态。

6) 测试
   - E2E：生成 → 保存 → 刷新页面 → 从列表打开 → 断言矩阵、参数、色卡版本完全一致。
   - 单元：损坏记录、缺字段、超大数组、配额超限四条异常路径。""",
    cmds=["pnpm typecheck", "pnpm test", "pnpm build"],
    risk="「已保存」提前置绿是这类产品最常见的信任崩塌点。必须绑定事务完成事件。",
    handoff="",
)

# ============================================================ 15
S(
    code="S15", anchor="s15", origin="原文 P6（验收）",
    title="隐私审查 · E2E · 一期验收",
    group="输出与验收", owner="cursor", days="3–4 天", deps="S01–S14 全部",
    goal="把「一期做完了」变成一份可核对的证据，而不是一句自我感觉。这一阶段的产物将决定二期能不能开工。",
    outputs=[
        "tests/e2e/flow.spec.ts", "docs/PHASE1_ACCEPTANCE.md",
        "docs/KNOWN_LIMITATIONS.md", "docs/IMPLEMENTATION_STATUS.md（更新）",
    ],
    task="""1) 隐私审查
   - 用 Playwright 拦截所有网络请求，断言：除本站静态资源外零请求。
   - 审查代码中是否存在 fetch / axios / XMLHttpRequest / sendBeacon / WebSocket 调用，逐处说明用途（应全部为无）。
   - 页面上必须有如实的隐私说明：图片是否上传（否）、是否存入 IndexedDB（是 / 可选）、清除浏览器数据的影响。

2) E2E 主链路（Playwright）
   上传 → 裁剪 → 设参数 → 生成 → 看诊断 → 看统计 → 保存 → 刷新 → 重新打开 → 导出 PNG / PDF / CSV / JSON。
   - 必须包含取消任务用例与「旧任务不覆盖新任务」用例。

3) 一期验收表 docs/PHASE1_ACCEPTANCE.md
   对照规格 10.3 逐项给结论，每项必须有证据（测试文件 + 用例名 + 命令输出）：
   - 色卡合法率 100%：每个非空格映射到所选色卡合法颜色
   - 统计一致性 100%：sum(counts) === 非空格数
   - 保存恢复一致性 100%：矩阵、参数、色卡版本一致
   - 导出一致性 100%：导出格子与最终 Pattern 一致
   - 确定性 100%：固定输入 + 固定参数 → 相同结果
   - 视觉还原：明确标注为「人工盲测，未自动化」，不许编造分数

4) docs/KNOWN_LIMITATIONS.md
   - 如实列出：低分辨率下五官 / 小字无法表达、色卡来源的不确定性、性能边界（200×200 实测耗时）、
     浏览器兼容性、未实现的二期能力。

5) 明确写入：一期未实现人工编辑器，这是范围设定而非遗漏。""",
    cmds=[
        "pnpm lint", "pnpm typecheck", "pnpm test",
        "pnpm test:e2e", "pnpm build",
    ],
    risk="这一阶段最大的诱惑是把没做到的项写成「通过」。验收表每行都必须挂证据，无法自动化的一项就写「未自动化」。",
    handoff="",
)

# ---------------------------------------------------------------- 二期

PHASE2 = [
    dict(code="S16", title="二期前置：代码审计与编辑器设计", owner="domestic+cursor", days="2–3 天",
         task="""由我逐字授权后才开始。
1. Cursor：审计一期代码，输出「哪些模块可复用、哪些必须扩展、哪些绝不能动」的边界清单。
2. 国产模型：设计编辑命令模型（Command Pattern）——PaintCommand / EraseCommand / FillCommand / ReplaceColorCommand 的数据结构、
   差异压缩策略（连续笔划合并）、撤销栈内存上限估算。只交设计与类型，不写 UI。
3. 明确红线：不得重写一期算法核心与导出模块。"""),
    dict(code="S17", title="画布交互与单格编辑基础", owner="cursor", days="5–7 天",
         task="""1. 画布加画笔 / 橡皮，按 pointerdown→pointermove→pointerup 形成一次连续笔划。
2. 单格写入通过命令对象，禁止直接改 cells。
3. 编辑后即时重绘，不重算整张图。"""),
    dict(code="S18", title="命令模式 · 撤销重做 · 统计联动", owner="cursor", days="4–6 天",
         task="""1. 完整 undo/redo 栈，连续笔划合并为一条历史。
2. 每次编辑后增量更新颜色统计与诊断，不允许全量重扫（除非测出性能问题）。
3. 断言：编辑 N 次后 undo N 次，矩阵与初始状态逐格一致。"""),
    dict(code="S19", title="区域编辑与原图对照", owner="cursor", days="4–6 天",
         task="""1. 矩形 / 套索选区，区域填充、区域替换色、镜像、旋转、复制粘贴。
2. 编辑时保持原图对照可见，方便用户逐块校对。"""),
    dict(code="S20", title="编辑自动保存 · 恢复 · 版本副本", owner="cursor", days="3–5 天",
         task="""1. 编辑过程自动保存（节流写入，避免频繁 IDB 事务）。
2. 崩溃 / 关闭后可恢复未提交编辑。
3. 「另存副本」路径，避免覆盖一期生成结果。"""),
    dict(code="S21", title="局部重新生成与精修保护", owner="domestic+cursor", days="4–6 天",
         task="""1. 选区重新生成：只对选中区域重跑采样 → 匹配 → 优化，边界格做过渡处理（国产模型出算法）。
2. 已手工修改的格子必须被标记为 locked，重新生成不得覆盖。"""),
    dict(code="S22", title="编辑后导出 · 性能 · 二期验收", owner="cursor", days="4–6 天",
         task="""1. 导出当前编辑版本（PNG / PDF / CSV / JSON），与一期导出一致性测试复用。
2. 性能：500 次连续编辑不掉帧；200×200 图带编辑历史时内存不超限。
3. 输出 docs/PHASE2_ACCEPTANCE.md。"""),
]

# ---------------------------------------------------------------- 附录内容

TRIPWIRES = [
    ("让国产模型写浏览器代码",
     "它看不到运行环境，会凭空编出 createImageBitmap 的参数、OffscreenCanvas 的用法，看着完全合理，一跑就报错。",
     "只让它写「输入进去、结果出来」的纯算数函数。碰浏览器的活儿一律给 Cursor。"),
    ("让 Cursor 一口气改几十个文件",
     "算法、界面、导出混在一次改动里，出了 bug 根本不知道是哪块引起的；它还特别爱「顺手把下一步也做了」。",
     "一次只给一步。改动的文件超过 12 个，就让它先拆开再说。"),
    ("两个模型各写一套",
     "国产模型把 nearest 改成了 findNearest，Cursor 接不上，索性自己重写一份。最后两个版本同时存在，改一个漏一个。",
     "函数名、参数顺序写死在提示词里（这套文档已经做了）。接不上就退回去问，不许重写。"),
    ("测试不过就去改测试",
     "最省事的做法是放宽容差或者删掉那条用例，一分钟就绿了。但从此这个项目就没人守着了。",
     "每段提示词里都写了不许改测试。失败就按「报错回传单」填好，发回原模型改代码。"),
    ("色卡数据瞎编",
     "为了「先跑起来」随手填几十个色值，后面所有颜色都对不上真豆子，全部返工。",
     "第一步（S01）就是硬门槛。拿不到许可清楚的色卡，就只要模板和获取清单，宁可卡在这儿。"),
    ("一期偷偷加了画笔",
     "画布一旦能「点一下改个颜色」，整套只读的设计和测试假设就全废了。",
     "规矩里逐条列了禁止的交互。S11 提交前让它全局搜 paint / brush / eraser / fill / editCell，必须一个都搜不到。"),
    ("假进度条",
     "拿个定时器从 0 数到 100 最讨喜，但用户一按取消就露馅——任务根本没按那个进度在跑。",
     "进度必须来自「真的处理了多少格」，这条已经写死在 S10 里了。"),
    ("跑得慢就偷偷降质量",
     "200x200 跑不动，就悄悄少采几个点，图看着还行，细节其实已经没了。",
     "先把慢在哪查清楚，再优化。真要降质量，必须写进「已知限制」里让用户知道，不许瞒着。"),
]
