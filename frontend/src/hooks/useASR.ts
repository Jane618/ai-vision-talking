/**
 * 语音识别 —— 双路径
 *   - Capacitor 原生壳：@capacitor-community/speech-recognition（更稳定、零延迟）
 *   - 浏览器环境：Web Speech API（SpeechRecognition / webkitSpeechRecognition）
 *
 * 静音检测：收到文本后，若 silenceMs 毫秒内没有新文本，视为一句话结束。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCapacitorASR, isCapacitor } from '../platform';

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

type SpeechRecognitionCtor = new () => any;

function getBrowserSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** 检测当前环境是否支持任何一种语音识别 */
export function hasSpeechRecognition(): boolean {
  if (isCapacitor() && getCapacitorASR()) return true;
  return !!getBrowserSpeechRecognition();
}

export function useASR(options: UseASROptions = {}): UseASRResult {
  const { lang = 'zh-CN', silenceMs = 1200, onSentenceEnd } = options;

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const onSentenceEndRef = useRef(onSentenceEnd);
  const manualStopRef = useRef(false);
  const finalBufferRef = useRef<string>('');
  const interimTextRef = useRef<string>('');

  const [text, setText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useNative = isCapacitor() && !!getCapacitorASR();
  const BrowserCtor = getBrowserSpeechRecognition();
  const isSupported = useNative || !!BrowserCtor;

  useEffect(() => { onSentenceEndRef.current = onSentenceEnd; }, [onSentenceEnd]);
  useEffect(() => { interimTextRef.current = interimText; }, [interimText]);

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
        onSentenceEndRef.current?.(finalText);
      }
    }, silenceMs);
  }, [silenceMs]);

  /* ---------- 原生 ASR ---------- */
  const startNative = useCallback(async () => {
    const asr = getCapacitorASR();
    if (!asr) { setError('原生语音识别不可用'); return; }
    try {
      manualStopRef.current = false;
      const available = await asr.available().catch(() => ({ available: true }));
      if (available && available.available === false) {
        setError('当前设备不支持原生语音识别');
        return;
      }
      try { await asr.requestPermissions(); } catch { /* 权限可能已经授予 */ }

      // 注册监听器
      if (asr.addListener) {
        recognitionRef.current = await asr.addListener('partialResults', (data: any) => {
          const matches = data.matches || [];
          if (matches.length > 0) {
            const partial = matches[0];
            setInterimText(partial);
            armSilenceTimer();
          }
        });
        // 监听 final 结果
        if (asr.addListener) {
          try { await asr.addListener('listeningResult', (data: any) => { /* ignore */ }); } catch { /* ignore */ }
        }
      }

      await asr.start({
        language: lang,
        partialResults: true,
        maxResults: 1,
      });
      setIsListening(true);
      setError(null);
      armSilenceTimer();
    } catch (err: unknown) {
      setError('原生语音识别启动失败：' + ((err as Error)?.message || '未知错误'));
      setIsListening(false);
    }
  }, [lang, armSilenceTimer]);

  const stopNative = useCallback(() => {
    manualStopRef.current = true;
    clearSilenceTimer();
    const asr = getCapacitorASR();
    if (asr && typeof asr.stop === 'function') {
      try { asr.stop(); } catch { /* ignore */ }
    }
    setIsListening(false);
  }, []);

  /* ---------- 浏览器 ASR ---------- */
  const startBrowser = useCallback(() => {
    const Ctor = getBrowserSpeechRecognition();
    if (!Ctor) { setError('当前浏览器不支持语音识别，请使用最新版 Chrome/Edge。'); return; }
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
          if (res.isFinal) finalChunk += transcript;
          else interim += transcript;
        }
        setInterimText(interim);
        if (finalChunk) {
          finalBufferRef.current = (finalBufferRef.current + ' ' + finalChunk).trim();
          armSilenceTimer();
        } else if (interim) {
          armSilenceTimer();
        }
      };

      recognition.onerror = (ev: any) => {
        if (ev?.error === 'no-speech' || ev?.error === 'aborted') return;
        setError('语音识别错误：' + (ev?.error || '未知'));
      };

      recognition.onend = () => {
        if (!manualStopRef.current) {
          try { recognition.start(); } catch { setIsListening(false); }
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
  }, [lang, armSilenceTimer]);

  const stopBrowser = useCallback(() => {
    manualStopRef.current = true;
    clearSilenceTimer();
    try { recognitionRef.current?.stop?.(); } catch { /* ignore */ }
    setIsListening(false);
  }, []);

  /* ---------- 统一接口 ---------- */
  const start = useCallback(() => {
    if (isListening) return;
    if (useNative) startNative();
    else startBrowser();
  }, [isListening, useNative, startNative, startBrowser]);

  const stop = useCallback(() => {
    if (useNative) stopNative();
    else stopBrowser();
  }, [useNative, stopNative, stopBrowser]);

  const reset = useCallback(() => {
    setText('');
    setInterimText('');
    finalBufferRef.current = '';
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { text, interimText, isListening, isSupported, error, start, stop, reset };
}
