import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 语音识别：
 * - 优先使用浏览器内置 Web Speech API (SpeechRecognition / webkitSpeechRecognition)。
 * - 如果浏览器不支持，返回 isSupported = false，供 UI 提示用户。
 * - 包含静音检测：收到 final 结果 或 停顿 > silenceMs 毫秒 触发 onSentenceEnd 回调。
 *
 * 注意：FunASR-WASM 是另一种替代方案，可以作为后续接入，
 *       本 Hook 保留 start/stop/onSentenceEnd 接口，便于替换实现。
 */

type SpeechRecognitionCtor = new () => any;

interface UseASROptions {
  lang?: string;
  silenceMs?: number;
  onSentenceEnd?: (text: string) => void;
}

interface UseASRResult {
  text: string;              // 最近一次完整识别文本（final 结果拼接）
  interimText: string;       // 实时临时文本
  isListening: boolean;
  isSupported: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useASR(options: UseASROptions = {}): UseASRResult {
  const { lang = 'zh-CN', silenceMs = 1200, onSentenceEnd } = options;

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const onSentenceEndRef = useRef(onSentenceEnd);
  const manualStopRef = useRef(false);
  const finalBufferRef = useRef<string>('');

  const [text, setText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const Ctor = getSpeechRecognition();
  const isSupported = !!Ctor;

  useEffect(() => {
    onSentenceEndRef.current = onSentenceEnd;
  }, [onSentenceEnd]);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const armSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      // 到达静音阈值：把当前 interim 视为一次完整输入
      const finalText = (finalBufferRef.current + ' ' + interimTextRef.current).trim();
      if (finalText) {
        finalBufferRef.current = '';
        setText(finalText);
        onSentenceEndRef.current?.(finalText);
      }
    }, silenceMs);
  }, [silenceMs]);

  // interimTextRef 便于在闭包里拿到最新值
  const interimTextRef = useRef('');
  useEffect(() => {
    interimTextRef.current = interimText;
  }, [interimText]);

  const start = useCallback(() => {
    if (!Ctor) {
      setError('当前浏览器不支持语音识别，请使用最新版 Chrome/Edge，或手动输入文本。');
      return;
    }
    if (recognitionRef.current && isListening) {
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
      if (finalChunk) {
        finalBufferRef.current = (finalBufferRef.current + ' ' + finalChunk).trim();
        // 得到 final：刷新静音计时
        armSilenceTimer();
      } else if (interim) {
        // interim 到达时重置计时
        armSilenceTimer();
      }
    };

    recognition.onerror = (ev: any) => {
      // no-speech / audio-capture 等常见错误可以忽略
      if (ev?.error === 'no-speech' || ev?.error === 'aborted') return;
      setError('语音识别错误：' + (ev?.error || '未知'));
    };

    recognition.onend = () => {
      // 如果不是手动 stop 手动停止，则自动重启，维持 continuous
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
      recognitionRef.current = recognition;
      setIsListening(true);
      setError(null);
      armSilenceTimer();
    } catch (err: unknown) {
      setError('启动语音识别失败：' + ((err as Error)?.message || '未知错误'));
    }
  }, [Ctor, isListening, lang, armSilenceTimer]);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    clearSilenceTimer();
    try {
      recognitionRef.current?.stop?.();
    } catch {
        /* ignore */
      }
    setIsListening(false);
  }, []);

  const reset = useCallback(() => {
    setText('');
    setInterimText('');
    finalBufferRef.current = '';
  }, []);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return { text, interimText, isListening, isSupported, error, start, stop, reset };
}
