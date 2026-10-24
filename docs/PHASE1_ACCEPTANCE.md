# 一期验收表（对照规格 10.3）

更新日期：2026-10-24  
范围：**一期只读生成台**。人工编辑器未实现，这是范围设定，不是遗漏。

| 指标 | 目标 | 结论 | 证据 |
|---|---|---|---|
| 色卡合法率 | 100% 每个非空格映射到所选色卡合法颜色 | 通过（自动化） | `src/export/export.test.ts` · `PNG samples every cell center from the palette only`；流水线 `src/core/pipeline/pipeline.test.ts` 生成结果经 `validatePattern` |
| 统计一致性 | 100% sum(counts) === 非空格数 | 通过（自动化） | `src/core/pattern/pattern.test.ts` 统计用例；`src/export/export.test.ts` · `CSV starts with UTF-8 BOM and counts sum to non-empty cells`；导出前 `assertExportReady` |
| 保存恢复一致性 | 100% 矩阵、参数、色卡版本一致 | 通过（自动化） | `src/storage/storage.test.ts` · `saves Int16Array cells and loads them unchanged`；E2E `tests/e2e/flow.spec.ts` · `upload crop generate save reload export` |
| 导出一致性 | 100% 导出格子与最终 Pattern 一致 | 通过（自动化） | PNG 格心像素 === palette hex；PDF `patternPageCount === computePages().length` 且每页 `cellsDrawn === cols*rows`；JSON round-trip 逐格一致 |
| 确定性 | 100% 固定输入 + 固定参数 → 相同结果 | 通过（自动化） | `src/core/pipeline/pipeline.test.ts` · `cells are identical across two runs`；分页几何 `paginate.test.ts` |
| 视觉还原 | 人工盲测 | **未自动化** | 不许编造分数。需用真实照片/动漫/logo/风景人工对照预览与实物豆。 |
| 隐私 | 除本站静态资源外零请求 | 通过（自动化） | 仓库检索 `src`：`fetch` / `axios` / `XMLHttpRequest` / `sendBeacon` / `WebSocket` 零命中；`tests/e2e/privacy.spec.ts` · `no requests besides this origin` |

命令（S15 门禁，以 `docs/IMPLEMENTATION_STATUS.md` 粘贴的原始输出为准）：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```
