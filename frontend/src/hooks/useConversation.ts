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
 * 用 Capacitor 原生 TTS 朗读，返回 Promise。
 * 失败或没有原生 TTS 时回退到浏览器 TTS。
 * 无论哪条路径，都会在播报完成后 resolve。
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
  await speakWithBrowserTTS(text, lang);
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
  // 记录当前播放的 onended 处理器，便于在组件卸载前清理
  const audioEndHandlerRef = useRef<(() => void) | null>(null);

  // 组件挂载：创建 <audio> 元素用于播放后端返回的 base64 音频
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;
    return () => {
      // 卸载时清理：停止任何正在播放的内容
      try {
        audio.pause();
        audio.src = '';
      } catch {
        /* ignore */
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
      }
      setIsSpeaking(false);
    };
  }, []);

  /**
   * 播放 base64 音频（来自后端的 TTS 产物）。
   * 调用方会在调用前 setIsSpeaking(true)；本函数在 ended/error 事件后 resolve。
   */
  const playAudio = useCallback(async (base64: string, mimeType?: string): Promise<void> => {
    return new Promise((resolve) => {
      try {
        const blob = base64ToAudioBlob(base64, mimeType || 'audio/wav');
        const url = URL.createObjectURL(blob);
        const audio = audioRef.current;
        if (!audio) {
          resolve();
          return;
        }
        // 清理上一次的旧监听
        if (audioEndHandlerRef.current) {
          audio.removeEventListener('ended', audioEndHandlerRef.current);
          audio.removeEventListener('error', audioEndHandlerRef.current);
        }
        const onDone = () => {
          try {
            URL.revokeObjectURL(url);
          } catch {
            /* ignore */
          }
          audio.removeEventListener('ended', onDone);
          audio.removeEventListener('error', onDone);
          if (audioEndHandlerRef.current === onDone) {
            audioEndHandlerRef.current = null;
          }
          resolve();
        };
        audioEndHandlerRef.current = onDone;
        audio.addEventListener('ended', onDone, { once: true });
        audio.addEventListener('error', onDone, { once: true });
        audio.src = url;
        audio.play().catch(() => {
          // 自动播放被拦截，直接视为完成
          onDone();
        });
      } catch {
        resolve();
      }
    });
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
        // 收到 AI 回复后立即结束"正在思考"状态（与音频播报解耦）
        setIsSending(false);

        if (response.cost) {
          setCost({
            callCount: response.cost.callCount,
            promptTokens: response.cost.promptTokens,
            completionTokens: response.cost.completionTokens,
            totalTokens: response.cost.totalTokens,
            estimatedCostCNY: response.cost.estimatedCostCNY,
          });
        }

        // 播报逻辑：统一 before-setIsSpeaking(true) / after-setIsSpeaking(false)
        if (aiReply) {
          setIsSpeaking(true);
          try {
            if (isCapacitor()) {
              await speakNativeOrFallback(aiReply);
            } else if (response.audioBase64) {
              await playAudio(response.audioBase64, response.audioMimeType || undefined);
            } else {
              await speakWithBrowserTTS(aiReply);
            }
          } finally {
            // 无论正常完成还是抛错，都重置状态
            setIsSpeaking(false);
          }
        }
      } catch (err) {
        const message = (err as Error)?.message || '请求失败';
        setError(message);
        setIsSending(false); // 出错时也结束"正在思考"状态
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
        // 注意：isSending 已在上面两个分支提前 reset，这里不再重复设置
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
