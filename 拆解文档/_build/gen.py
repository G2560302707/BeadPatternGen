# -*- coding: utf-8 -*-
"""生成：分阶段 markdown 小文档 + 实施导航 HTML。"""
import html
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_data import (STAGES, PHASE2, CURSOR_GLOBAL, DOMESTIC_GLOBAL,
                      HANDOFF_TEMPLATE, TRIPWIRES, DOCVER)

BASE = r"D:/Tabletop/桌面项目BOX/拼豆"
OUT = os.path.join(BASE, "拆解文档")

OWNER_LABEL = {
    "cursor": "Cursor 负责",
    "domestic": "国产模型负责",
    "domestic+cursor": "两个模型配合",
}


MD_OWNER = {
    "cursor": "Cursor",
    "domestic": "国产模型",
    "domestic+cursor": "国产模型设计 → Cursor 实施",
}


def owner_of(s):
    return s["owner"]


# ---------------------------------------------------------------- 提示词构造

def cursor_prompt(s):
    cmds = "\n".join(s["cmds"])
    extra = ""
    if s.get("task"):
        extra = s["task"]
    return f"""【本阶段】{s['code']} · {s['title']}
（原文对应：{s['origin']} ｜ 参考工期：{s['days']} ｜ 前置：{s['deps']}）

【只做本阶段】完成本轮后立即停止。不要顺手实现下一阶段，不要实现任何逐颗人工编辑功能
（画笔 / 橡皮 / 吸管 / 填充 / 颜色替换 / 撤销重做 / 区域编辑 / 编辑自动保存）——那属于二期，
未经我逐字说「现在授权开始二期」不得触碰。

【开工前】
1. 阅读 docs/TECHNICAL_SPEC.md 与 docs/IMPLEMENTATION_STATUS.md，缺失就说明。
2. 检查仓库真实现状，列出「准备新增 / 修改的文件清单 + 方案 + 风险 + 验收方式」，再动手。
3. 与文档冲突时先停下指出，不要擅自扩大范围。

【本轮任务】
{extra}

【验收门禁】以下命令必须真实执行，并粘贴原始输出（跑不了的标「未运行」+ 原因）：
{cmds}

【交付报告】
1. 改动文件清单（新增 / 修改，一行一个，各附一句话作用）
2. 每条命令的原始输出（通过 / 失败；失败贴报错原文）
3. 未完成项与原因（没有写「无」）
4. 已知风险与我需要决策的点
5. 更新 docs/IMPLEMENTATION_STATUS.md"""


def domestic_prompt(s):
    files = "\n".join("  - " + f for f in s["files"])
    checklist = "\n".join(f"  {i+1}. {c}" for i, c in enumerate(s["checklist"]))
    return f"""【本阶段】{s['code']} · {s['title']}
（原文对应：{s['origin']} ｜ 参考工期：{s['days']} ｜ 前置：{s['deps']}）

【目标】{s['goal']}

【交付物】严格按下列路径输出，每个文件给出完整全文（不接受「// 省略」「…」「其余同上」）：
{files}

【任务】
{s['task']}

【确定性硬要求】
- 相同输入必得相同输出；同一次交付内不得出现随机数、时间戳、依赖遍历顺序的写法。
- 所有阈值 / 容差 / 矩阵系数必须集中成具名常量，注释标明来源（标准编号 / 公式推导 / 经验值）。
- 浮点累加顺序必须写死并注释，避免末位误差导致回归测试随机失败。

【自检清单】交付前逐条自查，输出结果表（项目 / 结论 / 依据），结论只能是「通过 / 不通过 / 未验证」：
{checklist}

【特别提醒】
{s['warn']}

【边界】不要写 UI、不要写 Worker、不要改 package.json、不要引入任何第三方库。
你的交付物会被另一位工程师原样粘贴进工程后运行 vitest，任何「看起来对」的近似实现都会在断言下暴露。"""


def handoff_prompt(s):
    files = "\n".join("  - " + f for f in s["files"])
    cmds = "\n".join("   " + c for c in s["hcmds"])
    return HANDOFF_TEMPLATE.format(files=files, integration=s["integration"], cmds=cmds)


# ---------------------------------------------------------------- Markdown

def md_stage(s):
    L = []
    L.append(f"# {s['code']} · {s['title']}\n")
    L.append(f"> **所属** 一期 · {s['group']} ｜ **主导** {MD_OWNER[s['owner']]} ｜ "
             f"**工期** {s['days']} ｜ **前置** {s['deps']} ｜ **原文** {s['origin']}\n")
    L.append(f"> {DOCVER}\n")
    L.append("---\n")
    L.append("## 本阶段目标\n")
    L.append(s["goal"] + "\n")

    if owner_of(s) == "cursor":
        L.append("## 产出物\n")
        for o in s["outputs"]:
            L.append(f"- `{o}`" if o.endswith(".md") or "/" in o or "." in o else f"- {o}")
        L.append("")
        L.append("## 验收门禁\n")
        L.append("```bash")
        L.extend(s["cmds"])
        L.append("```\n")
        L.append("## 提示词（先粘贴全局约束，再粘贴本段）\n")
        L.append("````text")
        L.append(cursor_prompt(s))
        L.append("````\n")
    else:
        L.append("## 交付文件\n")
        for f in s["files"]:
            L.append(f"- `{f}`")
        L.append("")
        L.append("## 提示词 A：发给国产模型（算法交付）\n")
        L.append("````text")
        L.append(domestic_prompt(s))
        L.append("````\n")
        L.append("## 提示词 B：发给 Cursor（落地验证）\n")
        L.append("````text")
        L.append(handoff_prompt(s))
        L.append("````\n")

    L.append("## 风险提示\n")
    L.append(s["risk"] + "\n")
    L.append(f"---\n\n← 返回 [{s['code']} 索引](00_使用说明.md)\n")
    return "\n".join(L)


