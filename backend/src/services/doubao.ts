/**
 * 豆包多模态 API 调用封装
 * - 火山引擎 Ark API，与 OpenAI Chat Completions 格式兼容
 * - Endpoint: https://ark.cn-beijing.volces.com/api/v3/chat/completions
 * - 支持图像输入（base64 jpeg）通过 content 数组传入
 */

import fetch from 'node-fetch';
import type {
  ArkChatMessage,
  ArkUsage,
  DoubaoResponse,
  UserSettings,
} from '../types';

const ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

const DEFAULT_SYSTEM_PROMPT =
  '你是一个友善的中文 AI 助手，可以看到摄像头画面并听到用户说话。请根据看到的画面内容和用户的问题给予简洁、自然的中文回答。不要说英文。不要使用 markdown 格式。';

export function getDefaultSystemPrompt(): string {
  return DEFAULT_SYSTEM_PROMPT;
}

/**
 * 调用豆包多模态 API（流式）
 * - 通过 stream=true 调用 Ark API，解析 SSE `data: {...}` 行
 * - onDelta 每收到一块内容就回调一次
 * - 最终返回完整文本与 token 使用量
 * @param messages 消息数组，可包含 system / user / assistant
 * @param settings 可选设置（temperature, maxTokens）
 * @param onDelta 可选的流式 delta 回调
 */
export async function callDoubaoStream(
  messages: ArkChatMessage[],
  settings?: UserSettings,
  onDelta?: (delta: string) => void,
): Promise<DoubaoResponse> {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.ARK_MODEL_ENDPOINT;

  if (!apiKey || !model) {
    throw new Error(
      '未配置 ARK_API_KEY 或 ARK_MODEL_ENDPOINT，请检查 .env 文件。',
    );
  }

  const temperature =
    typeof settings?.temperature === 'number' ? settings.temperature : 0.7;
  const maxTokens =
    typeof settings?.maxTokens === 'number' ? settings.maxTokens : 512;

  const body: Record<string, any> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };

  console.log(
    `[doubao] 调用 Ark API (stream): model=${model}, messages=${messages.length}, temp=${temperature}, maxTokens=${maxTokens}`,
  );

  const resp = await fetch(ARK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const rawText = await resp.text();
    let detail: string = rawText;
    try {
      const j = JSON.parse(rawText);
      detail = j?.error?.message || JSON.stringify(j);
    } catch {
      // ignore
    }
    throw new Error(`Ark API ${resp.status}: ${detail}`);
  }

  // 解析 SSE：按行读取 "data: {...}"，最后一行是 "data: [DONE]"
  let replyText = '';
  let usage: ArkUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  let modelName = model;
  let buffer = '';

  const CHARS_PER_TOKEN = 1.8; // 估算：中文约 1.8 字 = 1 token

  // 使用标准 web streams API 的 getReader() 读取（兼容 node-fetch v3）
  if (resp.body && typeof (resp.body as any).getReader === 'function') {
    const reader = (resp.body as any).getReader();
    const decoder = new TextDecoder('utf-8');
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        parseSseBuffer();
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  } else if (resp.body) {
    // 兼容 Node.js 原生 Readable
    const nodeStream = resp.body as unknown as NodeJS.ReadableStream;
    for await (const chunk of nodeStream as any) {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      parseSseBuffer();
    }
  } else {
    // 最终兜底：一次性读取
    const data = (await resp.json()) as any;
    const text = (data?.choices?.[0]?.message?.content as string) ?? '';
    usage = data?.usage ?? usage;
    if (onDelta && text) onDelta(text);
    replyText = text;
  }

  // 处理 buffer 中剩余的最后一行（有些服务不以 [DONE] 结尾）
  parseSseBuffer(true);

  // 如果 API 仍然未返回 usage（某些模型在流式下不返回），做一次文字估算
  if (usage.total_tokens === 0 && replyText.length > 0) {
    const estimatedCompletionTokens = Math.ceil(replyText.length / CHARS_PER_TOKEN);
    usage.completion_tokens = estimatedCompletionTokens;
    // prompt_tokens 难以精准估算，按 messages 中文字长度粗略估算
    const promptChars = messages.reduce(
      (sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0),
      0,
    );
    usage.prompt_tokens = Math.ceil(promptChars / CHARS_PER_TOKEN);
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    console.log(
      `[doubao] API 未返回 usage，已按文字估算: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, total=${usage.total_tokens}`,
    );
  }

  console.log(
    `[doubao] 完成: usage.prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, total=${usage.total_tokens}, replyLen=${replyText.length}`,
  );

  return {
    replyText: replyText.trim(),
    usage,
    model: modelName,
  };

  // 内部函数：从 buffer 中提取完整的 data 行并解析
  function parseSseBuffer(flushAll?: boolean): void {
    let lineBreakPos: number;
    while ((lineBreakPos = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, lineBreakPos).replace(/\r$/, '');
      buffer = buffer.slice(lineBreakPos + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.replace(/^data:\s*/, '').trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as any;
        modelName = json.model || modelName;
        const delta = json?.choices?.[0]?.delta;
        const content: string | undefined = delta?.content;
        if (content) {
          replyText += content;
          if (onDelta) onDelta(content);
        }
        if (json?.usage) {
          usage = json.usage as ArkUsage;
        }
      } catch (e) {
        console.debug(`[doubao] SSE parse error: ${payload.substring(0, 50)}`);
      }
    }
    // flushAll=true 时处理 buffer 中最后一行（无换行符结尾）
    if (flushAll && buffer.trim().startsWith('data:')) {
      const remaining = buffer.trim();
      const payload = remaining.replace(/^data:\s*/, '').trim();
      if (payload && payload !== '[DONE]') {
        try {
          const json = JSON.parse(payload) as any;
          if (json?.usage) usage = json.usage as ArkUsage;
        } catch {}
      }
    }
  }
}

/** 非流式版本：直接调用 callDoubaoStream 但忽略 delta */
export async function callDoubao(
  messages: ArkChatMessage[],
  settings?: UserSettings,
): Promise<DoubaoResponse> {
  return callDoubaoStream(messages, settings);
}

/** 将原始 base64 图像规范化为 data:image/jpeg;base64,... 格式 */
export function normalizeImageDataUrl(image: string): string {
  if (!image) return '';
  const trimmed = image.trim();
  if (trimmed.startsWith('data:image')) return trimmed;
  return `data:image/jpeg;base64,${trimmed}`;
}
