import { Link } from "react-router-dom";
import { Mascot } from "../design/mascot/Mascot";

export default function NotFoundPage() {
  return (
    <div className="gate">
      <Mascot mood="sad" size={110} />
      <h2>这里没有豆子…</h2>
      <p>页面地址可能打错了。回首页继续吧。</p>
      <Link className="btn btn--primary" to="/">
        回首页
      </Link>
      <p>
        <Link to="/help">📖 去看使用说明</Link>
      </p>
    </div>
  );
}
