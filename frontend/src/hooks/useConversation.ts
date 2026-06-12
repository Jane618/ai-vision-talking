/**
 * 对话逻辑：
 *   - 收到用户文本（+ 当前画面）后，调用 sendMultimodal
 *   - AI 返回 replyText 后：
 *       * 在原生壳里优先用 Capacitor TTS（@capacitor-community/text-to-speech）
 *       * 在浏览器里用 SpeechSynthesis
 *   - 支持：手动停止播报、出错提示、成本统计
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  base64ToAudioBlob,
  clearSessionApi,
  sendMultimodal,
  speakWithBrowserTTS,
  stopSpeaking as stopSpeakingCore,
  type MultimodalRequest,
} from '../api/client';
import { createSessionId, type CostInfo } from '../api/client';
import { getCapacitorTTS, isCapacitor } from '../platform';

interface MultimodalSettings {
  frameIntervalMs: number;
  imageQuality: number;
  imageSize: number;
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
  hasImage?: boolean;
}

interface UseConversationOptions {
  settings: MultimodalSettings;
  getCurrentFrame?: () => string | undefined;
}

interface UseConversationResult {
  sessionId: string;
  messages: ConversationMessage[];
  isSending: boolean;
  isSpeaking: boolean;
  error: string | null;
  cost: CostInfo;
  sendMessage: (userText: string, image?: string) => Promise<void>;
  clearMessages: () => void;
  resetSession: () => void;
  stopSpeaking: () => void;
}

const DEFAULT_COST: CostInfo = {
  callCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostCNY: 0,
};

function uid() { return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

/** 朗读文本：优先 Capacitor 原生 TTS，失败回退到浏览器 TTS */
async function speakText(text: string, lang = 'zh-CN'): Promise<void> {
  if (!text) return;
  if (isCapacitor()) {
    const tts = getCapacitorTTS();
    if (tts && typeof tts.speak === 'function') {
      try { await tts.speak({ text, lang, rate: 1.0, pitch: 1.0, volume: 1.0 }); return; }
      catch { /* 回退到浏览器 TTS */ }
    }
  }
  speakWithBrowserTTS(text, lang);
}

export function useConversation(options: UseConversationOptions): UseConversationResult {
  const { settings, getCurrentFrame } = options;

  const [sessionId, setSessionId] = useState<string>(() => createSessionId());
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<CostInfo>(DEFAULT_COST);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 浏览器 TTS 状态轮询（用于展示 isSpeaking）
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const iv = window.setInterval(() => {
      const speaking = window.speechSynthesis?.speaking ?? false;
      if (!speaking) setIsSpeaking((prev) => (prev ? false : prev));
    }, 500);
    return () => window.clearInterval(iv);
  }, []);

  const playAudio = useCallback(async (base64: string, mimeType?: string) => {
    try {
      const blob = base64ToAudioBlob(base64, mimeType || 'audio/wav');
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        try { URL.revokeObjectURL(audioRef.current.src); } catch { /* ignore */ }
        audioRef.current.src = url;
        await audioRef.current.play().catch(() => undefined);
      }
    } catch { /* ignore */ }
  }, []);

  const sendMessage = useCallback(
    async (userText: string, image?: string) => {
      const text = (userText || '').trim();
      if (!text) return;

      const userMsg: ConversationMessage = {
        id: uid(), role: 'user', content: text, ts: Date.now(), hasImage: !!image,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsSending(true);
      setError(null);

      try {
        const currentImage = image ?? getCurrentFrame?.();
        const response = await sendMultimodal({
          sessionId,
          userText: text,
          image: currentImage,
          settings: {
            frameIntervalMs: settings.frameIntervalMs,
            imageQuality: settings.imageQuality,
            imageSize: settings.imageSize,
          },
        } as MultimodalRequest);

        const aiReply = response.replyText || '';
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: 'assistant', content: aiReply, ts: Date.now() },
        ]);
        if (response.cost) setCost(response.cost);

        if (aiReply) {
          setIsSpeaking(true);
          if (response.audioBase64) {
            await playAudio(response.audioBase64, response.audioMimeType || undefined);
          } else {
            await speakText(aiReply);
          }
          // 兜底：若 30 秒后仍未结束，重置为 false
          window.setTimeout(() => setIsSpeaking((s) => (s ? false : s)), 30_000);
        }
      } catch (err) {
        const message = (err as Error)?.message || '请求失败';
        setError(message);
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: 'system', content: `（错误：${message}）`, ts: Date.now() },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [sessionId, settings, getCurrentFrame, playAudio],
  );

  const clearMessages = useCallback(() => { setMessages([]); setError(null); }, []);

  const stopSpeaking = useCallback(() => {
    stopSpeakingCore(audioRef.current);
    setIsSpeaking(false);
  }, []);

  const resetSession = useCallback(() => {
    const newSession = createSessionId();
    clearSessionApi(sessionId).catch(() => undefined);
    setSessionId(newSession);
    setMessages([]);
    setError(null);
    setCost(DEFAULT_COST);
  }, [sessionId]);

  return {
    sessionId, messages, isSending, isSpeaking, error, cost,
    sendMessage, clearMessages, resetSession, stopSpeaking,
  };
}
