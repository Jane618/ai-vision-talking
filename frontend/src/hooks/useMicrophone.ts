import { useEffect, useRef, useState } from 'react';

interface UseMicrophoneResult {
  stream: MediaStream | null;
  error: string | null;
  isReady: boolean;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * 获取麦克风媒体流。与摄像头分离，便于给语音识别 / 录音独立控制。
 */
export function useMicrophone(): UseMicrophoneResult {
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
  };

  const start = async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setError('当前浏览器不支持麦克风访问，请使用 HTTPS 或最新版 Chrome/Edge。');
      return;
    }
    try {
      setError(null);
      stop();
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setIsReady(true);
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      const msg =
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? '已拒绝麦克风权限，请在浏览器设置中允许后重试。'
          : name === 'NotFoundError'
            ? '未检测到可用麦克风设备。'
            : '打开麦克风失败：' + ((err as Error)?.message || '未知错误');
      setError(msg);
    }
  };

  useEffect(() => {
    return () => {
      stop();
    };
  }, []);

  return { stream, error, isReady, start, stop };
}
