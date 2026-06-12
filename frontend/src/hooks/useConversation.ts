import { useCallback, useEffect, useRef, useState } from 'react';
import {
  base64ToAudioBlob,
  clearSessionApi,
  ConversationMessage,
  CostInfo,
  createSessionId,
  MultimodalSettings,
  sendMultimodal,
  speakWithBrowserTTS,
  stopSpeaking as stopSpeakingCore,
} from '../api/client';

interface UseConversationOptions {
  settings: MultimodalSettings;
  getCurrentFrame?: () => string | undefined; // 返回当前 base64 缩略帧
  onFrameCaptured?: (base64: string) => void;
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
  callCount: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  estimatedCostCNY: 0,
};

function uid() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
  useEffect(() => {
    if (typeof window !== 'undefined' && !audioRef.current) {
      const a = new Audio();
      audioRef.current = a;
      // 监听播放状态，同步 isSpeaking
      a.addEventListener('play', () => setIsSpeaking(true));
      a.addEventListener('ended', () => setIsSpeaking(false));
      a.addEventListener('pause', () => setIsSpeaking(false));
      a.addEventListener('error', () => setIsSpeaking(false));
    }
    return () => {
      if (audioRef.current) {
        audioRef.current.removeEventListener('play', () => setIsSpeaking(true));
        audioRef.current.removeEventListener('ended', () => setIsSpeaking(false));
        audioRef.current.removeEventListener('pause', () => setIsSpeaking(false));
        audioRef.current.removeEventListener('error', () => setIsSpeaking(false));
      }
    };
  }, []);

  // 监听浏览器 TTS 的 speaking 状态，同步到 isSpeaking
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const interval = window.setInterval(() => {
      const ttsSpeaking = window.speechSynthesis?.speaking ?? false;
      setIsSpeaking((prev) => prev || ttsSpeaking);
    }, 300);
    return () => window.clearInterval(interval);
  }, []);

  const playAudio = useCallback(async (base64: string, mimeType?: string) => {
    try {
      const blob = base64ToAudioBlob(base64, mimeType || 'audio/wav');
      const url = URL.createObjectURL(blob);
      if (audioRef.current && audioRef.current.src && audioRef.current.src !== '') {
        try {
          URL.revokeObjectURL(audioRef.current.src);
        } catch {
          /* ignore */
        }
      }
      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play().catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const sendMessage = useCallback(
    async (userText: string, image?: string) => {
      const text = (userText || '').trim();
      if (!text) return;
      const userMsg: ConversationMessage = {
        id: uid(),
        role: 'user',
        content: text,
        ts: Date.now(),
        hasImage: !!image,
      };
      setMessages((prev) => [...prev, userMsg]);

      setIsSending(true);
      setError(null);
      try {
        // 如果调用方未传入 image，允许从 getCurrentFrame 回调获取
        const currentImage = image ?? getCurrentFrame?.();

        const response = await sendMultimodal({
          sessionId,
          userText: text,
          image: currentImage,
          settings: {
            frameIntervalMs: settings.frameIntervalMs,
            imageQuality: settings.imageQuality,
            imageSize: settings.imageSize,
            enableTTS: true,
          },
        });

        const aiReply = response.replyText || '';
        const aiMsg: ConversationMessage = {
          id: uid(),
          role: 'assistant',
          content: aiReply,
          ts: Date.now(),
        };
        setMessages((prev) => [...prev, aiMsg]);

        // 更新成本统计（从后端返回的 cost 字段读取）
        if (response.cost) {
          setCost({
            callCount: response.cost.callCount,
            promptTokens: response.cost.promptTokens,
            completionTokens: response.cost.completionTokens,
            totalTokens: response.cost.totalTokens,
            estimatedCostCNY: response.cost.estimatedCostCNY,
          });
        }

        // 播放 TTS：优先后端返回的 base64 音频，否则用浏览器内置 TTS
        if (response.audioBase64 && aiReply) {
          await playAudio(response.audioBase64, response.audioMimeType || undefined);
        } else if (aiReply) {
          speakWithBrowserTTS(aiReply);
        }
      } catch (err) {
        const message = (err as Error)?.message || '请求失败';
        setError(message);
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'system',
            content: '（错误：' + message + '）',
            ts: Date.now(),
          },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [sessionId, settings, getCurrentFrame, playAudio],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

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
    sessionId,
    messages,
    isSending,
    isSpeaking,
    error,
    cost,
    sendMessage,
    clearMessages,
    resetSession,
    stopSpeaking,
  };
}
