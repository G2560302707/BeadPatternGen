# 开源项目与仓库体检（S01 / 原文 P0）

评估日期：2026-10-24  
规格来源：仓库根目录 `拼豆图纸生成器_技术实施规格_v1.1_修正版.docx`（v1.1，2026-10-22）。  
`docs/TECHNICAL_SPEC.md` 在本阶段开始时**不存在**，本文不以臆造的 Markdown 规格为准。

## 1. 仓库现状（实测）

| 项 | 结果 |
|---|---|
| 是否为空产品仓库 | **是**（无 `package.json`、无 `src` 应用代码、无 lockfile） |
| git | **不是 git 仓库**（工作区无 `.git`） |
| 现有 `src` | 本阶段之前不存在；S01 仅新增 `src/core/palette/` 色卡数据与 NOTICE |
| 历史遗留产品代码 | **无** |
| 已有内容 | `拆解文档/`、`实施导航.html`、规格 `.docx`、`.workbuddy/memory/` |

结论：从零建立一期工程，不基于既有应用 fork。S02 再建 React + Vite + pnpm 骨架。

## 2. install / build / test

**未运行。** 原因：没有 `package.json`，无法 `pnpm install` / `pnpm build` / `pnpm test`。这是 S02 的交付，不是 S01 缺口伪装。

本阶段可运行的命令只有 Node 色卡校验（见 `IMPLEMENTATION_STATUS.md`）。

## 3. 是否复用现成「拼豆图纸」开源应用

检索与对照后，**不复制、不 fork** 下列产品的源码或 UI：

| 项目 | 为何不采用为底座 |
|---|---|
| 各类在线拼豆/像素画生成器（闭源或许可不明） | 规格禁止未审查许可即复制代码 |
| `maxcleme/beadcolors` | **只采用色卡 CSV + MIT 文本**，不采用其 Go 生成器 |
| `makebead/craft-color-codes` | 数据多为 beadcolors 再分发（CC BY 4.0 / MIT）；我们直接钉死上游 beadcolors，避免双层转述 |
| 像素画编辑器（含画笔/撤销） | 会把二期编辑器带进一期，违反范围 |

采用策略：**绿场仓库**。算法按规格第 4 章自研纯 TypeScript；UI 按规格第 6 章目录自建。

## 4. 候选能力边界（供 S02 起遵守）

- 一期：本地解码图片、Worker 生成、只读预览、诊断、统计、导出。
- 二期：任何修改 `cells` 的交互。S01 未放置任何编辑入口。
- 颜色：最终格子颜色只能来自已核验 palette fixture，禁止把量化中间色当豆子色。
