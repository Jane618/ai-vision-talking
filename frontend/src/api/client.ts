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
  image?: string | Blob;  // 支持 base64 字符串或二进制 Blob
  userText: string;
  settings: {
    frameIntervalMs: number;
    imageQuality: number;
    imageSize: number;
    /** 可选透传字段 */
    enableTTS?: boolean;
    voiceType?: string;
    systemPrompt?: string;
    /** 🆕 是否启用对话摘要（默认 true） */
    enableSummary?: boolean;
    /** 🆕 触发摘要的累计 tokens 阈值（默认 8192） */
    summaryThresholdTokens?: number;
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
  /** 🆕 累计节省的 tokens */
  savedTokens?: number;
}

/** 🆕 摘要结果（后端若触发了摘要会返回此字段） */
export interface SummaryInfo {
  summary: string;
  replacedMessages: number;
  savedTokens: number;
  summaryTokens: number;
  estimatedSavedCNY: number;
}

/** 🆕 本次 API 请求的 tokens 拆解 */
export interface TokenBreakdownInfo {
  systemPromptTokens: number;
  historyTokens: number;
  currentUserTokens: number;
  imageTokens: number;
  totalEstimated: number;
  actualPromptTokens: number;
  actualCompletionTokens: number;
  actualTotalTokens: number;
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
  /** 🆕 若本次调用触发了摘要，返回此字段 */
  summaryApplied?: SummaryInfo;
  /** 🆕 本次 API 请求的 tokens 拆解 */
  tokenBreakdown?: TokenBreakdownInfo;
  error?: string;
}

