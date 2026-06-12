import { useEffect, useRef, useState } from 'react';

interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement>;
  stream: MediaStream | null;
  error: string | null;
  isReady: boolean;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * 获取摄像头媒体流，并绑定到 <video> 元素。
 * - 组件挂载时自动尝试获取权限
 * - 暴露 start / stop 手动控制
 */
export function useCamera(constraints: MediaTrackConstraints = {}): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const stop = () => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    streamRef.current = null;
    setStream(null);
    setIsReady(false);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const start = async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setError('当前浏览器不支持摄像头访问，请使用 HTTPS 或最新版 Chrome/Edge。');
      return;
    }
    try {
      setError(null);
      stop();
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
          ...constraints,
        },
        audio: false,
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(() => undefined);
        setIsReady(true);
      } else {
        setIsReady(true);
      }
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      const msg =
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? '已拒绝摄像头权限，请在浏览器设置中允许后重试。'
          : name === 'NotFoundError'
            ? '未检测到可用摄像头设备。'
            : '打开摄像头失败：' + ((err as Error)?.message || '未知错误');
      setError(msg);
    }
  };

  useEffect(() => {
    start();
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { videoRef, stream, error, isReady, start, stop };
}
