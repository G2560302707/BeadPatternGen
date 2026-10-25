import { Link } from "react-router-dom";
import { BRAND } from "../../app/brand";
import { Mascot } from "../../design/mascot/Mascot";

/**
 * 应用内使用文档（#/help）：与 docs/manual/使用说明书.md 同源的游客版，
 * 面向使用者组织——六步流程、导出格式、保存与隐私、常见问题。
 * 内容为静态 JSX，不发请求；新增功能时与说明书同步更新。
 */

const STEPS = [
  {
    emoji: "📷",
    title: "① 导入",
    route: "/make/import",
    body: "拖入 / 选择图片，或直接 Ctrl+V 粘贴截图。支持 JPG / PNG / WebP（≤20MB、单边 ≤8192px，手机竖拍自动转正）。没有图可以先用内置示例（爱心 / 星星 / 草莓 / 日落）玩一把。",
  },
  {
    emoji: "✂️",
    title: "② 抠图构图（可选）",
    route: "/make/compose",
    body: "一键识别主体并摆到 C 位，可手涂蒙版修补、调整主体占比（默认 90%，拉到 100% + 0 边距即顶满画板）、换背景。不需要抠图就点「跳过」。",
  },
  {
    emoji: "📐",
    title: "③ 画布裁剪",
    route: "/make/canvas",
    body: "调整裁剪框、设定网格尺寸（每格 = 一颗豆）。可用市售板子预设一键套用：5mm 标准板 29×29、2.6mm 小板 26×26（52 钉大板 = 2×2，78 钉 = 3×3），下方实时显示拼板数与成品厘米尺寸。",
  },
  {
    emoji: "🎨",
    title: "④ 调色生成",
    route: "/make/generate",
    body: "选画风卡片：照片 / 二次元（保描边）/ 图标文字（保硬边、透明区不填豆）/ 风景（消杂点），再定最大颜色数（色少更好买豆）。生成在后台进行，显示六阶段进度，可随时取消。",
  },
  {
    emoji: "🖌️",
    title: "⑤ 精修",
    route: "/make/refine",
    body: "画笔 / 橡皮 / 吸色 / 套索与框选填充 / 撤销重做，右侧色卡点一下即选为画笔色；对照滑块可把原图叠在图纸上检查。生成完自动给出孤立豆等质量诊断。",
  },
  {
    emoji: "🎁",
    title: "⑥ 导出分享",
    route: "/make/export",
    body: "六种导出全部是统一的「分享卡片」版式：分享图纸 PNG（社交卡片，可带原图 / 烫后对比与水印）、图纸 PNG、制作版 PDF（照着拼）、预览版 PDF、采购 CSV、工程 JSON。点任意导出有彩带庆祝 🎉。",
  },
];

const EXPORTS = [
  {
    name: "分享图纸 PNG",
    detail: "竖版社交卡片：信息栏（规格 / 色板 / 色数 / 用豆）+ 白色圆角图纸卡（格内色号 + 每 5 格分区线）+ 圆角图例 + 原图 / 烫后效果对比 + 水印。直接发社交平台或发买家。",
  },
  {
    name: "图纸 PNG",
    detail: "同款卡片版式的工程导出（纯像素、颜色逐格精确），格尺寸 8–32px 可选，可开关网格 / 图例 / 行列号 / 每格色号。",
  },
  {
    name: "制作版 PDF",
    detail: "A4 / A3 / Letter 纸张，中文页眉。超出单页自动整图缩放进一页（矢量不失真），也可关闭后按重叠格切片分页；默认附带圆角色块色表页。",
  },
  {
    name: "预览版 PDF",
    detail: "单页整图 + 完整信息栏，同样附带色表页，适合快速发给买家确认。",
  },
  {
    name: "CSV",
    detail: "用色清单（色号、色名、HEX、数量、占比），UTF-8 带 BOM，Excel 双击直开，拿去采购。",
  },
  {
    name: "JSON",
    detail: "完整工程文件，随时导回来继续改（导入在首页「导入工程 JSON」）。清除浏览器数据前记得用它备份。",
  },
];

