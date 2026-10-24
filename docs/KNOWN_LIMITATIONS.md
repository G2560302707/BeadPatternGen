# 已知限制（一期）

## 表达能力

- 网格粗于五官、瞳孔、小字时，单豆无法表达这些细节。诊断会提示加大网格，但不能创造信息。
- 色卡是离散集合；渐变会被合并或抖动成可见颗粒。

## 色卡来源

- 投产 Artkal S Midi HEX 来自 beadcolors 社区测量，**不是** Artkal 官方色度。买豆时以商家实物为准。
- 一期只锁定这一套；MARD / Perler / 自备色卡未提供。

## 导出

- PNG / PDF 颜色来自 `BeadPattern.palette`，不二次量化。PNG 用 5×7 点阵写 ASCII 色号与坐标；中文标题在 PNG 上会跳过。
- PDF 使用 Helvetica，图例写色号 + HEX + 颗数；中文色名以 CSV / JSON / 界面为准。
- 制作版 PDF 页数 = `computePages()` 页数 + 清单页。预览版把整图缩到一页，仅供浏览，不能当制作切片。
- 大图 PNG 在 CPU 缓冲区分带写入，不分配边长超过 8000px 的 Canvas。

## 性能

- 规格 9.1：50×50 ≤ 1s、100×100 ≤ 3s、200×200 ≤ 10s 需在目标机器上人工记时。本仓库未把这些阈值写成失败门禁。
- 200×200 预览首帧曾在 Node Fake Canvas 上测量，不能代表真实浏览器 2D。
- R7：状态栏「生成完成 · 耗时 X.Xs」是本机单次实测（从任务发起到结果落地）；正式记录见 [性能记时表](./manual/性能记时表.md)，未实测前该表留空。

## 浏览器

- 需要 Canvas 2D、Web Worker、IndexedDB、`createImageBitmap`。
- EXIF：5–8 且非正方形可通过宽高交换纠正；正方形或 2/3/4 若浏览器忽略 `from-image` 可能朝向不对。
- 清除站点数据会删除 IndexedDB 项目。

## 隐私

- 应用源码中无 `fetch` / `axios` / `XMLHttpRequest` / `sendBeacon` / `WebSocket`。
- 页面不加载 Google Fonts 或其它第三方 CDN；字体走系统栈。
- E2E 拦截请求：除本站静态资源、`blob:`、`data:` 外零请求。Vite 开发服务器的 HMR 不在预览/生产路径。

## 主体识别（二期 C4）

- **单主体**：u2net 家族输出一张显著性图，只返回一个候选，不做多主体实例分割。
- **模型质量**：u2netp 是 4.4 MB 的小模型。细发丝、透明物体、主体与背景同色时边缘会丢；
  当前不是量化版，量化版质量未验证。替换模型只需改 `model-manifest.json`。
- **首次下载**：模型 4.4 MB + ORT jsep wasm 27 MB（gzip 约 6.4 MB）。识别依赖网络；
  下载后进 Cache Storage，同一浏览器离线可用。
- **速度**：无 COOP/COEP 时单线程 WASM，1000×667 测试图约 3.5–4 s（含初始化）。
- **WebGPU** 需构建时 `VITE_SEGMENTATION_WEBGPU=1`，失败自动回退 WASM；
  不纳入自动冒烟 / CI。本地冒烟步骤与后端确认方法（Worker 控制台
  `[segmentation] 推理后端 provider=…` 日志）见 `docs/SEGMENTATION.md` 6.1 节。
- 分割后不做去噪 / 填孔 / 羽化，需经 C2 `postProcessMask()`；
  C6 的 `detectSubjects()` 已固定串联该步骤，UI 不需自行调用。
- **识别输入优先用原文件字节**：EXIF 方向不是 1 时仍从已纠正的 `ImageBitmap` 重编码，
  避免 Worker 蒙版坐标系和预览位图对不上。
- **`imageId` 内容寻址**：`imageIdFromBytes()` 对原图做 SHA-256。再导入同一文件会
  `loadSubjectsWithMasksForImage()` 恢复主体，跳过分割；蒙版宽高与当前位图不一致则重新识别。
- **重复识别**：「重新识别」已改为 `replaceExisting: true`，会先删除同一张图的旧主体
  （含蒙版 Blob）再写新记录，不会堆积孤儿数据。同一次会话内的首次识别仍用追加模式。
- 模型与 wasm 运行时不在仓库内：`pnpm models:download` / `pnpm ort:sync` 获取，
  部署时 `public/models/` 与 `public/ort/` 需随 `dist/` 上传。

## 二期编辑器（S16–S22 与 R1–R3）

- 画笔 / 橡皮 / 吸管 / 撤销重做 / 矩形与套索选区 / 填充 / 替换色 / 镜像 / 旋转 / 平移 / 复制粘贴已接入。
- 编辑写入走稀疏命令，不改一期 `generatePattern` 与导出实现。
- 手工改过的格子记 `locked`；选区再生成跳过它们。没有采样缓冲时会用内存中的
  原图按 `pattern.source.crop` 重采样一次（R3）；连原图都没有则按钮禁用并提示
  「需要原图才能局部再生成」，不静默失败。
- 旋转（R2）支持非正方形选区：2×3 转 90° 变 3×2，越出画布的像素丢弃并在命令层
  报告 clipped；平移提供上/下/左/右移 1 格，选区随内容移动。旧
  `rotateSelectionCW`（仅正方形）保留但 UI 已改用新的 `rotateSelection`。
- 图层（R1）：1 个只读基底（生成结果）+ 1 个精修层 overlay（`EMPTY_CELL` 透出
  基底），不提供更多层。隐藏精修层后画布 / 统计 / 导出都使用基底矩阵；「从基底
  还原精修层」走命令栈可撤销，恢复的格子按既有规则标记 locked。
- 图层侧车随自动保存草稿持久化（`edit-drafts` 记录新增 base / overlay /
  refineVisible 字段）。**旧草稿与「另存副本」没有基底**：打开后精修内容被视为
  基底（展平），这不是 bug，是侧车模型的边界。不把图层写进 schema 1.0 项目 JSON。
- 自动保存写入 IndexedDB `edit-drafts`，正式「保存到本机」后清除草稿。「另存副本」生成新 id。
- 视觉还原质量只能人工盲测：记录表见 [视觉盲测记录表](./manual/视觉盲测记录表.md)，
  未实测前为空；禁止任何自动评分。

## 一期故意不做（已由二期覆盖的除外）

图层、授权外色卡、把诊断编成还原度分数。
