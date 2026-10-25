// PDF 中文子集字体的字符集（唯一来源）。
// src/export/card-style.ts 的 PDF_CJK_CHARSET 必须与此字符串完全一致，
// 有单测（export.test.ts）对拍；新增 PDF 中文文案时两处同步修改并跑 pnpm fonts:pdf。
export const PDF_CJK_CHARSET =
  "拼豆图纸分享制作版预览规格色板数用豆颗第页共行列重叠右下色卡清单按排序号与参考仅供每格分区线核对水印整图缩放矢量不失真单纸张裁切间加号左右上下备用";