def md_readme():
    rows = []
    for s in STAGES:
        rows.append(f"| {s['code']} | {s['title']} | {['立项','内核','生成链路','输出与验收'][['立项','内核','生成链路','输出与验收'].index(s['group'])]} | "
                    f"{MD_OWNER[s['owner']]} | {s['days']} | {s['deps']} |")
    table = "\n".join(rows)
    return f"""# 拼豆图纸生成器 · 分阶段实施文档（{DOCVER}）

本目录把《拼豆图纸生成器 技术实施规格 v1.1 修正版》拆成 **15 个可独立交付的一期阶段**
（外加二期 7 个阶段），每个阶段一份小文档，内含可直接粘贴的提示词。

## 为什么这样拆

原文按 P0–P6 分了 7 个大阶段，其中 P4（色卡匹配 + 四模式 + 抖动 + 诊断 + Worker）一个阶段塞了
5 件互相独立、验证方式完全不同的事，一次丢给模型必然失控。本拆解的切分依据只有一条：

> **一个阶段 = 一种验证方式 + 一个主导模型。**

- 能用「纯函数 + 断言」验证的 → 拆给国产模型，尺寸小、数学味重、可离线自测。
- 必须依赖浏览器 API / 真实文件 / 构建链的 → 拆给 Cursor，它能真跑。
- 一条流水线的装配与调试 → 单独成阶段（S10），不混进算法里。

## 阶段总表

| 编号 | 阶段 | 分组 | 主导 | 工期 | 前置 |
|---|---|---|---|---|---|
{table}

一期合计参考工期 4–6 周（单人每天约 3 小时）。二期 2–4 周，需逐字授权后才开始。

## 怎么用

1. 把技术规格同步为项目内 `docs/TECHNICAL_SPEC.md`（原文要求，必须做，否则 Cursor 每轮都要你重贴）。
2. 打开 `00_全局约束.md`，把里面的**两段全局提示词**分别存好：
   - Cursor 全局约束 → 每轮开工前贴在前面
   - 国产模型全局约束 → 每次找它写算法前贴在前面
3. 按 S01 → S15 顺序执行，**每个阶段验收通过再进下一个**。
4. 遇到「国产模型主导」的阶段，走两步：
   - 把「提示词 A」发给国产模型 → 拿到文件全文 + 自检表
   - 把「提示词 B」连同文件内容发给 Cursor → 它落地并跑测试
   - 测试失败不要自己改，按 `FAIL_CASE` 格式回传国产模型重做
5. 全部 15 阶段通过后，读 `16_二期启动.md`，确认无误再逐字授权。

## 文件索引

- `00_使用说明.md`（本文件）
- `00_全局约束.md` — 两段全局提示词 + 交接模板 + 回传格式
- `01_S01_…` ~ `15_S15_…` — 15 个一期阶段
- `16_二期启动.md` — S16–S22 提示词（默认不要提前发）
- `_build/` — 本文档集的生成脚本，改数据后重跑即可同步全部 md 与 HTML

## 三条不可越过的线

1. **一期不做逐颗人工编辑。** 画笔、橡皮、吸管、填充、颜色替换、撤销重做、区域编辑，全部二期。
2. **每个格子必须是真实色卡里的颜色。** 不允许把量化产生的合成色当最终豆子颜色。
3. **没有证据的「通过」不算通过。** 每份验收都要挂命令输出或测试用例名。
"""


def md_global():
    return f"""# 全局约束与交接协议

> 每个阶段开工前都要用到的公共部分都在这里。{DOCVER}

---

## 一、发给 Cursor 的全局约束（每轮开工前先贴）

````text
{CURSOR_GLOBAL}
````

---

## 二、发给国产模型的全局约束（每次写算法前先贴）

````text
{DOMESTIC_GLOBAL}
````

---

## 三、模型分工判据（决定一件事给谁做）

按顺序问，命中即停：

1. 这个任务能不能写成**纯函数**（给定输入必然得到唯一输出，无副作用）？→ 国产模型
2. 期望结果能不能用**断言穷举**（哪怕要构造 100 个用例）？→ 国产模型
3. 是否依赖 **浏览器 API / 第三方库 / 真实文件 / 构建链**？→ Cursor
4. 是否必须**看真实仓库现状**才能决策？→ Cursor
5. 一次改动是否**超过 12 个文件**？→ 先拆，再按前四条分派

一句话：**算法可验证 → 国产；接口依赖环境 → Cursor。**

---

## 四、交接协议（国产模型 → Cursor）

国产模型的交付必须满足三条，否则 Cursor 会自行重写，两套实现就出来了：

1. 交付包内文件路径、导出名、函数签名与提示词中给出的**逐字一致**。
2. 每个文件给出**完整全文**，不允许省略。
3. 附**自检表**，每条的结论必须挂依据（测试向量编号 / 推导步骤）。

Cursor 落地时只做三件事：**原样放文件、调用侧适配、真跑命令**。
遇到类型冲突只允许改调用侧，不允许改核心实现；确需改动先说明并列出差异。

---

## 五、失败回传格式（测试不通过时用这个，不要自己改实现）

````text
FAIL_CASE
- 函数：<函数名>
- 输入：<可直接粘进测试的最小输入>
- 期望：<VECTORS.md 里的值>
- 实际：<实测值>
- 绝对误差：<差值>
- 运行命令：<命令>
- 已排除：<你确认过不是接线错误的依据>

请只修实现，不要修改测试向量与容差。
````

硬规则：**测试失败时，禁止改断言、禁止放宽容差、禁止删用例。** 一旦开了这个口子，后面的阶段全部失去保护。

---

## 六、每个阶段结束必须更新的文件

`docs/IMPLEMENTATION_STATUS.md` —— 已完成 / 未完成 / 风险 / 测试结果 / 下一步建议。
Cursor 下一轮开工时会先读它，这是跨会话唯一可靠的记忆。
"""


def md_phase2():
    L = [f"# 二期启动 · S16–S22（{DOCVER}）\n"]
    L.append("> **默认不要发。** 只有在 S01–S15 全部验收通过、并且你逐字说出「现在授权开始二期」之后才使用。\n")
    L.append("> 二期不得重写一期算法核心与导出模块；只允许扩展数据模型（在 cells 之外增加 editHistory / locked 标记）。\n")
    L.append("---\n")
    pre = """【本阶段】{code} · {title}（二期 ｜ 参考工期 {days} ｜ 主导 {owner}）

【前提】一期已验收通过，我已明确授权开始二期。若我尚未说出授权语句，立即停止并提醒我。

【只做本阶段】完成即停。二期不得修改一期已通过测试的算法与导出模块；需要扩展时只做新增，不做替换。

【本轮任务】
{task}

【通用门禁】真实执行并粘贴原始输出：pnpm lint / pnpm typecheck / pnpm test / pnpm test:e2e / pnpm build
并确认一期全部用例仍为通过（回归不许挂）。"""
    for s in PHASE2:
        L.append(f"## {s['code']} · {s['title']}\n")
        L.append(f"> 主导：{s['owner']} ｜ 工期：{s['days']}\n")
        L.append("````text")
        L.append(pre.format(code=s['code'], title=s['title'], days=s['days'],
                            owner=s['owner'], task=s['task']))
        L.append("````\n")
    L.append("---\n\n← 返回 [使用说明](00_使用说明.md)\n")
    return "\n".join(L)


