# S14 · 本地项目保存与恢复（IndexedDB）

> **所属** 一期 · 输出与验收 ｜ **主导** Cursor ｜ **工期** 3–4 天 ｜ **前置** S03, S13 ｜ **原文** 原文 P6（拆出）

> 拆解版 v1.0（基于技术规格 v1.1 修正版）

---

## 本阶段目标

让用户关掉浏览器之后还能回来继续。保存状态必须是真的——只有真正写进库才算「已保存」。

## 产出物

- `src/storage/db.ts`
- `src/storage/project-repository.ts`
- `src/storage/*.test.ts`
- `src/features/export/import-project.tsx`

## 验收门禁

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 提示词（先粘贴全局约束，再粘贴本段）

````text
【本阶段】S14 · 本地项目保存与恢复（IndexedDB）
（原文对应：原文 P6（拆出） ｜ 参考工期：3–4 天 ｜ 前置：S03, S13）

【只做本阶段】完成本轮后立即停止。不要顺手实现下一阶段，不要实现任何逐颗人工编辑功能
（画笔 / 橡皮 / 吸管 / 填充 / 颜色替换 / 撤销重做 / 区域编辑 / 编辑自动保存）——那属于二期，
未经我逐字说「现在授权开始二期」不得触碰。

【开工前】
1. 阅读 docs/TECHNICAL_SPEC.md 与 docs/IMPLEMENTATION_STATUS.md，缺失就说明。
2. 检查仓库真实现状，列出「准备新增 / 修改的文件清单 + 方案 + 风险 + 验收方式」，再动手。
3. 与文档冲突时先停下指出，不要擅自扩大范围。

【本轮任务】
1) 数据库层（src/storage/db.ts）
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
   - 单元：损坏记录、缺字段、超大数组、配额超限四条异常路径。

【验收门禁】以下命令必须真实执行，并粘贴原始输出（跑不了的标「未运行」+ 原因）：
pnpm typecheck
pnpm test
pnpm build

【交付报告】
1. 改动文件清单（新增 / 修改，一行一个，各附一句话作用）
2. 每条命令的原始输出（通过 / 失败；失败贴报错原文）
3. 未完成项与原因（没有写「无」）
4. 已知风险与我需要决策的点
5. 更新 docs/IMPLEMENTATION_STATUS.md
````

## 风险提示

「已保存」提前置绿是这类产品最常见的信任崩塌点。必须绑定事务完成事件。

---

← 返回 [S14 索引](00_使用说明.md)
