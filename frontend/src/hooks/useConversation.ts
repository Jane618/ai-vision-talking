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
import { getCapacitorTTS, isCapacitor } from '../platform';

interface UseConversationOptions {
  settings: MultimodalSettings;
  getCurrentFrame?: () => string | undefined;
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

/**
 * 用 Capacitor 原生 TTS 朗读。失败时回退到浏览器 TTS；
 * 若浏览器 TTS 也不可用，静默返回而不影响对话流程。
 */
async function speakNativeOrFallback(text: string, lang = 'zh-CN'): Promise<void> {
  if (isCapacitor()) {
    const tts = getCapacitorTTS();
    if (tts && typeof tts.speak === 'function') {
      try {
        await tts.speak({ text, lang, rate: 1.0, pitch: 1.0 });
        return;
      } catch {
        /* 回退 */
      }
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

  // 监听浏览器 TTS speaking 状态，同步 isSpeaking
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
      if (audioRef.current && audioRef.current.src) {
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

        if (response.cost) {
          setCost({
            callCount: response.cost.callCount,
            promptTokens: response.cost.promptTokens,
            completionTokens: response.cost.completionTokens,
            totalTokens: response.cost.totalTokens,
            estimatedCostCNY: response.cost.estimatedCostCNY,
          });
        }

        if (!aiReply) {
          // nothing to speak
        } else if (isCapacitor()) {
          // 手机端：优先原生 TTS
          setIsSpeaking(true);
          await speakNativeOrFallback(aiReply);
          // 安全超时：30 秒后若仍然 speaking，自动复位
          window.setTimeout(() => {
            setIsSpeaking((s) => (s ? false : s));
          }, 30000);
        } else if (response.audioBase64) {
          await playAudio(response.audioBase64, response.audioMimeType || undefined);
        } else {
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
