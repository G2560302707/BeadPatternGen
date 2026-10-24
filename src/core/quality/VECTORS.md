# S08 质量诊断测试向量

本文件是 `src/core/quality/quality.test.ts` 的手算依据。所有期望值都是**精确相等**断言，
不使用「大于 0」「非空」之类的弱断言。

## 口径（实现与测试共同遵守）

| 项目     | 定义                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| 空格     | `cells[i] === -1`（`EMPTY_CELL`）。只有 `-1` 是空格，其他值都是色号。                                       |
| 色号相同 | `cells` 中的调色板索引值相等。调色板里两个 hex 相同的条目仍算两个色号。                                     |
| 邻域     | 4-邻域：上 / 下 / 左 / 右。对角相邻**不算**连通，也不算「邻域内有同色」。                                   |
| 越界     | 越界位置视为「不同色」，因此贴边单豆是孤立豆。                                                              |
| 孤立豆   | 非空格，且 4 个邻域位置中没有任何同色格。                                                                   |
| 碎片     | 同色 4-连通分量，`size ≤ maxFragmentSize`。size 为 1 的分量同时也是孤立豆，两处**重复计数**，诊断不做合并。 |
| 细线风险 | 同一行 / 列上连续同色游程长度 `< minRun`。空格切断游程且自身不成段。一个格子可同时产生水平、垂直两条记录。  |
| 高色差   | `perCellDelta[i] > highDeltaThreshold` 且该格非空。严格大于；等于阈值不报。                                 |

输出顺序（全部写死，不依赖 `Map`/`Set` 的迭代顺序）：

- `isolated`、`highDelta`：索引升序（扫描顺序天然保证）。
- `fragments`：`size` 升序；同 size 按分量内最小索引升序；每个分量的 `cells` 按索引升序。
- `thinRuns`：`row` 升序 → `col` 升序 → `orientation`（`"h"` 在 `"v"` 前）。
  第三个键保证同一 `(row, col)` 上的横竖两条也有全序，不依赖 `Array.prototype.sort` 的稳定性。

坐标约定：索引 `i = row * width + col`，`row`、`col` 从 0 开始。
细线记录的 `row`/`col` 是游程**起点**（水平段最左格，垂直段最上格）。

---

## V1 · 3×3 对角相邻不算连通

```
0 . .
. 0 .
. . 0
```

- `width = 3`, `height = 3`
- `cells = [0, -1, -1, -1, 0, -1, -1, -1, 0]`
- 参数：`maxSize = 2`, `minRun = 2`

三个 0 在对角上互相接触，但没有任何 4-邻域同色邻居，因此：

```ts
findIsolated(p); // [0, 4, 8]
findFragments(p, 2); // [{ size: 1, cells: [0] },
//  { size: 1, cells: [4] },
//  { size: 1, cells: [8] }]
findThinRuns(p, 2); // [{ row: 0, col: 0, length: 1, orientation: "h" },
//  { row: 0, col: 0, length: 1, orientation: "v" },
//  { row: 1, col: 1, length: 1, orientation: "h" },
//  { row: 1, col: 1, length: 1, orientation: "v" },
//  { row: 2, col: 2, length: 1, orientation: "h" },
//  { row: 2, col: 2, length: 1, orientation: "v" }]
```

**结论：** 若把对角算作连通，这里会得到 1 个 size=3 的分量；实际必须是 3 个 size=1 分量。
同一格 (0,0) 同时属于水平、垂直两条短游程，两条都输出。

---

## V2 · 3×3 空格被色块包围

```
0 0 0
0 . 0
0 0 1
```

- `width = 3`, `height = 3`
- `cells = [0, 0, 0, 0, -1, 0, 0, 0, 1]`
- 参数：`maxSize = 2`, `minRun = 2`

中心的空格虽然被 0 包围，但空格不参与孤立豆判定，也不进入连通分量：

```ts
findIsolated(p); // [8]
findFragments(p, 2); // [{ size: 1, cells: [8] }]
findThinRuns(p, 2); // [{ row: 0, col: 1, length: 1, orientation: "v" },
//  { row: 1, col: 0, length: 1, orientation: "h" },
//  { row: 1, col: 2, length: 1, orientation: "h" },
//  { row: 2, col: 1, length: 1, orientation: "v" },
//  { row: 2, col: 2, length: 1, orientation: "h" },
//  { row: 2, col: 2, length: 1, orientation: "v" }]
```

**结论：** 索引 4 不是孤立豆；7 个 0 是一个 size=7 的连通分量，因 `7 > 2` 不输出；
右下角的 1 是唯一孤立豆。中心空格把第 1 行、第 1 列的游程切断。

