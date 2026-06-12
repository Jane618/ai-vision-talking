/**
 * 豆包（火山引擎 Ark）多模态 API —— 纯前端 / Capacitor 版本
 *
 * 两条调用路径：
 *   1) Capacitor 原生壳：@capacitor-community/http —— 走原生 HTTP，绕开 CORS
 *   2) 浏览器环境：fetch —— 注意 ark.cn-beijing.volces.com 的 CORS 策略
 *
 * 三处来源读取 API Key / Endpoint（按优先级）：
 *   a) sessionStorage（用户在界面上输入并保存的配置）
 *   b) import.meta.env.VITE_ARK_API_KEY / VITE_ARK_MODEL_ENDPOINT
 *   c) 调用方传入的 options.apiKey / options.modelEndpoint
 */

import { getCapacitorHttp } from '../platform';

export interface ChatMessageTextContentPart { type: 'text'; text: string; }
export interface ChatMessageImageContentPart {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
}
export type ChatMessageContentPart = ChatMessageTextContentPart | ChatMessageImageContentPart;

export interface ArkChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatMessageContentPart[];
}

export interface ArkUsage {
  prompt_tokens: number; completion_tokens: number; total_tokens: number;
}

export interface DoubaoResponse {
  replyText: string;
  usage: ArkUsage;
  model?: string;
}

const ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

const DEFAULT_SYSTEM_PROMPT =
  '你是一个友善的中文 AI 助手，可以看到摄像头画面并听到用户说话。' +
  '请根据看到的画面内容和用户的问题给予简洁、自然的中文回答。不要使用英文，不要使用 markdown 格式。';

export function getDefaultSystemPrompt(): string { return DEFAULT_SYSTEM_PROMPT; }

export function normalizeImageDataUrl(image: string): string {
  if (!image) return '';
  const trimmed = image.trim();
  if (trimmed.startsWith('data:image')) return trimmed;
  return `data:image/jpeg;base64,${trimmed}`;
}

/** 从 sessionStorage 读取用户在界面上保存的配置 */
function readFromSession(key: string): string | undefined {
  try {
    if (typeof sessionStorage === 'undefined') return undefined;
    const v = sessionStorage.getItem(key);
    return v == null || v === '' ? undefined : v;
  } catch { return undefined; }
}

function resolveApiKey(override?: string): string | undefined {
  return override ||
    readFromSession('VITE_ARK_API_KEY') ||
    (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_ARK_API_KEY : undefined);
}

function resolveEndpoint(override?: string): string | undefined {
  return override ||
    readFromSession('VITE_ARK_MODEL_ENDPOINT') ||
    (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_ARK_MODEL_ENDPOINT : undefined);
}

/**
 * 调用豆包多模态
 */
export async function callDoubaoLocal(
  messages: ArkChatMessage[],
  options?: { apiKey?: string; modelEndpoint?: string; temperature?: number; maxTokens?: number; },
): Promise<DoubaoResponse> {
  const apiKey = resolveApiKey(options?.apiKey);
  const model = resolveEndpoint(options?.modelEndpoint);

  if (!apiKey || !model) {
    throw new Error('未配置 API Key 或 Endpoint。请在界面上「⚙ 配置 API Key」，或在 .env 中设置 VITE_ARK_API_KEY 与 VITE_ARK_MODEL_ENDPOINT。');
  }

  const temperature = typeof options?.temperature === 'number' ? options.temperature : 0.7;
  const maxTokens = typeof options?.maxTokens === 'number' ? options.maxTokens : 512;

  const body = { model, messages, temperature, max_tokens: maxTokens };

  const useNative = !!getCapacitorHttp();
  let status = 0;
  let data: any = null;

  if (useNative) {
    try {
      const result = await (getCapacitorHttp() as any).request({
        method: 'POST',
        url: ARK_ENDPOINT,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        data: body,
        connectTimeout: 60_000,
        readTimeout: 60_000,
      });
      status = result.status ?? 0;
      data = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
    } catch (err: unknown) {
      const msg = (err as Error)?.message || '原生 HTTP 请求失败';
      throw new Error(msg);
    }
  } else {
    const resp = await fetch(ARK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    status = resp.status;
    const text = await resp.text();
    try { data = JSON.parse(text); } catch { data = { error: { message: text.slice(0, 500) } }; }
  }

  if (!status || status >= 400) {
    const detail = data?.error?.message || JSON.stringify(data || {}) || `HTTP ${status}`;
    throw new Error(`Ark API ${status}: ${detail}`);
  }

  const replyText: string = (data?.choices?.[0]?.message?.content as string) ?? '';
  const usage: ArkUsage = data?.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const modelName: string = data?.model ?? model;

  return { replyText: replyText.trim(), usage, model: modelName };
}