# ---------------------------------------------------------------- HTML

def esc(t):
    return html.escape(t, quote=False)


CSS = """
:root{
  --bg:#0b0e12; --bg2:#0f1419; --panel:#131a21; --panel2:#182129;
  --line:#243039; --line2:#2f3d48;
  --tx:#dfe8ef; --tx2:#8fa1b0; --tx3:#5f7180;
  --green:#49c7a3; --amber:#e7ab57; --violet:#a894e8; --red:#e0725f; --blue:#5b9bd5;
  --mono:"JetBrains Mono","Cascadia Code",Consolas,"SF Mono",Menlo,monospace;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0; background:var(--bg); color:var(--tx);
  font:15px/1.75 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  background-image:
    linear-gradient(rgba(73,199,163,.028) 1px, transparent 1px),
    linear-gradient(90deg, rgba(73,199,163,.028) 1px, transparent 1px);
  background-size:26px 26px;
}
a{color:var(--green);text-decoration:none}
code{font-family:var(--mono);font-size:.9em;background:#1b242c;border:1px solid var(--line);
  padding:1px 5px;border-radius:4px;color:#cfe6de}

/* ---------- topbar ---------- */
.topbar{
  position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:18px;
  padding:11px 26px;background:rgba(11,14,18,.9);backdrop-filter:blur(12px);
  border-bottom:1px solid var(--line);
}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:.4px}
.pixdots{display:grid;grid-template-columns:repeat(3,6px);gap:2px}
.pixdots i{width:6px;height:6px;border-radius:1px;display:block}
.tb-spacer{flex:1}
.tb-stat{font-size:12.5px;color:var(--tx2);font-family:var(--mono)}
.tb-stat b{color:var(--green);font-weight:600}

/* ---------- shell ---------- */
.shell{display:grid;grid-template-columns:246px minmax(0,1fr);gap:0;max-width:1560px;margin:0 auto}
.rail{
  position:sticky;top:52px;align-self:start;height:calc(100vh - 52px);overflow-y:auto;
  padding:20px 12px 40px 20px;border-right:1px solid var(--line);
}
.rail::-webkit-scrollbar,.prompt-pre::-webkit-scrollbar{width:8px;height:8px}
.rail::-webkit-scrollbar-thumb,.prompt-pre::-webkit-scrollbar-thumb{background:#2b3944;border-radius:4px}
.rail-group{font-size:11px;letter-spacing:1.4px;color:var(--tx3);margin:18px 0 6px;text-transform:uppercase}
.rail a{
  display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;
  color:var(--tx2);font-size:13px;line-height:1.4;border-left:2px solid transparent;
}
.rail a:hover{background:#151d24;color:var(--tx)}
.rail a .dot{width:6px;height:6px;border-radius:50%;flex:none}
main{padding:0 34px 120px;min-width:0}

/* ---------- hero ---------- */
.hero{padding:44px 0 10px}
.hero h1{margin:0 0 12px;font-size:30px;letter-spacing:-.4px;line-height:1.3}
.hero h1 em{font-style:normal;color:var(--green)}
.hero .sub{color:var(--tx2);max-width:760px;font-size:14.5px}
.meta-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.chip{
  display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:99px;
  border:1px solid var(--line2);background:var(--panel);font-size:12px;color:var(--tx2);
  font-family:var(--mono);white-space:nowrap;
}
.chip.g{border-color:rgba(73,199,163,.4);color:#8fe3cb;background:rgba(73,199,163,.08)}
.chip.v{border-color:rgba(168,148,232,.4);color:#c6b9f4;background:rgba(168,148,232,.08)}
.chip.a{border-color:rgba(231,171,87,.4);color:#f0c690;background:rgba(231,171,87,.08)}

h2.sec{
  font-size:19px;margin:52px 0 6px;padding-left:12px;border-left:3px solid var(--green);
  letter-spacing:.2px;
}
.sec-note{color:var(--tx2);font-size:13.5px;margin:0 0 20px;padding-left:15px}

/* ---------- cards ---------- */
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.law{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.law .card{border-top:2px solid var(--line2)}
.law .card:nth-child(1){border-top-color:var(--red)}
.law .card:nth-child(2){border-top-color:var(--amber)}
.law .card:nth-child(3){border-top-color:var(--green)}
.law h4{margin:0 0 8px;font-size:14px}
.law p{margin:0;font-size:13px;color:var(--tx2);line-height:1.7}

table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0 4px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--tx3);font-weight:600;font-size:11.5px;letter-spacing:1px;text-transform:uppercase}
td code{font-size:12px}
tr:last-child td{border-bottom:none}
.tbl-wrap{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:6px 14px;overflow-x:auto}

/* ---------- flow ---------- */
.flow{display:flex;flex-wrap:wrap;gap:8px;align-items:stretch}
.flow a{
  flex:1 1 108px;min-width:100px;padding:9px 10px;border-radius:9px;background:var(--panel);
  border:1px solid var(--line);color:var(--tx2);font-size:12px;line-height:1.45;
  display:flex;flex-direction:column;gap:3px;transition:.15s;
}
.flow a:hover{border-color:var(--line2);transform:translateY(-1px)}
.flow a .fc{font-family:var(--mono);font-size:11px;color:var(--tx3)}
.flow a .ft{color:var(--tx);font-size:12px}
.flow a.d{border-left:2px solid var(--green)}
.flow a.c{border-left:2px solid var(--violet)}

/* ---------- prompt blocks ---------- */
.pblock{background:var(--bg2);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:14px 0}
.pb-head{
  display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--panel2);
  border-bottom:1px solid var(--line);font-size:12.5px;color:var(--tx2);
}
.pb-head .t{font-weight:600;color:var(--tx)}
.pb-head .hint{font-size:11.5px;color:var(--tx3)}
.pb-head .sp{flex:1}
button{
  font:inherit;font-size:12px;cursor:pointer;border-radius:6px;padding:4px 11px;
  border:1px solid var(--line2);background:#1d2831;color:var(--tx2);transition:.15s;
}
button:hover{border-color:var(--green);color:var(--green)}
button.ok{border-color:var(--green);color:var(--green)}
.prompt-pre{
  margin:0;padding:14px 16px;max-height:300px;overflow:auto;
  font-family:var(--mono);font-size:12.4px;line-height:1.72;color:#c8d6e0;
  white-space:pre-wrap;word-break:break-word;
}
.prompt-pre.full{max-height:none}
.pblock{position:relative}
.pblock::after{content:"";position:absolute;left:1px;right:1px;bottom:1px;height:52px;
  background:linear-gradient(to bottom,rgba(15,20,25,0),var(--bg2) 78%);pointer-events:none;
  border-radius:0 0 12px 12px}
.pblock.open::after{display:none}
.prompt-pre.raw{color:var(--tx2)}

/* ---------- stage ---------- */
.stage{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px 22px 18px;margin:16px 0;scroll-margin-top:70px}
.stage.hide{display:none}
.sh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
.sh .code{
  font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.5px;
  padding:2px 8px;border-radius:6px;background:#1e2a33;color:var(--tx2);border:1px solid var(--line2);
}
.sh h3{margin:0;font-size:17px;letter-spacing:.1px;flex:1 1 260px;min-width:0}
.badge{font-size:11px;padding:2px 9px;border-radius:99px;white-space:nowrap;font-weight:600}
.badge.c{background:rgba(168,148,232,.14);color:#c6b9f4;border:1px solid rgba(168,148,232,.35)}
.badge.d{background:rgba(73,199,163,.12);color:#8fe3cb;border:1px solid rgba(73,199,163,.35)}
.badge.m{background:rgba(231,171,87,.12);color:#f0c690;border:1px solid rgba(231,171,87,.35)}
.tick{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tx3);cursor:pointer;user-select:none}
.tick input{accent-color:var(--green);cursor:pointer}
.stage.done{opacity:.62;border-color:rgba(73,199,163,.3)}
.stage .goal{margin:10px 0 14px;font-size:13.6px;color:var(--tx2);line-height:1.8;
  border-left:2px solid var(--line2);padding-left:12px}
.sgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:12px 0}
.sbox h4{margin:0 0 6px;font-size:11.5px;letter-spacing:1.2px;color:var(--tx3);text-transform:uppercase;font-weight:600}
.sbox ul{margin:0;padding-left:17px;font-size:12.6px;color:var(--tx2);line-height:1.85}
.sbox li code{font-size:11.8px}
.risk{font-size:12.8px;color:#e8b9ae;background:rgba(224,114,95,.07);
  border:1px solid rgba(224,114,95,.22);border-radius:9px;padding:9px 13px;line-height:1.75}
.risk b{color:#f08c78}

details.note{border:1px solid var(--line);border-radius:9px;padding:0;margin:10px 0;background:var(--bg2)}
details.note>summary{cursor:pointer;padding:8px 13px;font-size:12.5px;color:var(--tx2);list-style:none}
details.note>summary::-webkit-details-marker{display:none}
details.note>summary::before{content:"▸ ";color:var(--tx3)}
details.note[open]>summary::before{content:"▾ "}
details.note .body{padding:0 13px 12px;font-size:12.6px;color:var(--tx2);line-height:1.8}

.filters{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 18px}
.filters button{padding:5px 14px;border-radius:99px}
.filters button.on{background:rgba(73,199,163,.14);border-color:var(--green);color:var(--green)}

.trip{display:grid;gap:12px}
.trip .card{display:grid;grid-template-columns:200px 1fr;gap:16px;align-items:start;padding:14px 18px}
.trip .card h4{margin:0;font-size:13.5px;color:var(--amber)}
.trip .card p{margin:0 0 6px;font-size:12.8px;color:var(--tx2);line-height:1.75}
.trip .card .fix{color:#8fe3cb;font-size:12.8px}
.trip .card .fix b{color:var(--green)}
footer{margin-top:60px;padding:22px 0;border-top:1px solid var(--line);color:var(--tx3);font-size:12px}

@media (max-width:1080px){
  .shell{grid-template-columns:1fr}
  .rail{display:none}
  main{padding:0 18px 80px}
  .law,.sgrid,.trip .card{grid-template-columns:1fr}
}
"""