---

## V3 · 4×4 单格宽蛇形线

```
. 0 0 0
. . . 0
. 0 0 0
. . . .
```

- `width = 4`, `height = 4`
- `cells = [-1, 0, 0, 0, -1, -1, -1, 0, -1, 0, 0, 0, -1, -1, -1, -1]`
- 参数：`maxSize = 2`, `minRun = 2`；另用 `maxSize = 7` 验证连通性

```ts
findIsolated(p); // []
findFragments(p, 2); // []
findFragments(p, 7); // [{ size: 7, cells: [1, 2, 3, 7, 9, 10, 11] }]
findThinRuns(p, 2); // [{ row: 0, col: 1, length: 1, orientation: "v" },
//  { row: 0, col: 2, length: 1, orientation: "v" },
//  { row: 1, col: 3, length: 1, orientation: "h" },
//  { row: 2, col: 1, length: 1, orientation: "v" },
//  { row: 2, col: 2, length: 1, orientation: "v" }]
```

**结论：** 7 个 0 通过第 3 列的竖直段连成一个分量（`[1,2,3]` 与 `[9,10,11]` 靠 `7` 相连），
所以没有孤立豆；按默认 `maxSize = 2` 整段被过滤。列 3 的竖直游程长度为 3，
`3 < 2` 不成立，因此不报；上、下两行的水平段长度都是 3，也不报；
其余单格竖直/水平残段各报一条。

---

## V4 · 5×5 十字细线

```
. . 0 . .
. . 0 . .
0 0 0 0 0
. . 0 . .
. . 0 . .
```

- `width = 5`, `height = 5`
- 参数：`maxSize = 2`, `minRun = 3`

```text
cells = [-1, -1,  0, -1, -1,
         -1, -1,  0, -1, -1,
          0,  0,  0,  0,  0,
         -1, -1,  0, -1, -1,
         -1, -1,  0, -1, -1]
```

```ts
findIsolated(p); // []
findFragments(p, 2); // []
findThinRuns(p, 3); // [{ row: 0, col: 2, length: 1, orientation: "h" },
//  { row: 1, col: 2, length: 1, orientation: "h" },
//  { row: 2, col: 0, length: 1, orientation: "v" },
//  { row: 2, col: 1, length: 1, orientation: "v" },
//  { row: 2, col: 3, length: 1, orientation: "v" },
//  { row: 2, col: 4, length: 1, orientation: "v" },
//  { row: 3, col: 2, length: 1, orientation: "h" },
//  { row: 4, col: 2, length: 1, orientation: "h" }]
```

**结论：** 9 个 0 是一个完整十字分量，`9 > 2` 被过滤；每个格子都有同色邻居，无孤立豆。
中间行 / 列的游程长度为 5，不报；四个方向各 2 个单格残段，报 8 条。

---

## V5 · 5×5 碎片排序与细线全序

```
0 1 . 2 2
. 1 . . .
. . . 3 .
4 . . . .
. . 4 . .
```

- `width = 5`, `height = 5`
- 参数：`maxSize = 2`, `minRun = 3`

```text
cells = [ 0,  1, -1,  2,  2,
         -1,  1, -1, -1, -1,
         -1, -1, -1,  3, -1,
          4, -1, -1, -1, -1,
         -1, -1,  4, -1, -1]
```

分量清单（用于手算）：

| 色号 | 格子索引 | size | 是否输出（≤2） |
| ---- | -------- | ---- | -------------- |
| 0    | `[0]`    | 1    | 是             |
| 1    | `[1, 6]` | 2    | 是             |
| 2    | `[3, 4]` | 2    | 是             |
| 3    | `[13]`   | 1    | 是             |
| 4    | `[15]`   | 1    | 是             |
| 4    | `[22]`   | 1    | 是             |

```ts
findIsolated(p); // [0, 13, 15, 22]

findFragments(p, 2); // [{ size: 1, cells: [0] },
//  { size: 1, cells: [13] },
//  { size: 1, cells: [15] },
//  { size: 1, cells: [22] },
//  { size: 2, cells: [1, 6] },
//  { size: 2, cells: [3, 4] }]

findThinRuns(p, 3); // [{ row: 0, col: 0, length: 1, orientation: "h" },
//  { row: 0, col: 0, length: 1, orientation: "v" },
//  { row: 0, col: 1, length: 1, orientation: "h" },
//  { row: 0, col: 1, length: 2, orientation: "v" },
//  { row: 0, col: 3, length: 2, orientation: "h" },
//  { row: 0, col: 3, length: 1, orientation: "v" },
//  { row: 0, col: 4, length: 1, orientation: "v" },
//  { row: 1, col: 1, length: 1, orientation: "h" },
//  { row: 2, col: 3, length: 1, orientation: "h" },
//  { row: 2, col: 3, length: 1, orientation: "v" },
//  { row: 3, col: 0, length: 1, orientation: "h" },
//  { row: 3, col: 0, length: 1, orientation: "v" },
//  { row: 4, col: 2, length: 1, orientation: "h" },
//  { row: 4, col: 2, length: 1, orientation: "v" }]
```

