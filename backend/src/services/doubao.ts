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
 * 调用豆包多模态 API
 * @param messages 消息数组，可包含 system / user / assistant，其中最新一条 user 可包含图像
 * @param settings 可选设置（temperature, maxTokens）
 */
export async function callDoubao(
  messages: ArkChatMessage[],
  settings?: UserSettings,
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

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  // 日志：打印消息长度与数量，不打印大字符串
  console.log(
    `[doubao] 调用 Ark API: model=${model}, messages=${messages.length}, temp=${temperature}, maxTokens=${maxTokens}`,
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

  const data = (await resp.json()) as any;

  const replyText: string =
    (data?.choices?.[0]?.message?.content as string) ?? '';
  const usage: ArkUsage = data?.usage ?? {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  const modelName: string = data?.model ?? model;

  console.log(
    `[doubao] 完成: usage.prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, total=${usage.total_tokens}, replyLen=${replyText.length}`,
  );

  return {
    replyText: replyText.trim(),
    usage,
    model: modelName,
  };
}

/** 将原始 base64 图像规范化为 data:image/jpeg;base64,... 格式 */
export function normalizeImageDataUrl(image: string): string {
  if (!image) return '';
  const trimmed = image.trim();
  if (trimmed.startsWith('data:image')) return trimmed;
  return `data:image/jpeg;base64,${trimmed}`;
}