def html_stage(s):
    owner = s["owner"]
    badge_cls = {"cursor": "c", "domestic": "d", "domestic+cursor": "m"}[owner]
    dot = {"cursor": "--violet", "domestic": "--green", "domestic+cursor": "--amber"}[owner]

    if owner == "cursor":
        def _o(x):
            return f"<li><code>{esc(x)}</code></li>" if ("." in x or "/" in x) else f"<li>{esc(x)}</li>"
        outputs = "".join(_o(o) for o in s["outputs"])
        prompts = f"""<div class="pblock">
  <div class="pb-head"><span class="t">把这段发给 Cursor</span>
    <span class="hint">前面先贴「Cursor 的规矩」，再贴这段</span><span class="sp"></span>
    <button data-copy="p-{s['anchor']}">复制</button>
    <button data-expand="p-{s['anchor']}">展开</button></div>
  <pre class="prompt-pre" id="p-{s['anchor']}">{esc(cursor_prompt(s))}</pre>
</div>"""
        gate = " · ".join(f"<code>{esc(c)}</code>" for c in s["cmds"])
    else:
        outputs = "".join(f"<li><code>{esc(f)}</code></li>" for f in s["files"])
        prompts = f"""<div class="pblock">
  <div class="pb-head"><span class="t">第 1 步 · 发给国产模型</span>
    <span class="hint">要它交：完整代码 + 手算的对照答案 + 自查表</span><span class="sp"></span>
    <button data-copy="pA-{s['anchor']}">复制</button>
    <button data-expand="pA-{s['anchor']}">展开</button></div>
  <pre class="prompt-pre" id="pA-{s['anchor']}">{esc(domestic_prompt(s))}</pre>
</div>
<div class="pblock">
  <div class="pb-head"><span class="t">第 2 步 · 发给 Cursor</span>
    <span class="hint">只让它放进去、跑测试，不许自己重写</span><span class="sp"></span>
    <button data-copy="pB-{s['anchor']}">复制</button>
    <button data-expand="pB-{s['anchor']}">展开</button></div>
  <pre class="prompt-pre" id="pB-{s['anchor']}">{esc(handoff_prompt(s))}</pre>
</div>"""
        gate = " · ".join(f"<code>{esc(c)}</code>" for c in s["hcmds"])

    return f"""<article class="stage" id="{s['anchor']}" data-owner="{owner}">
  <div class="sh">
    <span class="code">{s['code']}</span>
    <h3>{esc(s['title'])}</h3>
    <span class="badge {badge_cls}">{OWNER_LABEL[owner]}</span>
    <span class="chip">{s['days']}</span>
    <span class="chip">{s['origin']}</span>
    <label class="tick"><input type="checkbox" data-tick="{s['anchor']}"> 这步做完了</label>
  </div>
  <p class="goal">{esc(s['goal'])}</p>
  <div class="sgrid">
    <div class="sbox"><h4>先做哪一步</h4>
      <ul><li>上一关：{esc(s['deps'])}</li><li>这块属于：{esc(s['group'])}</li>
      <li>怎么算做完：{'自己跑命令，看到结果才算' if owner=='cursor' else '先手算标准答案，再让代码对上'}</li></ul></div>
    <div class="sbox"><h4>{'这步会得到什么' if owner=='cursor' else '要交出这几个文件'}</h4><ul>{outputs}</ul></div>
  </div>
  {prompts}
  <div class="sbox" style="margin-top:12px"><h4>做完必须跑这几条（跑不过就是没做完）</h4>
    <ul><li>{gate}</li></ul></div>
  <p class="risk" style="margin-top:12px"><b>容易错在这 · </b>{esc(s['risk'])}</p>
</article>"""


