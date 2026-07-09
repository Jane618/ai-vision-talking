/**
 * 帧处理 Worker：在后台线程中执行 Canvas 操作，
 * 包括缩放、Laplacian 复杂度分析、JPEG 编码。
 * 主线程传入 ImageBitmap，Worker 返回处理结果。
 */

interface WorkerSettings {
  imageSize: number;
  imageQuality: number;
  adaptiveImageQuality?: boolean;
  imageQualityMin?: number;
}

interface ProcessorResult {
  blob: Blob;
  effectiveQuality: number;
  complexity: {
    score: number;
    laplacianVariance: number;
    edgeRatio: number;
    level: 'low' | 'medium' | 'high';
  };
  estimatedBytes: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function easeInOut(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/** 将 ImageData 降采样为灰度数组。 */
function toGray(src: ImageData, targetW: number, targetH: number): number[] | null {
  if (!src.width || !src.height) return null;
  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const tmp = new OffscreenCanvas(src.width, src.height);
  const tctx = tmp.getContext('2d');
  if (!tctx) return null;
  tctx.putImageData(src, 0, 0);
  ctx.drawImage(tmp, 0, 0, targetW, targetH);

  const data = ctx.getImageData(0, 0, targetW, targetH).data;
  const gray = new Uint8Array(targetW * targetH);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  return gray as unknown as number[];
}

/** Laplacian 复杂度分析。 */
function analyzeComplexity(imageData: ImageData): {
  score: number;
  laplacianVariance: number;
  edgeRatio: number;
  level: 'low' | 'medium' | 'high';
} {
  const gray = toGray(imageData, 96, 96);
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
        gray[i - width] + gray[i - 1] + gray[i + 1] + gray[i + width] - gray[i] * 4;
      values.push(laplacian);
      if (Math.abs(laplacian) > 18) edgeCount++;
    }
  }

  if (values.length === 0) {
    return { score: 0.5, laplacianVariance: 0, edgeRatio: 0, level: 'medium' };
  }

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const laplacianVariance =
    values.reduce((sum, v) => {
      const diff = v - mean;
      return sum + diff * diff;
    }, 0) / values.length;
  const edgeRatio = edgeCount / values.length;

  const varianceScore = clamp01((laplacianVariance - 80) / 900);
  const edgeScore = clamp01((edgeRatio - 0.03) / 0.22);
  const score = clamp01(varianceScore * 0.7 + edgeScore * 0.3);
  const level = score >= 0.68 ? 'high' : score <= 0.32 ? 'low' : 'medium';

  return { score, laplacianVariance, edgeRatio, level };
}

function resolveQuality(settings: WorkerSettings, complexityScore: number): number {
  const maxQuality = clamp(settings.imageQuality ?? 0.8, 0.3, 1);
  if (!settings.adaptiveImageQuality) return maxQuality;

  const rawMin = settings.imageQualityMin ?? Math.max(0.3, maxQuality - 0.35);
  const minQuality = clamp(Math.min(rawMin, maxQuality), 0.3, 1);
  const easedScore = easeInOut(complexityScore);
  return clamp(minQuality + (maxQuality - minQuality) * easedScore, minQuality, maxQuality);
}

self.onmessage = async (e: MessageEvent<{
  imageBitmap: ImageBitmap;
  settings: WorkerSettings;
}>) => {
  const { imageBitmap, settings } = e.data;
  const vw = imageBitmap.width;
  const vh = imageBitmap.height;
  const imageSize = settings.imageSize || 512;

  if (!vw || !vh) {
    self.postMessage({ error: 'ImageBitmap 无效' });
    return;
  }

  const scale = Math.min(1, imageSize / Math.max(vw, vh));
  const outW = Math.max(1, Math.round(vw * scale));
  const outH = Math.max(1, Math.round(vh * scale));

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    self.postMessage({ error: '无法创建 OffscreenCanvas 上下文' });
    return;
  }

  // 绘制并提取像素
  ctx.drawImage(imageBitmap, 0, 0, outW, outH);
  const imageData = ctx.getImageData(0, 0, outW, outH);

  // Laplacian 复杂度分析
  const complexity = analyzeComplexity(imageData);
  const effectiveQuality = resolveQuality(settings, complexity.score);

  // 编码为 JPEG Blob
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: effectiveQuality });
  const estimatedBytes = blob.size;

  // 释放 ImageBitmap
  imageBitmap.close();

  // 传输 Blob 回主线程（可转移）
  const result: ProcessorResult = {
    blob,
    effectiveQuality,
    complexity,
    estimatedBytes,
    width: outW,
    height: outH,
  };

  self.postMessage(result);
};
