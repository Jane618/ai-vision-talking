/**
 * 会话管理
 * - 内存 Map<sessionId, Conversation> 存储会话
 * - 对话历史压缩：超过 8 轮消息后自动保留 system prompt + 最近 6 轮
 * - 🆕 智能摘要：当累计 tokens 超过用户设定的阈值时，调用豆包模型自动做摘要，压缩
 * - 10 分钟无活动自动清理（定时清理）
 * - 成本追踪：累计调用次数、token 数、估算费用（粗略参考单价）
 */

import type {
  ArkChatMessage,
  ArkUsage,
  Conversation,
  ConversationCost,
  HistoryMessage,
  SummaryApplied,
  TokenBreakdown,
  UserSettings,
} from '../types';
import { callDoubao, getDefaultSystemPrompt } from './doubao';

/** 超过该数量的消息（对 user+assistant 为一轮）触发简单压缩 */
const COMPRESS_AFTER_TURNS = 8;
/** 简单压缩后保留的最近轮数 */
const KEEP_RECENT_TURNS = 6;
/** 触发智能摘要的默认 tokens 阈值 */
const DEFAULT_SUMMARY_THRESHOLD_TOKENS = 8192;
/** 摘要后保留的最近原始消息数（保持 4 轮 = 8 条消息） */
const KEEP_RECENT_MESSAGES_AFTER_SUMMARY = 8;
/** 摘要最小消息数阈值（太少消息不够做摘要） */
const MIN_MESSAGES_FOR_SUMMARY = 6;
/** 摘要的最小时间间隔（毫秒），避免同一用户被反复摘要 */
const SUMMARY_MIN_INTERVAL_MS = 60 * 1000;
/** 会话空闲时间（毫秒），超过后自动清理 */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** 清理定时器间隔 */
const CLEANUP_INTERVAL_MS = 60 * 1000;

/** 粗略参考单价（元 / 1K tokens），仅供参考，实际以火山引擎计费为准 */
const PROMPT_COST_CNY_PER_1K = 0.003;
const COMPLETION_COST_CNY_PER_1K = 0.006;

/** 1 token ≈ 1.8 个中文字符（粗略估算） */
const CHARS_PER_TOKEN = 1.8;

const sessions = new Map<string, Conversation>();