**排序说明：** size=1 的分量最小索引分别是 0、13、15、22，按升序排在前；
size=2 的分量最小索引分别是 1（`[1,6]`）与 3（`[3,4]`），排在其后。
细线先按 row、再按 col；`(0,0)`、`(0,1)`、`(0,3)`、`(2,3)`、`(3,0)`、`(4,2)`
上同时存在横竖两条时，`"h"` 排在 `"v"` 前。
`(0,1)` 的垂直游程长度是 2（色号 1 占据 row 0–1），其余多为 1；
`(0,3)` 的水平游程长度是 2（色号 2 占据 col 3–4）。

### V5 的 buildReport 高色差补充

与上面同一个 pattern，`highDeltaThreshold = 10`：

| 索引 | ΔE        | 格子状态 | 是否报                 |
| ---- | --------- | -------- | ---------------------- |
| 0    | 10        | 非空     | 否（严格大于才报）     |
| 1    | 10.5      | 非空     | 是                     |
| 2    | 99        | 空格     | 否（空格忽略）         |
| 13   | 11        | 非空     | 是                     |
| 15   | NaN       | 非空     | 否（NaN 比较恒 false） |
| 17   | 99        | 空格     | 否（空格忽略）         |
| 22   | +Infinity | 非空     | 是                     |

```ts
buildReport(p, deltas, { maxFragmentSize: 2, minThinRun: 3, highDeltaThreshold: 10 });
// {
//   isolated: [0, 13, 15, 22],
//   fragments: [...同上...],
//   thinRuns: [...同上...],
//   highDelta: [1, 13, 22],
//   nonEmptyCells: 8
// }
```

---

## 复杂度分析

设 `n = width * height`。

| 函数            | 时间 | 额外空间（不含输出） | 说明                                                                       |
| --------------- | ---- | -------------------- | -------------------------------------------------------------------------- |
| `findIsolated`  | O(n) | O(1)                 | 每格检查至多 4 个邻居。                                                    |
| `findFragments` | O(n) | O(n)                 | `visited` (`Uint8Array(n)`) + 显式栈 (`Int32Array(n)`)。每格入栈至多一次。 |
| `findThinRuns`  | O(n) | O(输出条数)          | 行、列各线性扫描一次，游程不重叠回溯。                                     |
| `buildReport`   | O(n) | O(n)                 | 4 次线性 pass，量级不变。                                                  |

**不使用递归 DFS。** 256×256 的满色图是一个 65,536 格的连通分量；递归 DFS 的调用深度
会达到 65,536 层，超过 JS 引擎常见调用栈上限，直接抛
`RangeError: Maximum call stack size exceeded`。因此 `findFragments` 使用预分配的
`Int32Array(n)` 作为**显式栈**，并在入栈时立即标记 `visited`，保证：

1. 任何格子最多入栈一次，栈峰值 ≤ n，不会越界；
2. 调用深度恒为 1，与图大小无关；
3. 仍是 O(n)，且避免了递归的函数调用开销。

选显式栈而不是并查集的原因：本模块只需要「收集分量 + 求最小值」，单次 DFS 即可完成；
并查集需要额外处理路径压缩与分量归并，代码更长且没有性能收益。

## 确定性检查

- 实现中没有 `Math.random`、`Date`、`performance.now`，也没有依赖对象键顺序的 `Map`/`Set` 遍历。
- 排序比较器都是**全序**：`fragments` 用 `(size, minIndex)`，由于不同分量的最小索引必然不同，
  不会出现比较结果为 0 的平局；`thinRuns` 用 `(row, col, orientation)`，同一位置同一方向不可能重复。
- `buildReport` 对 ΔE 只做逐格比较，不做求和/平均，因此不存在浮点累加顺序问题；
  `NaN` 被跳过，`±Infinity` 按 IEEE-754 正常比较。
- 相同输入重复调用，输出结构逐字段相等；诊断过程只读，不修改 `cells` 或 `perCellDelta`。
