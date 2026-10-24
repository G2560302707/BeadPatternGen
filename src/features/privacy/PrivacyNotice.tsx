export function PrivacyNotice() {
  return (
    <section className="privacy-notice" data-testid="privacy-notice">
      <h3>隐私说明</h3>
      <ul>
        <li>图片不会上传到任何服务器，转换只在你的浏览器里完成。</li>
        <li>你点「保存到本机」后，图纸会写入本机 IndexedDB；不点保存则不会存库。</li>
        <li>清除浏览器站点数据会删掉 IndexedDB 里的项目，无法从本应用恢复。请先导出 JSON。</li>
        <li>当前版本没有接入第三方图像处理服务。若未来接入，会先明确征求授权。</li>
      </ul>
    </section>
  );
}