def build_html():
    groups = ["立项", "内核", "生成链路", "输出与验收"]
    gname = {"立项": "第一块 · 开工前", "内核": "第二块 · 算法内核",
             "生成链路": "第三块 · 真正出图", "输出与验收": "第四块 · 交付"}
    rail = ['<div class="rail-group">先看这里</div>',
            '<a href="#top"><span class="dot" style="background:var(--tx3)"></span>为什么这么拆</a>',
            '<a href="#law"><span class="dot" style="background:var(--tx3)"></span>三件必须记住的事</a>',
            '<a href="#split"><span class="dot" style="background:var(--tx3)"></span>谁干什么</a>',
            '<a href="#flow"><span class="dot" style="background:var(--tx3)"></span>从上往下做</a>',
            '<a href="#global"><span class="dot" style="background:var(--tx3)"></span>开工前贴两段话</a>',
            '<a href="#handoff"><span class="dot" style="background:var(--tx3)"></span>两个模型怎么对接</a>',
            '<a href="#steps"><span class="dot" style="background:var(--tx3)"></span>15 步详细</a>']
    for g in groups:
        rail.append(f'<div class="rail-group">{gname[g]}</div>')
        for s in STAGES:
            if s["group"] != g:
                continue
            color = {"cursor": "--violet", "domestic": "--green", "domestic+cursor": "--amber"}[s["owner"]]
            rail.append(f'<a href="#{s["anchor"]}"><span class="dot" style="background:var({color})"></span>'
                        f'<span>{s["code"]} {esc(s["title"])}</span></a>')
    rail.append('<div class="rail-group">最后</div>')
    rail.append('<a href="#phase2"><span class="dot" style="background:var(--amber)"></span>'
                '<span>二期：先别动</span></a>')
    rail.append('<a href="#trip"><span class="dot" style="background:var(--red)"></span>'
                '<span>八个坑</span></a>')

    flow = "".join(
        f'<a href="#{s["anchor"]}" class="{"d" if s["owner"]=="domestic" else "c"}">'
        f'<span class="fc">{s["code"]}</span><span class="ft">{esc(s["title"])[:12]}</span></a>'
        for s in STAGES)

    stage_html = "".join(html_stage(s) for s in STAGES)

    p2_html = "".join(
        f"""<div class="stage" style="padding:16px 20px">
  <div class="sh"><span class="code">{p['code']}</span><h3 style="font-size:15px">{esc(p['title'])}</h3>
  <span class="badge {'m' if p['owner']=='domestic+cursor' else 'c'}">{OWNER_LABEL.get(p['owner'], p['owner'])}</span>
  <span class="chip">{p['days']}</span></div>
  <div class="pblock" style="margin-bottom:0"><div class="pb-head"><span class="t">这段先别发</span>
  <span class="hint">等你亲口说「开始二期」再用</span><span class="sp"></span>
  <button data-copy="p2-{p['code']}">复制</button><button data-expand="p2-{p['code']}">展开</button></div>
  <pre class="prompt-pre raw" id="p2-{p['code']}">{esc(p2_prompt(p))}</pre></div>
</div>""" for p in PHASE2)

    trip_html = "".join(
        f"""<div class="card"><h4>{esc(t)}</h4>
        <div><p>{esc(why)}</p><p class="fix"><b>怎么防 · </b>{esc(fix)}</p></div></div>"""
        for t, why, fix in TRIPWIRES)

    total = len(STAGES)
    n_cursor = sum(1 for s in STAGES if s["owner"] == "cursor")
    n_dom = sum(1 for s in STAGES if s["owner"] == "domestic")
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>拼豆图纸生成器 · 怎么一步一步让 AI 做出来</title>
<style>{CSS}</style>
</head>
<body id="top">

<div class="topbar">
  <div class="brand">
    <span class="pixdots">
      <i style="background:#49c7a3"></i><i style="background:#2c3a44"></i><i style="background:#a894e8"></i>
      <i style="background:#2c3a44"></i><i style="background:#49c7a3"></i><i style="background:#2c3a44"></i>
      <i style="background:#e7ab57"></i><i style="background:#2c3a44"></i><i style="background:#49c7a3"></i>
    </span>
    拼豆图纸生成器
  </div>
  <span class="tb-spacer"></span>
  <span class="tb-stat">做完 <b id="pcount">0</b> / {total} 步</span>
</div>

<div class="shell">
<aside class="rail">{''.join(rail)}</aside>
<main>

<div class="hero">
  <h1>把那份大规格书，拆成 <em>{total} 小步</em><br>每步只交给一个模型，做完就能验</h1>
  <p class="sub">
    你手上那份规格书是一整个大本子，里面一个阶段就塞了五六件事——直接丢给 AI，它一定做飞。
    所以我把它切成 {total} 小步：<strong>每步只干一件事、只交给一个模型、做完跑几条命令就知道有没有做坏</strong>。
    绿色的交给国产模型（DeepSeek / 豆包 / 通义 / Kimi 都行），紫色的交给 Cursor。
    从上往下照着做，别跳。
  </p>
  <div class="meta-chips">
    <span class="chip g">一共 {total} 步</span>
    <span class="chip">大概 4–6 周（每天干 3 小时）</span>
    <span class="chip v">Cursor 干 {n_cursor} 步</span>
    <span class="chip g">国产模型干 {n_dom} 步</span>
    <span class="chip a">二期 7 步 · 先别动</span>
  </div>
</div>

