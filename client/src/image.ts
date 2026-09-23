// v2.10：性状示意图上传工具 — 客户端压缩为 dataURL（≤maxEdge 边长，质量递降直到 ≤maxBytes）。
// 存 DB 的 trait_def.illustration 列（随备份走、随行删除）；超限抛 TOO_LARGE。

export async function fileToDataUrl(
  file: File,
  maxEdge = 512,
  maxBytes = 300 * 1024,
): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('READ_FAILED'));
    reader.readAsDataURL(file);
  });

  const imageEl = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
    img.src = raw;
  });

  let { width, height } = imageEl;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  ctx.drawImage(imageEl, 0, 0, width, height);

  // 先试 PNG（线稿无损、尺寸小），超限则转 JPEG 质量递降
  let out = canvas.toDataURL('image/png');
  if (out.length <= maxBytes) return out;
  for (let q = 0.9; q >= 0.4; q -= 0.1) {
    out = canvas.toDataURL('image/jpeg', q);
    if (out.length <= maxBytes) return out;
  }
  throw new Error('TOO_LARGE');
}