export interface MultimodalSettings {
  frameIntervalMs: number;
  imageQuality: number;
  imageSize: number;
  adaptiveImageQuality?: boolean;
  imageQualityMin?: number;
  /** 预算/质量模式：省钱、均衡、高清识别 */
  qualityMode?: 'budget' | 'balanced' | 'quality';
  /** 当前场景预设 ID，用于前端高亮与后续扩展 */
  scenePresetId?: string;
  /** 场景预设或用户自定义的系统提示词 */
  systemPrompt?: string;
  /** 🆕 是否启用对话摘要（默认 true） */
  enableSummary?: boolean;
  /** 🆕 触发摘要的累计 tokens 阈值（默认 8192） */
  summaryThresholdTokens?: number;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
  hasImage?: boolean;
  /** 🆕 用户消息附带的缩略图（base64 data URL），用于点击放大查看 */
  image?: string;
  /** 🆕 本条消息消耗/估算的 tokens（AI 为真实值，用户为估算） */
  tokens?: number;
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

export interface MultimodalStreamHandlers {
  onSummary?: (summary: SummaryInfo) => void;
  onDelta?: (text: string) => void;
  onDone?: (response: MultimodalResponse) => void;
  onError?: (message: string) => void;
}

/** 调用多模态流式接口：实时接收 AI 文本片段，结束后返回完整元数据。 */
export async function sendMultimodalStream(
  payload: MultimodalRequest,
  handlers: MultimodalStreamHandlers,
  signal?: AbortSignal,
): Promise<MultimodalResponse> {
  const res = await fetch(`${API_BASE}/multimodal/stream`, {
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
  if (!res.body) {
    throw new Error('当前浏览器不支持读取流式响应。');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const finalResponseRef: { current?: MultimodalResponse } = {};

  const handleBlock = (block: string) => {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const eventLine = lines.find((line) => line.startsWith('event:'));
    const eventName = eventLine ? eventLine.slice(6).trim() : 'message';
    const dataText = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!dataText) return;

    const data = JSON.parse(dataText);
    if (eventName === 'summary') {
      handlers.onSummary?.(data as SummaryInfo);
    } else if (eventName === 'delta') {
      const text = typeof data?.text === 'string' ? data.text : '';
      if (text) handlers.onDelta?.(text);
    } else if (eventName === 'done') {
      finalResponseRef.current = data as MultimodalResponse;
      handlers.onDone?.(finalResponseRef.current);
    } else if (eventName === 'error') {
      const message = data?.error || '流式响应失败';
      handlers.onError?.(message);
      throw new Error(message);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let sepIndex = buffer.indexOf('\n\n');
    while (sepIndex >= 0) {
      const block = buffer.slice(0, sepIndex).trim();
      buffer = buffer.slice(sepIndex + 2);
      if (block) handleBlock(block);
      sepIndex = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) handleBlock(tail);

  const finalResponse = finalResponseRef.current;
  if (!finalResponse) {
    throw new Error('流式响应结束但未收到完成事件。');
  }
  if (!finalResponse.ok || finalResponse.error) {
    throw new Error(finalResponse.error || '后端返回失败');
  }
  return finalResponse;
}

export interface SessionSummary {
  session_uuid: string;
  title: string | null;
  scene_preset: string | null;
  summary: string | null;
  message_count: number;
  total_cost_cny: string;
  updated_at: string;
}

export interface SessionDetail {
  conversation: Record<string, unknown>;
  messages: Array<{
    id: number;
    role: string;
    content: string | unknown[];
    content_text: string | null;
    has_image: boolean;
    seq: number;
    created_at: string;
  }>;
  costStats: {
    call_count: number;
    total_prompt: number;
    total_completion: number;
    total_tokens: number;
    total_cost: string;
  };
}

export interface ResumeResult {
  ok: boolean;
  sessionId: string;
  historyCount: number;
  cost?: CostInfo;
  error?: string;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await fetch(`${API_BASE}/conversations`);
  if (!res.ok) throw new Error(`请求失败 (${res.status})`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.conversations || [];
}

export async function getSessionMessages(sessionUuid: string): Promise<SessionDetail | null> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(sessionUuid)}`);
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.ok) return null;
  return json as SessionDetail;
}

export async function resumeSession(sessionUuid: string): Promise<ResumeResult> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(sessionUuid)}/resume`, {
    method: 'POST',
  });
  const json = await res.json();
  return json as ResumeResult;
}

/**
 * 发送多模态请求（支持二进制图片上传）。
 * 当 image 为 Blob 时使用 multipart/form-data，否则保持 JSON。
 */
export async function sendMultimodalStreamWithBlob(
  payload: MultimodalRequest,
  handlers: MultimodalStreamHandlers,
  signal?: AbortSignal,
): Promise<MultimodalResponse> {
  const hasBlobImage = payload.image instanceof Blob;

  let body: BodyInit;
  let contentType: string;

  if (hasBlobImage) {
    const formData = new FormData();
    formData.append('sessionId', payload.sessionId);
    formData.append('userText', payload.userText);
    formData.append('settings', JSON.stringify(payload.settings));
    formData.append('image', payload.image as Blob, 'frame.jpg');
    body = formData;
    contentType = 'multipart/form-data';
  } else {
    body = JSON.stringify(payload);
    contentType = 'application/json';
  }

  const res = await fetch(`${API_BASE}/multimodal/stream`, {
    method: 'POST',
    headers: hasBlobImage ? {} : { 'Content-Type': contentType },
    body,
    signal,
  });

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch { /* ignore */ }
    throw new Error(`请求失败 (${res.status})：${detail || res.statusText}`);
  }
  if (!res.body) {
    throw new Error('当前浏览器不支持读取流式响应。');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const finalResponseRef: { current?: MultimodalResponse } = {};

  const handleBlock = (block: string) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const eventLine = lines.find((l) => l.startsWith('event:'));
    const eventName = eventLine ? eventLine.slice(6).trim() : 'message';
    const dataText = lines
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (!dataText) return;

    const data = JSON.parse(dataText);
    if (eventName === 'summary') {
      handlers.onSummary?.(data as SummaryInfo);
    } else if (eventName === 'delta') {
      const text = typeof data?.text === 'string' ? data.text : '';
      if (text) handlers.onDelta?.(text);
    } else if (eventName === 'done') {
      finalResponseRef.current = data as MultimodalResponse;
      handlers.onDone?.(finalResponseRef.current);
    } else if (eventName === 'error') {
      const message = data?.error || '流式响应失败';
      handlers.onError?.(message);
      throw new Error(message);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let sepIndex = buffer.indexOf('\n\n');
    while (sepIndex >= 0) {
      const block = buffer.slice(0, sepIndex).trim();
      buffer = buffer.slice(sepIndex + 2);
      if (block) handleBlock(block);
      sepIndex = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) handleBlock(tail);

  const finalResponse = finalResponseRef.current;
  if (!finalResponse) {
    throw new Error('流式响应结束但未收到完成事件。');
  }
  if (!finalResponse.ok || finalResponse.error) {
    throw new Error(finalResponse.error || '后端返回失败');
  }
  return finalResponse;
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