<h2 class="sec" id="law">先记住三件事，不然全白做</h2>
<p class="sec-note">这三条是从原文档里拎出来的硬规矩。违反任何一条，后面 {total} 步全得推倒重来。</p>
<div class="law">
  <div class="card"><h4>一、一期不给人画笔</h4>
    <p>用户不能一格一格去改颜色。画笔、橡皮、吸管、填充、撤销重做——统统是二期的事。
    一期画布只能看：能放大、能拖动、能高亮某一种颜色。这条每个提示词里都写了，
    因为 AI 特别爱"顺手帮你做了"。</p></div>
  <div class="card"><h4>二、一颗豆子必须是真色卡里的颜色</h4>
    <p>不能算出个中间色就当豆子颜色用——那个颜色你买不到。
    色卡必须写清楚：哪家、哪个系列、哪个版本、色号、色值、从哪来的、能不能商用。
    查不到来源就先别编，让它交个空模板给你补。</p></div>
  <div class="card"><h4>三、没证据的"做好了"不算数</h4>
    <p>每一步做完，必须贴出真的命令输出，或者点名哪个测试过了。跑不起来就老老实实写"没跑"。
    不许放假数据、假进度条、点了没反应的按钮，更不许为了让测试变绿去改测试。</p></div>
</div>

<h2 class="sec" id="split">谁干什么：其实就一句话</h2>
<p class="sec-note">
  不是看哪个模型更聪明，而是看这件事<strong>能不能单独拿出来验</strong>。
  能提前算出标准答案的，给国产模型；必须真跑环境的，给 Cursor。
</p>
<div class="tbl-wrap"><table>
<tr><th style="width:24%">这类活儿</th><th style="width:38%">国产模型</th><th>Cursor</th></tr>
<tr><td>算颜色差、算怎么切页、找孤立点这种纯算数</td>
    <td><b style="color:#8fe3cb">干得好</b> — 能反复推，推到小数点后四位都对得上</td>
    <td>干不好 — 容易"差不多就行"，跳过推导直接写</td></tr>
<tr><td>同样的输入必须出同样的结果</td>
    <td><b style="color:#8fe3cb">干得好</b> — 会主动把顺序、平局怎么算、累加先后写死</td>
    <td>一般 — 容易埋下"每次跑结果都差一点点"的坑</td></tr>
<tr><td>先手算出标准答案，再拿代码去对</td>
    <td><b style="color:#8fe3cb">干得好</b> — 真能把手算的中间过程写出来，这才叫对答案</td>
    <td>干不好 — 习惯"跑出啥就写啥"，测试等于抄自己答案</td></tr>
<tr><td>跟浏览器、真文件、装库打交道</td>
    <td>干不好 — 会凭空编个函数名，看着特别合理，一跑就报错</td>
    <td><b style="color:#c6b9f4">干得好</b> — 有真环境，错了当场撞墙</td></tr>
<tr><td>一次改十几个文件、接进现有项目</td>
    <td>干不好 — 看不到你的项目，不知道现在长啥样</td>
    <td><b style="color:#c6b9f4">干得好</b> — 能读项目、能批量改、能跑命令</td></tr>
<tr><td>装包、挑库、看体积和许可证</td>
    <td>干不好 — 版本和许可信息容易记错</td>
    <td><b style="color:#c6b9f4">干得好</b> — 能装、能跑、能称重</td></tr>
<tr><td>写长报告、列审计清单</td>
    <td><b style="color:#8fe3cb">干得好</b> — 一条条列，不漏项</td>
    <td>一般 — 能写，但容易写空话</td></tr>
</table></div>

<p class="sec-note" style="margin-top:20px">所以每次派活之前，按这个顺序问自己五句，问到哪句有答案就停：</p>
<div class="card" style="font-size:13.6px;line-height:2.2">
  <b style="color:var(--green)">①</b> 这事能不能写成一个"输入进去、结果出来"的函数？→ <b>给国产模型</b><br>
  <b style="color:var(--green)">②</b> 结果能不能提前算出标准答案，让代码去对？→ <b>给国产模型</b><br>
  <b style="color:var(--violet)">③</b> 要不要碰浏览器、真文件、装库？→ <b>给 Cursor</b><br>
  <b style="color:var(--violet)">④</b> 是不是得先看看现在项目里有什么才能定？→ <b>给 Cursor</b><br>
  <b style="color:var(--amber)">⑤</b> 一次要改超过 12 个文件？→ <b>先拆小</b>，再按上面四条分
</div>

<h2 class="sec" id="flow">从上往下做，别跳</h2>
<p class="sec-note">
  <span class="chip g" style="margin-right:6px">绿边 = 国产模型那 {n_dom} 步</span>
  <span class="chip v">紫边 = Cursor 那 {n_cursor} 步</span>
  &nbsp;做完一步、验过一步，再开下一步。<strong>千万别把 {total} 段提示词一次性全发出去。</strong>
</p>
<div class="flow">{flow}</div>

<div class="card" style="margin-top:18px">
  <h4 style="margin:0 0 10px;font-size:14px">国产模型那 {n_dom} 步，都走同一个来回</h4>
  <p style="margin:0 0 10px;font-size:13.2px;color:var(--tx2);line-height:2">
    ① 先把「第 1 步」那段发给国产模型 —— 它给你完整代码，还给你手算的对照答案、一张自查表。<br>
    ② 再把「第 2 步」那段，连同它给的代码，发给 Cursor —— Cursor 只负责放进去、跑测试，<b>不许自己重写</b>。<br>
    ③ 测试没过？别自己动手改，按下面那张「报错回传单」填好，发回国产模型重算。<br>
    ④ 过了就在卡片右上角打个勾，走下一步。
  </p>
  <p style="margin:0;font-size:12.8px;color:var(--tx3);line-height:1.9">
    多这两次复制粘贴，换来的是：算的部分真的经过推导，工程的部分真的跑过一遍。
    这比"Cursor 自己写了个看着挺对的公式、误差 0.8 谁也没发现"要划算得多。
  </p>
</div>

<h2 class="sec" id="global">开工前先贴这两段话</h2>
<p class="sec-note">
  这两段是"规矩"，比每一步的具体交代更重要。第一段每次让 Cursor 干活前都贴，第二段每次找国产模型写算法前都贴。
</p>

<div class="pblock">
  <div class="pb-head"><span class="t">Cursor 的规矩</span>
  <span class="hint">每次开工前，贴在具体那一步的前面</span><span class="sp"></span>
  <button data-copy="g-cursor">复制</button><button data-expand="g-cursor">展开</button></div>
  <pre class="prompt-pre" id="g-cursor">{esc(CURSOR_GLOBAL)}</pre>
</div>

<div class="pblock">
  <div class="pb-head"><span class="t">国产模型的规矩</span>
  <span class="hint">每次让它写算法前贴，一样贴在前面</span><span class="sp"></span>
  <button data-copy="g-domestic">复制</button><button data-expand="g-domestic">展开</button></div>
  <pre class="prompt-pre" id="g-domestic">{esc(DOMESTIC_GLOBAL)}</pre>
