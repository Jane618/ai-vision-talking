/**
 * 视频抽帧：从 <video> 元素获取当前帧，压缩为 JPEG base64。
 * 并提供细节敏感的帧差计算，用于判定画面是否显著变化。
 */

export interface CaptureSettings {
  imageSize: number;  // 输出图像最长边像素，默认 512
  imageQuality: number; // JPEG 质量，0.3 - 1.0，默认 0.8
  /** 是否根据画面复杂度自动调整 JPEG 质量 */
  adaptiveImageQuality?: boolean;
  /** 自适应 JPEG 质量下限，默认 0.45 */
  imageQualityMin?: number;
}

export interface CaptureResult {
  base64: string;
  changed: boolean;
  imageData: ImageData;
  effectiveQuality: number;
  complexity: ImageComplexity;
  estimatedBytes: number;
}

export interface ImageComplexity {
  /** 0~1，综合 Laplacian 方差与边缘像素比例后的复杂度分数 */
  score: number;
  /** Laplacian 方差，文字、纹理、细节越多通常越高 */
  laplacianVariance: number;
  /** 边缘像素比例，0~1 */
  edgeRatio: number;
  /** 便于 UI 展示的复杂度等级 */
  level: 'low' | 'medium' | 'high';
}

/**
 * 将 video 当前帧绘制到离屏 canvas，输出 JPEG base64。
 * 保持宽高比，最长边缩放到 imageSize。
 */
export async function captureFrame(
  videoEl: HTMLVideoElement,
  settings: CaptureSettings,
  prevData?: ImageData | null,
  changeThreshold = 6,
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

  const complexity = analyzeImageComplexity(imageData);
  const effectiveQuality = resolveImageQuality(settings, complexity.score);
  const base64 = canvas.toDataURL('image/jpeg', effectiveQuality);
  const estimatedBytes = estimateDataUrlBytes(base64);

  const changed = prevData
    ? computeFrameDifference(imageData, prevData) > changeThreshold
    : true;

  return { base64, changed, imageData, effectiveQuality, complexity, estimatedBytes };
}

/**
 * 计算两张 ImageData 的细节敏感帧差：
 * - 每张图先缩放到 64x64，保留更多局部细节
 * - 结合全局平均差、变化像素比例、边缘变化比例、局部块最大变化
 * - 避免文字、小物体、手势等局部变化被全局平均值抹平
 */
export function computeFrameDifference(
  currentData: ImageData,
  prevData: ImageData,
): number {
  const size = 64;
  const a = downsample(currentData, size, size);
  const b = downsample(prevData, size, size);
  if (!a || !b || a.length !== b.length) return Infinity;

  let diffSum = 0;
  let changedPixels = 0;
  let maxBlockDiff = 0;
  const blockSize = 8;

  for (let by = 0; by < size; by += blockSize) {
    for (let bx = 0; bx < size; bx += blockSize) {
      let blockDiff = 0;
      let blockCount = 0;

      for (let y = by; y < by + blockSize; y++) {
        for (let x = bx; x < bx + blockSize; x++) {
          const i = y * size + x;
          const diff = Math.abs(a[i] - b[i]);
          diffSum += diff;
          blockDiff += diff;
          blockCount++;
          if (diff > 8) changedPixels++;
        }
      }

      maxBlockDiff = Math.max(maxBlockDiff, blockDiff / blockCount);
    }
  }

  let edgeChangedPixels = 0;
  let edgeCount = 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const lapA = a[i - size] + a[i - 1] + a[i + 1] + a[i + size] - a[i] * 4;
      const lapB = b[i - size] + b[i - 1] + b[i + 1] + b[i + size] - b[i] * 4;
      if (Math.abs(lapA - lapB) > 14) edgeChangedPixels++;
      edgeCount++;
    }
  }

  const meanDiff = diffSum / a.length;
  const changedRatio = changedPixels / a.length;
  const edgeChangedRatio = edgeCount ? edgeChangedPixels / edgeCount : 0;

  return (
    meanDiff * 0.5 +
    changedRatio * 35 +
    edgeChangedRatio * 30 +
    maxBlockDiff * 0.45
  );
}

/**
 * 分析画面复杂度：
 * - 使用 Laplacian 方差感知文字、纹理、细节密度
 * - 使用边缘像素比例补充判断线条/轮廓密度
 * - 输出 0~1 分数，用于映射 JPEG quality
 */
export function analyzeImageComplexity(imageData: ImageData): ImageComplexity {
  const gray = downsample(imageData, 96, 96);
  if (!gray) {
    return { score: 0.5, laplacianVariance: 0, edgeRatio: 0, level: 'medium' };
  }

  const width = 96;
  const height = 96;
  const values: number[] = [];
  let edgeCount = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const laplacian =
        gray[i - width] +
        gray[i - 1] +
        gray[i + 1] +
        gray[i + width] -
        gray[i] * 4;
      const abs = Math.abs(laplacian);
      values.push(laplacian);
      if (abs > 18) edgeCount++;
    }
  }

  if (values.length === 0) {
    return { score: 0.5, laplacianVariance: 0, edgeRatio: 0, level: 'medium' };
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const laplacianVariance =
    values.reduce((sum, value) => {
      const diff = value - mean;
      return sum + diff * diff;
    }, 0) / values.length;
  const edgeRatio = edgeCount / values.length;

  // 经验阈值：低复杂度纯色/天空接近 0；文字、屏幕、密集纹理趋近 1。
  const varianceScore = clamp01((laplacianVariance - 80) / 900);
  const edgeScore = clamp01((edgeRatio - 0.03) / 0.22);
  const score = clamp01(varianceScore * 0.7 + edgeScore * 0.3);
  const level = score >= 0.68 ? 'high' : score <= 0.32 ? 'low' : 'medium';

  return { score, laplacianVariance, edgeRatio, level };
}

function resolveImageQuality(settings: CaptureSettings, complexityScore: number): number {
  const maxQuality = clamp(settings.imageQuality ?? 0.8, 0.3, 1);
  if (!settings.adaptiveImageQuality) return maxQuality;

  const rawMin = settings.imageQualityMin ?? Math.max(0.3, maxQuality - 0.35);
  const minQuality = clamp(Math.min(rawMin, maxQuality), 0.3, 1);
  const easedScore = easeInOut(complexityScore);
  return clamp(minQuality + (maxQuality - minQuality) * easedScore, minQuality, maxQuality);
}

function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return Math.round((base64.length * 3) / 4);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeInOut(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
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