/** 启动定时清理任务（进程内只启动一次） */
let cleanupStarted = false;
function ensureCleanupTimer(): void {
  if (cleanupStarted) return;
  cleanupStarted = true;
  setInterval(() => {
    const now = Date.now();
    let removed = 0;
    for (const [sid, conv] of sessions.entries()) {
      if (now - conv.lastActiveAt > IDLE_TIMEOUT_MS) {
        sessions.delete(sid);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(
        `[conversation] 清理了 ${removed} 个空闲会话，当前会话数: ${sessions.size}`,
      );
    }
  }, CLEANUP_INTERVAL_MS);
}

/** 获取或创建一个会话 */
export function getOrCreateSession(sessionId: string): Conversation {
  ensureCleanupTimer();
  let conv = sessions.get(sessionId);
  if (!conv) {
    conv = {
      sessionId,
      history: [],
      cost: {
        callCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostCNY: 0,
        savedTokens: 0,
      },
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    sessions.set(sessionId, conv);
    console.log(`[conversation] 新建会话 ${sessionId}`);
  } else {
    conv.lastActiveAt = Date.now();
  }
  return conv;
}

/** 获取会话（不存在则返回 undefined） */
export function getSession(sessionId: string): Conversation | undefined {
  return sessions.get(sessionId);
}

/** 清除指定会话 */
export function clearSession(sessionId: string): boolean {
  const existed = sessions.has(sessionId);
  if (existed) {
    sessions.delete(sessionId);
    console.log(`[conversation] 清除会话 ${sessionId}`);
  }
  return existed;
}

/** 统计当前会话数量 */
export function getSessionCount(): number {
  return sessions.size;
}

/**
 * 估算一段内容的近似 token 数（不调用外部服务，纯启发式）
 */
function estimateTokens(content: HistoryMessage['content']): number {
  if (typeof content === 'string') {
    return Math.ceil(content.length / CHARS_PER_TOKEN);
  }
  // content 是多模态数组，只对其中的文本部分估算，忽略图像 token
  let textLen = 0;
  for (const part of content) {
    if (part.type === 'text') {
      textLen += part.text?.length ?? 0;
    } else if (part.type === 'image_url') {
      // 粗略估算：图像 token 成本通常远高于文本，给一个粗略值
      textLen += 200;
    }
  }
  return Math.ceil(textLen / CHARS_PER_TOKEN);
}

/**
 * 估算会话历史的累计 tokens（用于判断是否触发摘要） */
function estimateHistoryTokens(history: HistoryMessage[]): number {
  let total = 0;
  for (const m of history) {
    total += estimateTokens(m.content);
  }
  return total;
}

/** 追加一条历史消息，并在必要时压缩（保留简单的旧压缩逻辑，与摘要不冲突） */
export function appendHistory(
  conv: Conversation,
  msg: HistoryMessage,
): void {
  conv.history.push(msg);
  conv.lastActiveAt = Date.now();
  compressIfNeeded(conv);
}

/** 将本轮使用量累计到会话成本 */
export function accumulateCost(conv: Conversation, usage: ArkUsage): void {
  conv.cost.callCount += 1;
  conv.cost.promptTokens += usage.prompt_tokens || 0;
  conv.cost.completionTokens += usage.completion_tokens || 0;
  conv.cost.totalTokens += usage.total_tokens || 0;
  conv.cost.estimatedCostCNY =
    (conv.cost.promptTokens / 1000) * PROMPT_COST_CNY_PER_1K +
    (conv.cost.completionTokens / 1000) * COMPLETION_COST_CNY_PER_1K;
}

/**
 * 判断是否需要摘要，并执行摘要（返回摘要详情）
 * 触发条件：
 *   1) settings.enableSummary !== false
 *   2) 历史消息数 >= MIN_MESSAGES_FOR_SUMMARY（太少消息不够做有效摘要）
 *   3) 与上次摘要的时间间隔 >= SUMMARY_MIN_INTERVAL_MS
 *   4) system prompt + 历史 + 本次用户输入 + 图片估算 tokens >= 用户阈值
 */
export async function summarizeIfNeeded(
  conv: Conversation,
  settings?: UserSettings,
  current?: {
    userText?: string;
    imageDataUrl?: string;
    systemPrompt?: string;
  },
): Promise<SummaryApplied | undefined> {
  const threshold =
    typeof settings?.summaryThresholdTokens === 'number' && settings.summaryThresholdTokens > 0
      ? settings.summaryThresholdTokens
      : DEFAULT_SUMMARY_THRESHOLD_TOKENS;

  if (settings?.enableSummary === false) {
    return undefined;
  }
  if (conv.history.length < MIN_MESSAGES_FOR_SUMMARY) {
    return undefined;
  }

  const systemContent = (current?.systemPrompt || getDefaultSystemPrompt()).trim();
  const systemPromptTokens = Math.ceil(systemContent.length / CHARS_PER_TOKEN);
  const historyTokens = estimateHistoryTokens(conv.history);
  const currentUserTokens = Math.ceil((current?.userText || '').length / CHARS_PER_TOKEN);
  const imageTokens = current?.imageDataUrl ? 200 : 0;
  const estimatedPromptTokens =
    systemPromptTokens + historyTokens + currentUserTokens + imageTokens;

  if (estimatedPromptTokens < threshold) {
    return undefined;
  }
  const now = Date.now();
  if (conv.lastSummaryAt && now - conv.lastSummaryAt < SUMMARY_MIN_INTERVAL_MS) {
    return undefined;
  }

  console.log(
    `[conversation] 会话 ${conv.sessionId}: 预计 prompt ${estimatedPromptTokens} tokens >= 阈值 ${threshold}，准备摘要`,
  );

  return runSummary(conv, settings, historyTokens);
}

/**
 * 执行摘要：
 *   1) 拆分：保留最近 KEEP_RECENT_MESSAGES_AFTER_SUMMARY 条原始消息（最近几轮）
 *   2) 把前面的历史消息送去做摘要
 *   3) 把摘要文本作为一条 system 消息放到保留消息的前面
 */
async function runSummary(
  conv: Conversation,
  settings: UserSettings | undefined,
  historyTokensBefore: number,
): Promise<SummaryApplied | undefined> {
  const keepStart = Math.max(0, conv.history.length - KEEP_RECENT_MESSAGES_AFTER_SUMMARY);
  const summaryMessages = conv.history.slice(0, keepStart);
  const recentMessages = conv.history.slice(keepStart);

  if (summaryMessages.length < 2) {
    return undefined;
  }

  const summarySystemPrompt =
    '你是一个对话摘要助手。请用简洁中文总结下面的多轮对话。你需要以"角色：用户说什么；助手回答什么"的方式总结对话内容，并且挑出对话中用户最重要的问题和重要的观点。输出 3-5 句话即可。';

  // 构造摘要消息
  const messages: ArkChatMessage[] = [
    { role: 'system', content: summarySystemPrompt },
  ];
  for (const m of summaryMessages) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content });
    } else {
      // 多模态数组：摘要时忽略图像，只保留文字，不浪费图像 token
      messages.push({ role: m.role, content: extractText(m.content) });
    }
  }

  try {
    const { replyText, usage } = await callDoubao(messages, {
      temperature: 0.3,
      maxTokens: 300,
    });

    // 计算节省
    const oldTokens = historyTokensBefore;
    const newTokens = Math.ceil(replyText.length / CHARS_PER_TOKEN) +
      estimateHistoryTokens(recentMessages);
    const savedTokens = Math.max(0, oldTokens - newTokens);
    const savedCNY = (savedTokens / 1000) * PROMPT_COST_CNY_PER_1K;

    // 构造新的历史：[摘要消息(system)] + 最近消息
    const summaryMsg: HistoryMessage = {
      role: 'system' as any, // 不直接放入 history（因为 history 只存 user/assistant）
      content: '【对话摘要】' + replyText,
      timestamp: Date.now(),
    };
    // 把摘要消息用 user/assistant 交替结构中不直接塞入 system
    // 更简洁的做法：用 assistant 角色存放摘要（方便后续模型调用）
    const assistantSummary: HistoryMessage = {
      role: 'assistant',
      content: '【对话摘要】' + replyText,
      timestamp: Date.now(),
    };

    conv.history = [assistantSummary, ...recentMessages];
    conv.lastSummaryAt = Date.now();
    conv.cost.savedTokens += savedTokens;

    // 摘要调用自身的 token 开销也计费
    const summaryTokens = (usage.total_tokens || 0);
    conv.cost.promptTokens += usage.prompt_tokens || 0;
    conv.cost.completionTokens += usage.completion_tokens || 0;
    conv.cost.totalTokens += summaryTokens;
    conv.cost.estimatedCostCNY =
      (conv.cost.promptTokens / 1000) * PROMPT_COST_CNY_PER_1K +
      (conv.cost.completionTokens / 1000) * COMPLETION_COST_CNY_PER_1K;

    // 使用 summaryMsg.content（保持与 originalSummary 变量名一致性）
    // 保存到会话的 summary 字段，供前端展示
    (conv as any).summaryText = replyText;

    const result: SummaryApplied = {
      summary: replyText,
      replacedMessages: summaryMessages.length,
      savedTokens: savedTokens,
      summaryTokens: summaryTokens,
      estimatedSavedCNY: savedCNY,
    };

    console.log(
      `[conversation] 会话 ${conv.sessionId}: 完成摘要: 替换 ${summaryMessages.length} 条消息, 节省 ${savedTokens} tokens (¥${savedCNY.toFixed(4)})`,
    );

    return result;
  } catch (err) {
    console.error(`[conversation] 会话 ${conv.sessionId}: 摘要失败:`, err);
    return undefined;
  }
}