</div>

<h2 class="sec" id="handoff">两个模型怎么对接：三条规矩 + 一张报错单</h2>
<p class="sec-note">
  先说清楚：<strong>这一整块只在 6 个绿色阶段用得上</strong>——就是国产模型写算法的那几步。
  紫色的 Cursor 阶段是它一个人从头干到尾，直接跳过这里，不用管。
</p>
<p class="sec-note">
  为什么要有这一块：两个模型来回递东西，最容易出的岔子是——国产模型把函数改了个名，Cursor 接不上，
  索性自己又写了一套。最后两份代码同时存在，改一个漏一个，你还以为只有一份。
  下面三条是交货时的验收，那张单子是出问题时的回传格式。
</p>

<div class="law">
  <div class="card" style="border-top-color:var(--green)"><h4>① 名字照抄，别自己改</h4>
    <p>函数名、参数顺序、文件名，提示词里怎么写就怎么用。想改名得先问你，不许自作主张。</p></div>
  <div class="card" style="border-top-color:var(--green)"><h4>② 不许省略</h4>
    <p>每个文件要给全文。写「其余同上」「此处省略」等于没交——半个文件 Cursor 根本用不了。</p></div>
  <div class="card" style="border-top-color:var(--green)"><h4>③ 「检查过了」不算，要说凭据</h4>
    <p>自查表里每条结论后面必须跟一句依据：第几组测试对上了、推到第几步。只写「已检查」的，一律打回。</p></div>
</div>

<div class="card" style="margin-top:14px;border-left:3px solid var(--green)">
  <h4 style="margin:0 0 8px;font-size:13.5px;color:var(--green)">这三条怎么用：交货时扫一眼，不合格当场打回</h4>
  <p style="margin:0 0 10px;font-size:13px;color:var(--tx2);line-height:1.95">
    国产模型把文件发过来之后、你转给 Cursor 之前，拿这三条过一遍。<br>
    <b>三条都过</b> → 转给 Cursor。<b>有一条不过</b> → 当场打回，别浪费 Cursor 那一轮（它跑一次要几分钟，还容易顺手重写）。
  </p>
  <p style="margin:0 0 6px;font-size:13px;color:var(--tx2)">打回就一句话，不用讲道理：</p>
  <pre class="prompt-pre raw" id="t-reject" style="max-height:none;border:1px solid var(--line);border-radius:8px">第 2 条不合格：src/core/color/color.test.ts 只给了 describe 骨架，没有断言。
请按原提示词把这一部分补全重发，函数名和导出名不要改动。</pre>
</div>

<div class="pblock" style="margin-top:18px">
  <div class="pb-head"><span class="t">报错回传单</span>
  <span class="hint">测试挂了 → 照着填 → 发回国产模型</span><span class="sp"></span>
  <button data-copy="t-fail">复制</button></div>
  <pre class="prompt-pre raw" id="t-fail" style="max-height:none">{esc(FAILTPL)}</pre>
</div>

<div class="card" style="margin-top:2px;border-left:3px solid var(--amber)">
  <h4 style="margin:0 0 8px;font-size:13.5px;color:var(--amber)">这张单子怎么用：测试红了才动它</h4>
  <p style="margin:0;font-size:13px;color:var(--tx2);line-height:2.05">
    ① Cursor 跑测试红了——它<b>应该会自己按这个格式给你一段</b>（第 2 步提示词第 5 条已经要求了）。<br>
    ② 万一它没按格式给，你就把报错原文套进上面的空里，自己填三行也行，重点是<b>输入、期望、实际</b>这三个。<br>
    ③ 把填好的这张单子，<b>粘回国产模型的同一个对话</b>（千万别新开一个——新开它就忘了自己怎么推的，还得重读一遍全部文件）。<br>
    ④ 后面跟一句：<b>「只修实现，不要改测试向量与容差。」</b> 它给补丁，你拿回 Cursor 再跑一次。<br>
    ⑤ 绿了就打个勾走下一步。
  </p>
  <p style="margin:10px 0 0;font-size:12.8px;color:var(--tx3);line-height:1.85">
    <b style="color:var(--amber)">一个提醒：</b>同一个错误修三次还不过，八成不是代码问题，是提示词本身写歧义了。
    这时候别继续磨那个模型，回来改这一步的提示词、或者改 VECTORS 里的期望值——改完重新发一轮，比来回五遍快得多。
  </p>
</div>

<details class="note" style="margin-top:14px">
  <summary>看一个完整来回的例子（S04 颜色内核，真实场景）</summary>
  <div class="body">
    <p style="margin:0 0 10px"><b>背景：</b>这一步要算「两个颜色差多少」，标准叫 CIEDE2000。算错了肉眼看不出来，但会一路污染到最后的配色。</p>
    <pre class="prompt-pre raw" style="max-height:none;background:#0b0e12;border:1px solid var(--line);border-radius:8px">【你】贴「国产模型的规矩」+ 第 1 步 → 国产交回 9 个文件 + VECTORS.md + 自查表

【你】拿三条扫一眼
      发现 color.test.ts 只给了 describe 骨架，没有断言
      → 打回：「第 2 条不合格……补全重发」（就是上面那句话）

【国产】补齐重发，这次 9 个文件都是全文

【你】贴「Cursor 的规矩」+ 第 2 步 + 这 9 个文件
      → Cursor 放进去，跑 pnpm vitest run src/core/color
      → 红了，按格式回传：

      FAIL_CASE: 函数=deltaE2000
                 输入=Lab(50,2.6772,-79.7751) vs Lab(50,0,-82.7485)
                 期望=2.0425  实际=2.1790  差异=0.1365

【你】把这段原样粘回国产模型（同一个对话）+「只修实现，不要改测试向量」

【国产】回：色相角 Δh 在跨越 0°/360° 时没做回绕处理，给修正版 ciede2000.ts

【你】贴回 Cursor → 绿了

【你】打勾，走 S05</pre>
    <p style="margin:10px 0 0;color:var(--tx3);font-size:12.5px">
      注意这个例子里的关键点：<b>0.1365 的误差，图片上完全看不出来</b>。如果两边都偷懒——国产不写手算答案、Cursor 跑出什么就写什么——
      这个错会一直带到用户买的豆子颜色上，而且永远查不出来。这就是"多这两次复制粘贴"换来的东西。
    </p>
  </div>
</details>

<h2 class="sec" id="steps">15 步详细清单</h2>
<p class="sec-note">
  每张卡片从上往下看就行：<b>这步干什么</b> → <b>上一步是谁</b> → <b>会得到什么</b> →
  <b>提示词（点展开看全，点复制直接粘）</b> → <b>做完跑哪几条命令</b> → <b>容易错在哪</b>。
  右上角勾选框记进度，关掉网页再打开还在。
