/**
 * 视频抽帧：从 <video> 元素获取当前帧，压缩为 JPEG base64。
 * 并提供简单的帧差计算（降采样到 32x32），用于判定画面是否显著变化。
 */

export interface CaptureSettings {
  imageSize: number;  // 输出图像最长边像素，默认 512
  imageQuality: number; // JPEG 质量，0.3 - 1.0，默认 0.8
}

export interface CaptureResult {
  base64: string;
  changed: boolean;
  imageData: ImageData;
}

/**
 * 将 video 当前帧绘制到离屏 canvas，输出 JPEG base64。
 * 保持宽高比，最长边缩放到 imageSize。
 */
export async function captureFrame(
  videoEl: HTMLVideoElement,
  settings: CaptureSettings,
  prevData?: ImageData | null,
  changeThreshold = 8,
): Promise<CaptureResult> {
  const { imageSize = 512, imageQuality = 0.8 } = settings;

  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) {
    throw new Error('视频尚未就绪，无法抽帧');
  }

  const scale = Math.min(1, imageSize / Math.max(vw, vh));
  const outW = Math.max(1, Math.round(vw * scale));
  const outH = Math.max(1, Math.round(vh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 canvas 2D 上下文');

  ctx.drawImage(videoEl, 0, 0, outW, outH);
  const imageData = ctx.getImageData(0, 0, outW, outH);

  const base64 = canvas.toDataURL('image/jpeg', imageQuality);

  const changed = prevData
    ? computeFrameDifference(imageData, prevData) > changeThreshold
    : true;

  return { base64, changed, imageData };
}

/**
 * 计算两张 ImageData 的平均像素差：
 * - 每张图先缩放到 32x32
 * - 计算 (R+G+B)/3 灰度平均差
 * 便于感知"画面是否显著变化"。
 */
export function computeFrameDifference(
  currentData: ImageData,
  prevData: ImageData,
): number {
  const a = downsample(currentData, 32, 32);
  const b = downsample(prevData, 32, 32);
  if (!a || !b || a.length !== b.length) return Infinity;

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / a.length; // 0 ~ 255 灰度差均值
}

/** 将 ImageData 降采样为 targetW*targetH 的灰度数组。 */
function downsample(src: ImageData, targetW: number, targetH: number): number[] | null {
  if (!src.width || !src.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const tmp = document.createElement('canvas');
  tmp.width = src.width;
  tmp.height = src.height;
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  if (!tctx) return null;
  tctx.putImageData(src, 0, 0);

  ctx.drawImage(tmp, 0, 0, targetW, targetH);
  const data = ctx.getImageData(0, 0, targetW, targetH).data;
  const gray: number[] = new Array(targetW * targetH);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  return gray;
}