const FAQ = [
  {
    q: "我的图片会上传吗？",
    a: "不会。解码、采样、匹配、导出全部在你的浏览器里完成，没有账号、没有服务器；状态栏的 🔒 提示全程有效。",
  },
  {
    q: "图纸存在哪里？会丢吗？",
    a: "存在浏览器本地的 IndexedDB，刷新后自动恢复。但清除浏览器站点数据会全部删除——重要图纸请「保存到本机」并导出 JSON 备份。",
  },
  {
    q: "色号和实物对得上吗？",
    a: "色卡为社区测量的 MARD 221（2.6mm 小豆，默认）与 Artkal S（5mm 大豆），个别颜色存在色差，图纸脚注也标注「色号与用量仅供参考」。",
  },
  {
    q: "为什么二次元 / 图标模式不能开抖动？",
    a: "设计行为：抖动会把色块和文字打散成碎点，这两种模式强制关闭以保护描边。照片 / 风景模式才建议开启。",
  },
  {
    q: "网格最大能开多大？",
    a: "256 × 256（单边 1–256，乘积 ≤ 65536）。网格越大越精细也越费豆，市售板子 52×52 / 78×78 都可以直接套预设。",
  },
  {
    q: "主题在哪里换？",
    a: "右上角 🎨 弹出菜单，8 套主题即点即换并记忆：樱粉少女 / 香芋啵啵 / 抹茶手账 / 海盐汽水 / 月夜宫阙（暗色）/ 云朵白 / 复古信笺 / 像素工坊。",
  },
];

/** 应用内使用文档页。 */
export default function HelpPage() {
  return (
    <div className="page">
      <article className="help">
        <header className="help__hero">
          <Mascot mood="happy" size={88} className="help__mascot" />
          <div>
            <h1>{BRAND.name} · 使用说明</h1>
            <p className="hint">
              {BRAND.tagline}——六步把任意图片变成能直接照着拼的拼豆图纸。
            </p>
          </div>
        </header>

        <section className="help__section">
          <h2>🧭 六步出图</h2>
          <p className="hint">顶部步进器随时跳转，缺前置条件时页面会引导你而不是报错。</p>
          <ol className="help__steps">
            {STEPS.map((step) => (
              <li key={step.title} className="help__step">
                <h3>
                  <span aria-hidden="true">{step.emoji}</span> {step.title}
                </h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="help__section">
          <h2>📤 六种导出，一套版式</h2>
          <p className="hint">
            所有视觉导出共用同一套「分享卡片」版式：暖粉纸底、页眉信息栏、白色圆角图纸卡
            + 红色角标、每 5 格分区线、按用量排序的图例与脚注。
          </p>
          <ul className="help__cards">
            {EXPORTS.map((item) => (
              <li key={item.name} className="help__card">
                <h3>{item.name}</h3>
                <p>{item.detail}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="help__section">
          <h2>💾 保存与隐私</h2>
          <ul>
            <li>
              「保存到本机」把图纸存进浏览器 IndexedDB，首页「我的作品」卡片墙可随时打开或删除；
              可「另存副本」与「清理缩略图」管理空间。
            </li>
            <li>
              所有处理都在本地完成，图片与图纸<strong>绝不上传</strong>；清除浏览器数据会删除本地项目，
              重要图纸请导出 JSON 备份。
            </li>
            <li>
              详见<Link to="/privacy">隐私政策</Link>与<Link to="/terms">用户协议</Link>。
            </li>
          </ul>
        </section>

        <section className="help__section">
          <h2>❓ 常见问题</h2>
          <dl className="help__faq">
            {FAQ.map((item) => (
              <div key={item.q} className="help__faq-item">
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <footer className="help__footer">
          <Link className="btn btn--primary" to="/">
            开始制作 →
          </Link>
          <p className="hint">更完整的说明书见仓库 docs/manual/使用说明书.md</p>
        </footer>
      </article>
    </div>
  );
}
