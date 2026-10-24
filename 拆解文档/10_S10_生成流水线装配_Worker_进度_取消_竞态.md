# S10 · 生成流水线装配 · Worker · 进度 · 取消 · 竞态

> **所属** 一期 · 生成链路 ｜ **主导** Cursor ｜ **工期** 4–5 天 ｜ **前置** S06, S07, S08, S09 ｜ **原文** 原文 P4（装配）

> 拆解版 v1.0（基于技术规格 v1.1 修正版）

---

## 本阶段目标

把所有算法模块缝成一条能跑、能看进度、能取消、不会串结果的流水线。这是产品第一次真正「能出图」。

## 产出物

- `src/core/pipeline/generate.ts`
- `src/workers/generate.worker.ts`
- `src/core/pipeline/protocol.ts`
- `src/state/generation.ts`
- `src/core/pipeline/*.test.ts`

## 验收门禁

```bash
pnpm typecheck
pnpm vitest run src/core/pipeline
pnpm build
```

## 提示词（先粘贴全局约束，再粘贴本段）

````text
【本阶段】S10 · 生成流水线装配 · Worker · 进度 · 取消 · 竞态
（原文对应：原文 P4（装配） ｜ 参考工期：4–5 天 ｜ 前置：S06, S07, S08, S09）

【只做本阶段】完成本轮后立即停止。不要顺手实现下一阶段，不要实现任何逐颗人工编辑功能
（画笔 / 橡皮 / 吸管 / 填充 / 颜色替换 / 撤销重做 / 区域编辑 / 编辑自动保存）——那属于二期，
未经我逐字说「现在授权开始二期」不得触碰。

【开工前】
1. 阅读 docs/TECHNICAL_SPEC.md 与 docs/IMPLEMENTATION_STATUS.md，缺失就说明。
2. 检查仓库真实现状，列出「准备新增 / 修改的文件清单 + 方案 + 风险 + 验收方式」，再动手。
3. 与文档冲突时先停下指出，不要擅自扩大范围。

【本轮任务】
1) 流水线装配（纯函数编排，放 src/core/pipeline/generate.ts）
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
   - 不做预览渲染（S11）、不做导出（S13）。生成完成后只把 Pattern 放进 state 并显示「生成完成」。

【验收门禁】以下命令必须真实执行，并粘贴原始输出（跑不了的标「未运行」+ 原因）：
pnpm typecheck
pnpm vitest run src/core/pipeline
pnpm build

【交付报告】
1. 改动文件清单（新增 / 修改，一行一个，各附一句话作用）
2. 每条命令的原始输出（通过 / 失败；失败贴报错原文）
3. 未完成项与原因（没有写「无」）
4. 已知风险与我需要决策的点
5. 更新 docs/IMPLEMENTATION_STATUS.md
````

## 风险提示

竞态是这里唯一的致命 bug 来源。taskId 校验必须写在「落地」那一刻，而不是请求发出时。

---

← 返回 [S10 索引](00_使用说明.md)
