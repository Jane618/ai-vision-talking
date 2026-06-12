/**
 * 会话管理
 * - 内存 Map<sessionId, Conversation> 存储会话
 * - 对话历史压缩：超过 8 轮消息后自动保留 system prompt + 最近 6 轮
 * - 10 分钟无活动自动清理（定时清理）
 * - 成本追踪：累计调用次数、token 数、估算费用（粗略参考单价）
 */

import type {
  ArkChatMessage,
  ArkUsage,
  Conversation,
  ConversationCost,
  HistoryMessage,
} from '../types';
import { getDefaultSystemPrompt } from './doubao';

/** 超过该数量的消息（对 user+assistant 为一轮）触发压缩 */
const COMPRESS_AFTER_TURNS = 8;
/** 压缩后保留的最近轮数 */
const KEEP_RECENT_TURNS = 6;
/** 会话空闲时间（毫秒），超过后自动清理 */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** 清理定时器间隔 */
const CLEANUP_INTERVAL_MS = 60 * 1000;

/** 粗略参考单价（元 / 1K tokens），仅供参考，实际以火山引擎计费为准 */
const PROMPT_COST_CNY_PER_1K = 0.003;
const COMPLETION_COST_CNY_PER_1K = 0.006;

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

/** 追加一条历史消息，并在必要时压缩 */
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

/** 构造发送给 Ark API 的完整消息数组（system + history + 当前 user+image） */
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
    if (typeof h.content === 'string') {
      messages.push({ role: h.role, content: h.content });
    } else {
      // 多模态数组，直接原样入列
      messages.push({ role: h.role, content: h.content });
    }
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
 * 仅保留最近 KEEP_RECENT_TURNS 轮（每轮 = 1 user + 1 assistant）。
 * 注意：为避免丢失带图像的输入，通常图像只出现在本轮最新消息中，
 * 被压缩出去的历史中的图像会被丢弃（符合保留 system+最近文本摘要的策略）。
 */
function compressIfNeeded(conv: Conversation): void {
  // 按 role 轮换统计轮数（assistant 出现次数即完成的轮数）
  const assistantCount = conv.history.filter((h) => h.role === 'assistant').length;
  if (assistantCount >= COMPRESS_AFTER_TURNS) {
    // 从末尾回溯，保留 KEEP_RECENT_TURNS 轮
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