function extractText(parts: Array<any>): string {
  const texts = [] as string[];
  for (const part of parts) {
    if (part?.type === 'text' && typeof part?.text === 'string') {
      texts.push(part.text);
    }
  }
  return texts.join(' ').trim();
}

/** 构造发送给 Ark API 的完整消息数组
 *
 * 注意：buildArkMessages 用于构造每一次调用发送给豆包的消息。
 * 如果会话之前做过摘要，摘要会作为一条 assistant 消息存入 history，
 * 直接沿用即可，无需特殊处理。
 */
export function buildArkMessages(params: {
  conv: Conversation;
  userText: string;
  imageDataUrl?: string;
  systemPrompt?: string;
}): ArkChatMessage[] {
  const { conv, userText, imageDataUrl, systemPrompt } = params;
  const systemContent = (systemPrompt || getDefaultSystemPrompt()).trim();
  const messages: ArkChatMessage[] = [
    { role: 'system', content: systemContent },
  ];

  // 历史
  for (const h of conv.history) {
    messages.push({ role: h.role, content: h.content });
  }

  // 当前用户输入：文本 + 可选图像
  if (imageDataUrl) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userText || '请描述你看到的画面。' },
        { type: 'image_url', image_url: { url: imageDataUrl, detail: 'auto' } },
      ],
    });
  } else {
    messages.push({ role: 'user', content: userText || '你好' });
  }
  return messages;
}

