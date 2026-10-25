import { Link } from "react-router-dom";
import { BRAND } from "../../app/brand";

/** 隐私政策 / 用户协议静态页（上线推广前可由你审定后替换正式文案）。 */
export default function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const isPrivacy = kind === "privacy";
  return (
    <div className="page">
      <article className="legal">
        <h1>{isPrivacy ? "隐私政策" : "用户协议"}</h1>
        <p className="hint">最后更新：2026-10-25</p>

        {isPrivacy ? (
          <>
            <p>
              {BRAND.name}是一款纯前端工具：<strong>你导入的图片和生成的图纸全部在你自己的浏览器里处理与保存</strong>
              （IndexedDB），不会上传到任何服务器，也没有账号系统。
            </p>
            <p>我们会收集什么：</p>
            <ul>
              <li>不收集任何个人信息、不上传任何图片或图纸；</li>
              <li>
                本地存储仅用于记忆你的主题偏好与保存「保存到本机」的作品，清除浏览器站点数据即全部删除；
              </li>
              <li>当前版本不接入任何第三方统计或图像处理服务；若未来接入，会在此页先行公示并征求同意。</li>
            </ul>
            <p>
              色卡数据来自社区开源项目（MARD 221、Artkal S），分割模型 u2netp 为 Apache-2.0
              开源模型；详见仓库 README 的许可说明。
            </p>
          </>
        ) : (
          <>
            <p>
              使用{BRAND.name}即表示你同意以下条款。本工具按「现状」提供，免费使用；生成的图纸版权与用途由你自己负责。
            </p>
            <ul>
              <li>请确保你有权使用所导入的图片，因图片版权引起的纠纷由使用者承担；</li>
              <li>色号为社区测量值，与实物可能存在个别色差，用量清单仅供参考；</li>
              <li>本地数据（IndexedDB）可能因清除浏览器数据而丢失，重要图纸请导出 JSON 备份；</li>
              <li>请勿将本工具用于违法用途。</li>
            </ul>
          </>
        )}

        <p>
          <Link to="/help">📖 使用说明</Link>
        </p>
        <p>
          <Link to="/">{isPrivacy ? "← 回首页" : "← 查看隐私政策"}</Link>
        </p>
      </article>
    </div>
  );
}
