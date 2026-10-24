# 色卡锁定决策（S01）

锁定日期：2026-10-24

## 1. 投产色卡

| 字段 | 值 |
|---|---|
| 文件 | `src/core/palette/fixtures/artkal-s@beadcolors-f97ff428.json` |
| paletteId | `artkal-s-midi-5mm` |
| brand | Artkal |
| series | S Midi 5mm（国内常见 5mm 拼豆口径） |
| version | `beadcolors-f97ff428-2026-08-17` |
| 颜色数 | 178（从不透明正装 + 霓虹中选出） |
| sourceUrl | https://github.com/maxcleme/beadcolors/blob/f97ff4283d03cef5cd7e1071a86f5892e0c0c61b/raw/artkal_s.csv |
| 许可 | MIT（Copyright (c) 2020 maxcleme） |
| 钉死 commit | `f97ff4283d03cef5cd7e1071a86f5892e0c0c61b`（GitHub 显示 2026-08-17） |
| 本地 CSV 副本 | `src/core/palette/sources/maxcleme-beadcolors@f97ff428/artkal_s.csv` |
| MIT 原文 | `src/core/palette/NOTICE-maxcleme-beadcolors.txt` |
| 导入审计 | `src/core/palette/sources/maxcleme-beadcolors@f97ff428/import-audit.json` |

每条颜色的 `code` / `name` / `hex` 都能追溯到上述 `sourceUrl` 的同一行。没有手填或「目测取色」的 HEX。

## 2. 官方色号 → 屏幕 HEX 的转换方式（具体）

1. **色号与英文名**：直接复制 CSV 第 1、2 列（例如 `S01,White`）。这些字符串与社区整理的 Artkal S 系列色号一致；**Artkal 官方未在同一仓库发布 HEX 表**，因此色号是「社区记录的厂商色号」，不是我们自造编号。
2. **HEX**：CSV 第 3–5 列为整数 R,G,B（0–255）。转换公式仅为  
   `hex = "#" + toHex2(R) + toHex2(G) + toHex2(B)`，其中 `toHex2` 输出两位大写十六进制。无 gamma 变换、无四舍五入到其他位深、无从照片采样。
3. **转换类型归类**：**第三方社区实测 / 汇编**（beadcolors 贡献者列：Perlervault、Exodeca1、LThanda 等），**不是** Artkal 官方公开的机器可读色度，也**不是**本仓库作者用厂商包装图取色。
4. **fetchedAt**：2026-10-24T04:15:00.000Z，从钉死 commit 拉取，而不是从浮动的 `master` 头。

## 3. 由此产生的不确定性（必须写进产品文案）

- 同一色号不同生产批次、熔融前后、灯光与显示器都会改变观感。屏幕 HEX 只能用于**生成与预览对齐**，购买与分拣必须以色号为准。
- 社区 RGB 之间可能差几个 8bit 台阶；换 commit 必须升 `version` 并重算 `paletteHash`（S03）。
- 英文名与国内商家中文名可能不一致（例如 White / 白色）。一期 UI 可同时显示 `code` + `name`，不要把未核验的中文名写进 fixture。
- 特殊表面（夜光 / 金葱 / 珠光 / 透明）无法用一个不透明 HEX 表达，见下一节。

## 4. 未进入正式 palette 的行

上游 CSV 共 199 行，色号与 HEX 均无重复。以下 **21** 条因光学特性无法用单色 sRGB 代表，**没有**写入投产 fixture（完整列表见 `import-audit.json`）：

- `SG*` 夜光 3 色
- `SL*` 金葱 4 色
- `SP*` 珠光 8 色
- `ST*` 透明 6 色

它们不是「没核到许可」，而是核到了数据但**不能诚实用作最终豆子色**。若以后要支持，需要单独的 finish 字段，而不是把它们混进最近邻匹配。

保留：`S01`–`S159`（不透明正装）、`SE*`（扩展不透明）、`SN*`（霓虹不透明）。

## 5. 色卡数据获取清单（需要你提供才能再锁定的品牌）

MIT 社区表**不能**覆盖下列国内常见货盘。在你提供可溯源材料之前，**禁止**把它们做成正式 palette。格式模板：`src/core/palette/fixtures/_user-supplied.template.json`（5 条占位色，**禁止投产**）。

请按品牌分别提供：

| 你需要给出的项 | 要求 |
|---|---|
| 品牌 / 系列 / 口径 | 例如 MARD 5mm、某代工「2.6mm mini」、Hama Midi |
| 色号体系 | 与包装袋印刷一致的编码，禁止网名乱编 |
| 每色：色号、官方或包装色名、是否特殊工艺 | 夜光/金葱/透明单独标注 |
| HEX 来源 | 三选一并附证据：①厂商公开发布的 RGB/HEX 表（URL+日期）；②你持有的分光/校色测量（方法、照明、仪器）；③授权我们使用的第三方表（许可证全文） |
| 许可 | 允许本产品（含可能的商业分发）使用该 HEX 表的书面依据 |
| 版本 | 色卡年版或你指定的 `YYYY-MM-DD`，以便 `version` 字段写入 |

**不要发：** 从淘宝主图吸出来的、说不清来源的「全套 HEX」。那种不能进正式 palette。

## 6. 决策

- **正式 palette（一期默认）：** Artkal S Midi 5mm @ `beadcolors-f97ff428-2026-08-17`。
- **备用候选（未写入 fixtures）：** 同一上游的 Perler Midi CSV（同样是社区 HEX + MIT）。需要第二套时再走校验脚本，不在本阶段扩大。
- **用户自备品牌：** 走模板 + 本节清单，核验后再新增 `src/core/palette/fixtures/<brand>@<version>.json`。