/**
 * 压缩历史：当 user+assistant 轮数 >= COMPRESS_AFTER_TURNS 时，
 * 仅保留最近 KEEP_RECENT_TURNS 轮。
 * 注意：此压缩仅保留原始消息，不做任何摘要调用。
 * 它与摘要共存 — 摘要发生在调用之前，会把历史替换为摘要。
 */
function compressIfNeeded(conv: Conversation): void {
  const assistantCount = conv.history.filter((h) => h.role === 'assistant').length;
  if (assistantCount >= COMPRESS_AFTER_TURNS) {
    const keep: HistoryMessage[] = [];
    let turnsKept = 0;
    for (let i = conv.history.length - 1; i >= 0; i--) {
      keep.unshift(conv.history[i]);
      if (conv.history[i].role === 'assistant') {
        turnsKept++;
        if (turnsKept >= KEEP_RECENT_TURNS) break;
      }
    }
    const removed = conv.history.length - keep.length;
    if (removed > 0) {
      console.log(
        `[conversation] 压缩会话 ${conv.sessionId}: 原 ${conv.history.length} 条 -> 保留 ${keep.length} 条`,
      );
      conv.history = keep;
    }
  }
}

/** 浅拷贝成本（避免意外被外部修改） */
export function snapshotCost(cost: ConversationCost): ConversationCost {
  return { ...cost };
}

/**
 * 🆕 构建本次 API 请求的 tokens 拆解（用于前端实时显示）
 * 估算部分：以 1.8 字 ≈ 1 token 近似；真实部分来自豆包 API usage。
 */
export function buildTokenBreakdown(params: {
  conv: Conversation;
  userText: string;
  imageDataUrl?: string;
  usage: ArkUsage;
  systemPrompt?: string;
}): TokenBreakdown {
  const { conv, userText, imageDataUrl, usage, systemPrompt } = params;

  const systemContent = (systemPrompt || getDefaultSystemPrompt()).trim();
  const systemPromptTokens = Math.ceil(systemContent.length / CHARS_PER_TOKEN);

  const historyTokens = estimateHistoryTokens(conv.history);
  const currentUserTokens = Math.ceil((userText || '').length / CHARS_PER_TOKEN);
  const imageTokens = imageDataUrl ? 200 : 0;

  const totalEstimated =
    systemPromptTokens + historyTokens + currentUserTokens + imageTokens;

  return {
    systemPromptTokens,
    historyTokens,
    currentUserTokens,
    imageTokens,
    totalEstimated,
    actualPromptTokens: usage.prompt_tokens || 0,
    actualCompletionTokens: usage.completion_tokens || 0,
    actualTotalTokens: usage.total_tokens || 0,
  };
}
