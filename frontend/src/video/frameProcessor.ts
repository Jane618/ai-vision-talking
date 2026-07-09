/**
 * 帧处理 Worker 管理器。
 * 管理 Web Worker 生命周期，暴露 processFrame() 方法。
 * 浏览器不支持 Worker 时回退到主线程同步处理。
 */

import { captureFrame, type CaptureSettings, type CaptureResult } from './frameSampler';

type ProcessorResult = {
  blob: Blob;
  effectiveQuality: number;
  complexity: CaptureResult['complexity'];
  estimatedBytes: number;
  width: number;
  height: number;
};

export type { ProcessorResult };

let worker: Worker | null = null;
let workerId = 0;

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(
      new URL('./frameProcessor.worker.ts', import.meta.url),
      { type: 'module' },
    );
    return worker;
  } catch {
    console.warn('[frameProcessor] Worker 创建失败，回退到主线程处理');
    return null;
  }
}

/**
 * 在 Worker 中处理一帧视频。
 * @param videoEl - <video> 元素
 * @param settings - 抽帧设置
 * @returns 包含 Blob 和复杂度信息的 ProcessorResult
 */
export async function processFrame(
  videoEl: HTMLVideoElement,
  settings: CaptureSettings,
): Promise<ProcessorResult> {
  const w = getWorker();
  if (!w) {
    // 回退到主线程
    const result = await captureFrame(videoEl, settings, null, 6);
    const blob = await new Promise<Blob>((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = result.imageData.width;
      canvas.height = result.imageData.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        // 极端降级：返回空 Blob
        resolve(new Blob([], { type: 'image/jpeg' }));
        return;
      }
      ctx.putImageData(result.imageData, 0, 0);
      canvas.toBlob((b) => resolve(b || new Blob([], { type: 'image/jpeg' })), 'image/jpeg', result.effectiveQuality);
    });
    return {
      blob,
      effectiveQuality: result.effectiveQuality,
      complexity: result.complexity,
      estimatedBytes: result.estimatedBytes,
      width: result.imageData.width,
      height: result.imageData.height,
    };
  }

  const id = ++workerId;

  return new Promise<ProcessorResult>((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.error) {
        reject(new Error(e.data.error));
        return;
      }
      resolve(e.data as ProcessorResult);
    };

    const onError = (e: ErrorEvent) => {
      reject(new Error(e.message || 'Worker 处理失败'));
    };

    w.addEventListener('message', onMessage, { once: true });
    w.addEventListener('error', onError as EventListener, { once: true });

    // 从 video 元素零拷贝提取 ImageBitmap
    createImageBitmap(videoEl)
      .then((imageBitmap) => {
        if (id !== workerId) {
          // 被新的请求覆盖，丢弃
          imageBitmap.close();
          reject(new Error('请求被覆盖'));
          return;
        }
        w.postMessage({ imageBitmap, settings }, [imageBitmap]);
      })
      .catch((err) => {
        reject(err);
      });

    // 超时保护（30 秒）
    setTimeout(() => {
      w.removeEventListener('message', onMessage);
      reject(new Error('Worker 处理超时'));
    }, 30000);
  });
}

/** 销毁 Worker 实例。 */
export function destroyWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}