</p>
<div class="filters">
  <button class="on" data-filter="all">全部 {total} 步</button>
  <button data-filter="domestic">只看国产模型的</button>
  <button data-filter="cursor">只看 Cursor 的</button>
</div>

{stage_html}

<h2 class="sec" id="phase2">二期：先别动</h2>
<p class="sec-note">
  原文档写死了：必须你亲口说「开始二期」才能做，AI 不许自己判断"差不多做完了"就往下冲。
  这七步是给用户加画笔、撤销、局部重画的——一期 {total} 步全部验完，再回来看这里。
  下面每段都能复制，但现在别发。
</p>
{p2_html}

<h2 class="sec" id="trip">八个最容易做废的地方</h2>
<p class="sec-note">这些是 AI 干活时最常翻的车，每一条都能把你的返工时间翻倍。开工前扫一眼就行。</p>
<div class="trip">{trip_html}</div>

<footer>
  {DOCVER} ｜ 源文档：拼豆图纸生成器_技术实施规格_v1.1_修正版.docx ｜
  同目录 <code>拆解文档/</code> 里是每一步单独一份 markdown，可以一次只发一份。
</footer>

</main>
</div>

<script>
(function(){{
  // 复制
  document.addEventListener('click', function(e){{
    var b = e.target.closest('[data-copy]');
    if(!b) return;
    var el = document.getElementById(b.getAttribute('data-copy'));
    if(!el) return;
    var txt = el.textContent;
    var done = function(){{
      var old = b.textContent; b.textContent = '已复制'; b.classList.add('ok');
      setTimeout(function(){{ b.textContent = old; b.classList.remove('ok'); }}, 1400);
    }};
    if(navigator.clipboard && window.isSecureContext){{
      navigator.clipboard.writeText(txt).then(done, function(){{ fallback(txt, done); }});
    }} else {{ fallback(txt, done); }}
  }});
  function fallback(txt, cb){{
    var ta = document.createElement('textarea');
    ta.value = txt; ta.style.position='fixed'; ta.style.left='-9999px';
    document.body.appendChild(ta); ta.select();
    try{{ document.execCommand('copy'); cb(); }}catch(err){{ alert('复制失败，请手动选中文本'); }}
    document.body.removeChild(ta);
  }}
  // 展开 / 收起
  document.addEventListener('click', function(e){{
    var b = e.target.closest('[data-expand]');
    if(!b) return;
    var el = document.getElementById(b.getAttribute('data-expand'));
    if(!el) return;
    el.classList.toggle('full');
    var pb = el.closest('.pblock'); if(pb) pb.classList.toggle('open', el.classList.contains('full'));
    b.textContent = el.classList.contains('full') ? '收起' : '展开';
  }});
  // 进度
  var KEY = 'bead_plan_progress_v1';
  var state = {{}};
  try{{ state = JSON.parse(localStorage.getItem(KEY) || '{{}}'); }}catch(err){{ state = {{}}; }}
  var boxes = document.querySelectorAll('[data-tick]');
  function refresh(){{
    var n = 0;
    boxes.forEach(function(cb){{
      var k = cb.getAttribute('data-tick');
      if(state[k]){{ cb.checked = true; cb.closest('.stage').classList.add('done'); n++; }}
      else {{ cb.checked = false; cb.closest('.stage').classList.remove('done'); }}
    }});
    var pc = document.getElementById('pcount');
    if(pc) pc.textContent = n;
  }}
  boxes.forEach(function(cb){{
    cb.addEventListener('change', function(){{
      state[cb.getAttribute('data-tick')] = cb.checked;
      try{{ localStorage.setItem(KEY, JSON.stringify(state)); }}catch(err){{}}
      refresh();
    }});
  }});
  refresh();
  // 筛选
  document.querySelectorAll('[data-filter]').forEach(function(btn){{
    btn.addEventListener('click', function(){{
      document.querySelectorAll('[data-filter]').forEach(function(b){{ b.classList.remove('on'); }});
      btn.classList.add('on');
      var f = btn.getAttribute('data-filter');
      document.querySelectorAll('.stage[data-owner]').forEach(function(card){{
        var o = card.getAttribute('data-owner');
        card.classList.toggle('hide', !(f === 'all' || o === f));
      }});
    }});
  }});
}})();
</script>
</body>
</html>"""


FAILTPL = """FAIL_CASE
- 函数：<函数名>
- 输入：<可直接粘进测试的最小输入>
- 期望：<VECTORS.md 里的值>
- 实际：<实测值>
- 绝对误差：<差值>
- 运行命令：<命令>
- 已排除：<你确认过不是接线错误的依据>

请只修实现，不要修改测试向量与容差。"""


def p2_prompt(s):
    return f"""【本阶段】{s['code']} · {s['title']}（二期 ｜ 参考工期 {s['days']} ｜ 主导 {s['owner']}）

【前提】一期已验收通过，我已明确授权开始二期。若我尚未说出授权语句，立即停止并提醒我。

【只做本阶段】完成即停。二期不得修改一期已通过测试的算法与导出模块；需要扩展时只做新增，不做替换。

【本轮任务】
{s['task']}

【通用门禁】真实执行并粘贴原始输出：pnpm lint / pnpm typecheck / pnpm test / pnpm test:e2e / pnpm build
并确认一期全部用例仍为通过（回归不许挂）。"""


def main():
    os.makedirs(OUT, exist_ok=True)

    idx = 0
    for i, s in enumerate(STAGES, start=1):
        t = s["title"]
        for a, b in [(" · ", "_"), ("：", "_"), ("/", "_"), (" ", "_")]:
            t = t.replace(a, b)
        fn = f"{i:02d}_{s['code']}_{t}.md"
        with open(os.path.join(OUT, fn), "w", encoding="utf-8") as f:
            f.write(md_stage(s))
        idx += 1

    with open(os.path.join(OUT, "00_使用说明.md"), "w", encoding="utf-8") as f:
        f.write(md_readme())
    with open(os.path.join(OUT, "00_全局约束.md"), "w", encoding="utf-8") as f:
        f.write(md_global())
    with open(os.path.join(OUT, "16_二期启动_S16_S22.md"), "w", encoding="utf-8") as f:
        f.write(md_phase2())
    with open(os.path.join(BASE, "实施导航.html"), "w", encoding="utf-8") as f:
        f.write(build_html())

    print("stages:", len(STAGES), "phase2:", len(PHASE2))


if __name__ == "__main__":
    main()
