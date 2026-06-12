/**
 * 本地会话管理（在 Capacitor WebView / 浏览器里运行，不依赖后端）
 *
 * - 按 sessionId 维护历史 + 成本
 * - 超过 8 轮后仅保留最近 6 轮（压缩历史）
 * - 用 localStorage 持久化，App 重新打开还能继续
 */

import type {
  ArkChatMessage,
  ArkUsage,
  ChatMessageContentPart,
} from './doubao';
import { getDefaultSystemPrompt } from './doubao';

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string | ChatMessageContentPart[];
  hasImage?: boolean;
  timestamp: number;
}

export interface ConversationCost {
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostCNY: number;
}

export interface Conversation {
  sessionId: string;
  history: HistoryMessage[];
  cost: ConversationCost;
  createdAt: number;
  lastActiveAt: number;
}

const COMPRESS_AFTER_TURNS = 8;
const KEEP_RECENT_TURNS = 6;
const PROMPT_COST_CNY_PER_1K = 0.003;
const COMPLETION_COST_CNY_PER_1K = 0.006;

const STORAGE_KEY = 'ai-talking.sessions.v1';
const sessions = new Map<string, Conversation>();
let hydrateDone = false;

function hydrateFromStorage(): void {
  try {
    const raw = (typeof window !== 'undefined' && window.localStorage)
      ? window.localStorage.getItem(STORAGE_KEY)
      : null;
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, Conversation>;
    for (const [sid, conv] of Object.entries(obj)) {
      sessions.set(sid, conv);
    }
  } catch { /* ignore */ }
}

function persist(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const obj: Record<string, Conversation> = {};
    for (const [sid, conv] of sessions.entries()) obj[sid] = conv;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}

export function getOrCreateSession(sessionId: string): Conversation {
  if (!hydrateDone) { hydrateFromStorage(); hydrateDone = true; }
  let conv = sessions.get(sessionId);
  if (!conv) {
    conv = {
      sessionId,
      history: [],
      cost: { callCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostCNY: 0 },
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    sessions.set(sessionId, conv);
    persist();
  } else {
    conv.lastActiveAt = Date.now();
  }
  return conv;
}

export function clearSession(sessionId: string): boolean {
  const existed = sessions.has(sessionId);
  if (existed) { sessions.delete(sessionId); persist(); }
  return existed;
}

export function getSessionCount(): number { return sessions.size; }

export function appendHistory(conv: Conversation, msg: HistoryMessage): void {
  conv.history.push(msg);
  conv.lastActiveAt = Date.now();
  compressIfNeeded(conv);
  persist();
}

export function accumulateCost(conv: Conversation, usage: ArkUsage): void {
  conv.cost.callCount += 1;
  conv.cost.promptTokens += usage.prompt_tokens || 0;
  conv.cost.completionTokens += usage.completion_tokens || 0;
  conv.cost.totalTokens += usage.total_tokens || 0;
  conv.cost.estimatedCostCNY =
    (conv.cost.promptTokens / 1000) * PROMPT_COST_CNY_PER_1K +
    (conv.cost.completionTokens / 1000) * COMPLETION_COST_CNY_PER_1K;
  persist();
}

export function buildArkMessages(params: {
  conv: Conversation;
  userText: string;
  imageDataUrl?: string;
  systemPrompt?: string;
}): ArkChatMessage[] {
  const { conv, userText, imageDataUrl, systemPrompt } = params;
  const systemContent = (systemPrompt || getDefaultSystemPrompt()).trim();
  const messages: ArkChatMessage[] = [{ role: 'system', content: systemContent }];

  for (const h of conv.history) {
    messages.push({ role: h.role, content: h.content });
  }

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
    if (keep.length !== conv.history.length) conv.history = keep;
  }
}

export function snapshotCost(cost: ConversationCost): ConversationCost { return { ...cost }; }
