/**
 * 多模态对话的「统一入口」
 *
 * 3 种模式：
 *   1) 本地原生（默认）：配置了 VITE_ARK_API_KEY + VITE_ARK_MODEL_ENDPOINT
 *      → 直接从设备向豆包 Ark API 发请求（Capacitor HTTP 绕开 CORS）
 *   2) 远程后端：配置了 VITE_API_BASE_URL → 请求转发到自建后端
 *   3) 开发代理：VITE_API_BASE_URL 留空 → 请求 /api/*，Vite dev proxy 代理到本地后端
 */

import { callDoubaoLocal, DoubaoResponse, normalizeImageDataUrl } from './doubao';
import {
  accumulateCost,
  appendHistory,
  buildArkMessages,
  clearSession,
  getOrCreateSession,
  snapshotCost,
  type ConversationCost,
} from './conversation';

export interface MultimodalSettings {
  frameIntervalMs: number;
  imageQuality: number;
  imageSize: number;
}

export interface MultimodalRequest {
  sessionId: string;
  image?: string;
  userText: string;
  settings: MultimodalSettings;
}

export interface CostInfo {
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostCNY: number;
}

export interface MultimodalResponse {
  ok: boolean;
  replyText?: string;
  audioBase64?: string | null;
  audioMimeType?: string | null;
  sessionId: string;
  historyCount: number;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  cost?: CostInfo;
  error?: string;
}

export function createSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readEnv(key: string): string | undefined {
  if (typeof import.meta === 'undefined') return undefined;
  const v = (import.meta as any).env?.[key];
  return v == null || v === '' ? undefined : String(v);
}

function apiBaseForRemote(): string { return readEnv('VITE_API_BASE_URL') || '/api'; }

export function detectMode(): 'local' | 'remote' | 'devproxy' {
  const apiBase = readEnv('VITE_API_BASE_URL');
  const apiKey = readEnv('VITE_ARK_API_KEY');
  const modelEndpoint = readEnv('VITE_ARK_MODEL_ENDPOINT');
  if (apiBase) return 'remote';
  if (apiKey && modelEndpoint) return 'local';
  return 'local'; // 即使 .env 没配，也先尝试本地模式（用户可能在 UI 里填了 key）
}

export async function sendMultimodal(
  payload: MultimodalRequest,
  signal?: AbortSignal,
): Promise<MultimodalResponse> {
  const mode = detectMode();
  if (mode === 'local') return sendLocal(payload, signal);
  return sendRemote(payload, signal, apiBaseForRemote());
}

export async function clearSessionApi(sessionId: string): Promise<boolean> {
  const mode = detectMode();
  if (mode === 'remote') {
    try {
      const res = await fetch(`${apiBaseForRemote()}/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const json = await res.json();
      return json?.ok === true;
    } catch { return false; }
  }
  return clearSession(sessionId);
}

/** 播放后端返回的 base64 音频 */
export function base64ToAudioBlob(base64: string, mimeType = 'audio/wav'): Blob {
  let data = base64;
  if (data.includes(',')) data = data.split(',')[1];
  data = data.replace(/\s+/g, '');
  const byteChars = atob(data);
  const byteNumbers = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  return new Blob([byteNumbers], { type: mimeType });
}

/** 浏览器内置 TTS（桌面浏览器兜底） */
export function speakWithBrowserTTS(text: string, lang = 'zh-CN'): void {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 1;
    u.pitch = 1;
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

/** 统一停止播报：浏览器 TTS + <audio> + Capacitor TTS */
export function stopSpeaking(audioElement?: HTMLAudioElement | null): void {
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch { /* ignore */ }
  if (audioElement) {
    try { audioElement.pause(); audioElement.currentTime = 0; } catch { /* ignore */ }
  }
  try {
    const tts = (window as any).Capacitor?.Plugins?.TextToSpeech;
    if (tts && typeof tts.stop === 'function') tts.stop().catch(() => { /* ignore */ });
  } catch { /* ignore */ }
}

/* -------------------------- 本地模式 -------------------------- */

async function sendLocal(
  payload: MultimodalRequest,
  signal?: AbortSignal,
): Promise<MultimodalResponse> {
  const conv = getOrCreateSession(payload.sessionId);
  const imageDataUrl = payload.image ? normalizeImageDataUrl(payload.image) : undefined;

  const messages = buildArkMessages({
    conv,
    userText: payload.userText,
    imageDataUrl,
  });

  try {
    let resp: DoubaoResponse;
    if (signal && !signal.aborted) {
      resp = await Promise.race<DoubaoResponse>([
        callDoubaoLocal(messages),
        new Promise<DoubaoResponse>((_, rej) => {
          signal.addEventListener('abort', () => rej(new Error('aborted')));
        }),
      ]);
    } else {
      resp = await callDoubaoLocal(messages);
    }

    if (imageDataUrl) {
      appendHistory(conv, {
        role: 'user',
        content: [
          { type: 'text', text: payload.userText || '请描述你看到的画面。' },
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'auto' } },
        ],
        hasImage: true,
        timestamp: Date.now(),
      });
    } else {
      appendHistory(conv, {
        role: 'user',
        content: payload.userText,
        hasImage: false,
        timestamp: Date.now(),
      });
    }
    appendHistory(conv, {
      role: 'assistant',
      content: resp.replyText,
      hasImage: false,
      timestamp: Date.now(),
    });
    accumulateCost(conv, resp.usage);

    return {
      ok: true,
      replyText: resp.replyText,
      sessionId: payload.sessionId,
      historyCount: conv.history.length,
      usage: resp.usage,
      cost: mapCost(snapshotCost(conv.cost)),
    };
  } catch (err) {
    const message = (err as Error)?.message || '请求失败';
    return {
      ok: false,
      sessionId: payload.sessionId,
      historyCount: conv.history.length,
      cost: mapCost(snapshotCost(conv.cost)),
      error: message,
    };
  }
}

/* -------------------------- 远程模式 -------------------------- */

async function sendRemote(
  payload: MultimodalRequest,
  signal: AbortSignal | undefined,
  apiBase: string,
): Promise<MultimodalResponse> {
  const res = await fetch(`${apiBase}/multimodal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch { /* ignore */ }
    throw new Error(`请求失败 (${res.status}): ${detail || res.statusText}`);
  }
  const json = (await res.json()) as MultimodalResponse;
  if (!json.ok || json.error) throw new Error(json.error || '后端返回失败');
  return json;
}

function mapCost(c: ConversationCost): CostInfo {
  return {
    callCount: c.callCount,
    promptTokens: c.promptTokens,
    completionTokens: c.completionTokens,
    totalTokens: c.totalTokens,
    estimatedCostCNY: c.estimatedCostCNY,
  };
}
