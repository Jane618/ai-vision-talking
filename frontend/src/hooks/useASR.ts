import { useCallback, useEffect, useRef, useState } from 'react';
import { getCapacitorASR, isCapacitor } from '../platform';

/**
 * 语音识别（ASR）。
 *
 * 两条路径：
 * 1) Capacitor 原生：`@capacitor-community/speech-recognition`
 *    - 自动请求麦克风权限
 *    - iOS 端走系统 Speech 框架；Android 走 Google Recognition Service
 * 2) Web Speech API：桌面浏览器 / 移动端浏览器兜底
 *
 * 两条路径共享同一套静音检测与回调契约。
 */

type SpeechRecognitionCtor = new () => any;

interface UseASROptions {
  lang?: string;
  silenceMs?: number;
  onSentenceEnd?: (text: string) => void;
}

interface UseASRResult {
  text: string;
  interimText: string;
  isListening: boolean;
  isSupported: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

// -------- Web Speech API --------

function getWebSpeech(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

// -------- Capacitor Native ASR --------

type CapListenerRemover = { remove: () => Promise<void> };

interface CapASR {
  start: (opts?: {
    language?: string;
    partialResults?: boolean;
    maxResults?: number;
  }) => Promise<void>;
  stop: () => Promise<void>;
  addListener: (
    event: 'partialResults' | 'results' | 'listeningState' | string,
    handler: (ev: any) => void,
  ) => Promise<CapListenerRemover> | CapListenerRemover;
  checkPermissions?: () => Promise<{ speechRecognition: 'granted' | 'denied' | 'prompt' }>;
  requestPermissions?: () => Promise<{ speechRecognition: 'granted' | 'denied' | 'prompt' }>;
}

export function useASR(options: UseASROptions = {}): UseASRResult {
  const { lang = 'zh-CN', silenceMs = 1200, onSentenceEnd } = options;

  // 通用状态
  const silenceTimerRef = useRef<number | null>(null);
  const onSentenceEndRef = useRef(onSentenceEnd);
  const manualStopRef = useRef(false);
  const finalBufferRef = useRef<string>('');
  const interimTextRef = useRef('');

  const [text, setText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Web Speech 引用
  const webRecognitionRef = useRef<any>(null);

  // Capacitor 引用
  const capacitorListenersRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    onSentenceEndRef.current = onSentenceEnd;
  }, [onSentenceEnd]);

  useEffect(() => {
    interimTextRef.current = interimText;
  }, [interimText]);

  // isSupported: 任一实现可用即可
  const isSupported = isCapacitor()
    ? !!getCapacitorASR()
    : !!getWebSpeech();

  // ---- 工具函数 ----
  const clearSilenceTimer = () => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const armSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      const finalText = (finalBufferRef.current + ' ' + interimTextRef.current).trim();
      if (finalText) {
        finalBufferRef.current = '';
        setText(finalText);
        setInterimText('');
        onSentenceEndRef.current?.(finalText);
      }
    }, silenceMs);
  }, [silenceMs]);

  const appendFinalChunk = useCallback(
    (chunk: string) => {
      if (!chunk) return;
      finalBufferRef.current = (finalBufferRef.current + ' ' + chunk).trim();
      armSilenceTimer();
    },
    [armSilenceTimer],
  );

  // ---- Web Speech 启动 ----
  const startWebASR = useCallback(() => {
    const Ctor = getWebSpeech();
    if (!Ctor) {
      setError('当前浏览器不支持语音识别。');
      return;
    }
    try {
      manualStopRef.current = false;
      const recognition = new Ctor();
      recognition.lang = lang;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        let interim = '';
        let finalChunk = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const transcript: string = res[0]?.transcript ?? '';
          if (res.isFinal) {
            finalChunk += transcript;
          } else {
            interim += transcript;
          }
        }
        setInterimText(interim);
        if (interim) armSilenceTimer();
        if (finalChunk) appendFinalChunk(finalChunk);
      };

      recognition.onerror = (ev: any) => {
        if (ev?.error === 'no-speech' || ev?.error === 'aborted') return;
        setError('语音识别错误：' + (ev?.error || '未知'));
      };

      recognition.onend = () => {
        if (!manualStopRef.current) {
          try {
            recognition.start();
          } catch {
            setIsListening(false);
          }
        } else {
          setIsListening(false);
        }
      };

      recognition.start();
      webRecognitionRef.current = recognition;
      setIsListening(true);
      setError(null);
      armSilenceTimer();
    } catch (err: unknown) {
      setError('启动语音识别失败：' + ((err as Error)?.message || '未知错误'));
    }
  }, [lang, armSilenceTimer, appendFinalChunk]);

  // ---- Capacitor 原生启动 ----
  const cleanupCapListeners = () => {
    capacitorListenersRef.current.forEach((rm) => {
      try {
        Promise.resolve(rm());
      } catch {
        /* ignore */
      }
    });
    capacitorListenersRef.current = [];
  };

  const startCapacitorASR = useCallback(async () => {
    const plugin = getCapacitorASR() as CapASR | null;
    if (!plugin) {
      setError('原生语音识别插件不可用。');
      return;
    }
    try {
      manualStopRef.current = false;

      // 1) 权限检查
      if (plugin.checkPermissions) {
        const perm = await plugin.checkPermissions();
        if (perm?.speechRecognition !== 'granted' && plugin.requestPermissions) {
          const r = await plugin.requestPermissions();
          if (r?.speechRecognition !== 'granted') {
            setError('未获得麦克风权限。');
            return;
          }
        }
      }

      // 2) 清理旧的监听 & 旧会话
      cleanupCapListeners();
      try {
        await plugin.stop();
      } catch {
        /* ignore */
      }

      // 3) 注册事件监听
      if (plugin.addListener) {
        // partialResults: 实时文本
        try {
          const h = await plugin.addListener('partialResults', (ev: any) => {
            const matches: string[] = ev?.matches || [];
            const first = matches[0] || '';
            setInterimText(first);
            armSilenceTimer();
          });
          capacitorListenersRef.current.push(() => h.remove());
        } catch {
          /* ignore */
        }

        // results: 最终识别文本（部分平台实现）
        try {
          const h = await plugin.addListener('results', (ev: any) => {
            const matches: string[] = ev?.matches || [];
            const first = matches[0] || '';
            if (first) appendFinalChunk(first);
          });
          capacitorListenersRef.current.push(() => h.remove());
        } catch {
          /* ignore */
        }

        // listeningState: 同步 isListening
        try {
          const h = await plugin.addListener('listeningState', (ev: any) => {
            if (ev?.status === 'stopped' && manualStopRef.current) {
              setIsListening(false);
            }
          });
          capacitorListenersRef.current.push(() => h.remove());
        } catch {
          /* ignore */
        }
      }

      // 4) 启动识别
      await plugin.start({
        language: lang,
        partialResults: true,
        maxResults: 1,
      });

      setIsListening(true);
      setError(null);
      armSilenceTimer();
    } catch (err: unknown) {
      setError('原生语音识别启动失败：' + ((err as Error)?.message || '未知错误'));
      // 失败时回退到 Web Speech
      startWebASR();
    }
  }, [lang, armSilenceTimer, appendFinalChunk, startWebASR]);

  // ---- 对外接口 ----
  const start = useCallback(() => {
    if (!isSupported) {
      setError('当前环境不支持语音识别。');
      return;
    }
    if (isListening) return;
    if (isCapacitor()) {
      void startCapacitorASR();
    } else {
      startWebASR();
    }
  }, [isSupported, isListening, startCapacitorASR, startWebASR]);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    clearSilenceTimer();

    try {
      webRecognitionRef.current?.stop?.();
    } catch {
      /* ignore */
    }

    const plugin = getCapacitorASR() as CapASR | null;
    if (plugin) {
      plugin.stop().catch(() => { /* ignore */ });
    }

    cleanupCapListeners();
    setIsListening(false);
  }, []);

  const reset = useCallback(() => {
    setText('');
    setInterimText('');
    finalBufferRef.current = '';
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return { text, interimText, isListening, isSupported, error, start, stop, reset };
}
