/**
 * 与后端保持契约的类型定义 & 简易 HTTP 客户端。
 *
 * Web 端 / 开发态：默认使用相对路径 `/api`，由 Vite dev server 代理到 backend。
 * 手机端（Capacitor 打包后）：必须通过 `VITE_API_BASE_URL` 显式指定后端地址。
 *   例：VITE_API_BASE_URL=https://192.168.1.10:3001/api
 *
 * ⚠️ 字段必须与 backend/src/types.ts 的 MultimodalResponseBody 保持一致！
 */

// Vite 在 `import.meta.env` 上注入所有 VITE_* 变量
const ENV_BASE: string | undefined =
  typeof import.meta !== 'undefined' && (import.meta as any).env
    ? (import.meta as any).env.VITE_API_BASE_URL
    : undefined;

const API_BASE: string = ENV_BASE || '/api';

export { API_BASE };

export interface MultimodalRequest {
  sessionId: string;
  image?: string;
  userText: string;
  settings: {
    frameIntervalMs: number;
    imageQuality: number;
    imageSize: number;
    /** 可选透传字段 */
    enableTTS?: boolean;
    voiceType?: string;
    systemPrompt?: string;
  };
}

/** 对应后端 ConversationCost 字段 */
export interface CostInfo {
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 估算费用，单位：人民币元 */
  estimatedCostCNY: number;
}

/** 对应后端 MultimodalResponseBody */
export interface MultimodalResponse {
  ok: boolean;
  replyText?: string;
  audioBase64?: string | null;
  audioMimeType?: string | null;
  sessionId: string;
  historyCount: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  cost?: CostInfo;
  error?: string;
}

export interface MultimodalSettings {
  frameIntervalMs: number;
  imageQuality: number;
  imageSize: number;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
  hasImage?: boolean;
}

/** 生成一个简单的会话 ID：时间戳 + 随机串。 */
export function createSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 调用多模态接口。 */
export async function sendMultimodal(
  payload: MultimodalRequest,
  signal?: AbortSignal,
): Promise<MultimodalResponse> {
  const res = await fetch(`${API_BASE}/multimodal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`请求失败 (${res.status})：${detail || res.statusText}`);
  }

  const json = (await res.json()) as MultimodalResponse;
  if (!json.ok || json.error) {
    throw new Error(json.error || '后端返回失败');
  }
  return json;
}

/** 清除会话（非必需） */
export async function clearSessionApi(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return json?.ok === true;
  } catch {
    return false;
  }
}

/** 将 base64 字符串（可能带 data: 前缀）解码为音频 Blob。 */
export function base64ToAudioBlob(base64: string, mimeType = 'audio/wav'): Blob {
  let data = base64;
  if (data.includes(',')) {
    data = data.split(',')[1];
  }
  data = data.replace(/\s+/g, '');
  const byteChars = atob(data);
  const byteNumbers = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  return new Blob([byteNumbers], { type: mimeType });
}

/** 浏览器 TTS 回退：无需任何后端音频即可朗读文本。
 *  返回一个 Promise，朗读完成/中断/出错时 resolve，方便外部 await 统一管理状态。
 */
export function speakWithBrowserTTS(text: string, lang = 'zh-CN'): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (!('speechSynthesis' in window)) {
        resolve();
        return;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 1;
      u.pitch = 1;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    } catch {
      resolve();
    }
  });
}

/**
 * 立即停止任何正在播放的语音（浏览器 TTS / HTMLAudioElement / Capacitor TTS）。
 */
export function stopSpeaking(audioElement?: HTMLAudioElement | null): void {
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch {
    /* ignore */
  }
  if (audioElement) {
    try {
      audioElement.pause();
      audioElement.currentTime = 0;
    } catch {
      /* ignore */
    }
  }
  // Capacitor TTS 原生停止兜底
  try {
    const tts = (window as any).Capacitor?.Plugins?.TextToSpeech;
    if (tts && typeof tts.stop === 'function') {
      tts.stop().catch(() => { /* ignore */ });
    }
  } catch {
    /* ignore */
  }
}
