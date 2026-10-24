# S03 · 图纸数据模型 · 统计 · JSON 编解码

> **所属** 一期 · 立项 ｜ **主导** Cursor ｜ **工期** 3–4 天 ｜ **前置** S02 ｜ **原文** 原文 P2

> 拆解版 v1.0（基于技术规格 v1.1 修正版）

---

## 本阶段目标

把 BeadPattern 定成整个项目的合同。后面 12 个阶段、两个模型的所有代码都对齐这份类型和不变量。

## 产出物

- `src/core/pattern/types.ts`
- `src/core/pattern/validate.ts`
- `src/core/pattern/stats.ts`
- `src/core/pattern/codec.ts`
- `src/core/pattern/*.test.ts`

## 验收门禁

```bash
pnpm typecheck
pnpm vitest run src/core/pattern
pnpm build
```

## 提示词（先粘贴全局约束，再粘贴本段）

````text
【本阶段】S03 · 图纸数据模型 · 统计 · JSON 编解码
（原文对应：原文 P2 ｜ 参考工期：3–4 天 ｜ 前置：S02）

【只做本阶段】完成本轮后立即停止。不要顺手实现下一阶段，不要实现任何逐颗人工编辑功能
（画笔 / 橡皮 / 吸管 / 填充 / 颜色替换 / 撤销重做 / 区域编辑 / 编辑自动保存）——那属于二期，
未经我逐字说「现在授权开始二期」不得触碰。

【开工前】
1. 阅读 docs/TECHNICAL_SPEC.md 与 docs/IMPLEMENTATION_STATUS.md，缺失就说明。
2. 检查仓库真实现状，列出「准备新增 / 修改的文件清单 + 方案 + 风险 + 验收方式」，再动手。
3. 与文档冲突时先停下指出，不要擅自扩大范围。

【本轮任务】
1) 类型（严格对齐规格 5.1，字段名一个都不许改）
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
   - 统计总和等于非空格数。

【验收门禁】以下命令必须真实执行，并粘贴原始输出（跑不了的标「未运行」+ 原因）：
pnpm typecheck
pnpm vitest run src/core/pattern
pnpm build

【交付报告】
1. 改动文件清单（新增 / 修改，一行一个，各附一句话作用）
2. 每条命令的原始输出（通过 / 失败；失败贴报错原文）
3. 未完成项与原因（没有写「无」）
4. 已知风险与我需要决策的点
5. 更新 docs/IMPLEMENTATION_STATUS.md
````

## 风险提示

JSON 编解码是保存 / 导出的命门。往返测试必须比对到每个格子，不能只比长度。

---

← 返回 [S03 索引](00_使用说明.md)
