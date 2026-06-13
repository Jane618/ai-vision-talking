// 共享 TypeScript 类型定义

/** 火山引擎 Ark API 支持的消息内容（文本 + 图像） */
export interface ChatMessageTextContentPart {
  type: 'text';
  text: string;
}

export interface ChatMessageImageContentPart {
  type: 'image_url';
  image_url: {
    url: string; // data:image/jpeg;base64,... 或 URL
    detail?: 'low' | 'high' | 'auto';
  };
}

export type ChatMessageContentPart =
  | ChatMessageTextContentPart
  | ChatMessageImageContentPart;

/** Ark API 支持的 message 结构 */
export interface ArkChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** 纯文本或多模态内容数组 */
  content: string | ChatMessageContentPart[];
}

/** Ark API 的 token 使用量 */
export interface ArkUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** 调用 Ark 的返回结果 */
export interface DoubaoResponse {
  replyText: string;
  usage: ArkUsage;
  model?: string;
}

/** 用户设置（可选） */
export interface UserSettings {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  voiceType?: string;
  enableTTS?: boolean;
  /** 是否启用对话摘要（默认 true） */
  enableSummary?: boolean;
  /** 触发摘要的历史累计 tokens 阈值（默认 8192） */
  summaryThresholdTokens?: number;
}

/** 会话成本统计 */
export interface ConversationCost {
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 估算的费用（单位：元）基于粗略单价，仅供参考 */
  estimatedCostCNY: number;
  /** 通过摘要累计节省的 tokens */
  savedTokens: number;
}

/** 单条历史消息（存入内存） */
export interface HistoryMessage {
  role: 'user' | 'assistant';
  /** 纯文本或多模态数组 */
  content: string | ChatMessageContentPart[];
  /** 若本次调用有图像，记录 base64 便于稍后压缩时剔除 */
  hasImage?: boolean;
  timestamp: number;
}

/** 会话对象 */
export interface Conversation {
  sessionId: string;
  history: HistoryMessage[];
  cost: ConversationCost;
  createdAt: number;
  lastActiveAt: number;
  /** 最近一次摘要发生的时间（ms），用于避免频繁重复摘要 */
  lastSummaryAt?: number;
}

/** 摘要结果：当一次调用触发了历史摘要时，会把这个对象返回给前端 */
export interface SummaryApplied {
  /** 摘要文本（系统会用此内容替换旧历史） */
  summary: string;
  /** 替换掉的消息条数（user + assistant 合计） */
  replacedMessages: number;
  /** 本轮摘要估算节省的 tokens（旧历史估算 tokens - 摘要自身 tokens） */
  savedTokens: number;
  /** 摘要调用自身花费的 tokens（计费） */
  summaryTokens: number;
  /** 估算节省费用（元），= savedTokens * 粗略单价 */
  estimatedSavedCNY: number;
}

/** 🆕 本次 API 请求的 tokens 拆解（用于前端可视化） */
export interface TokenBreakdown {
  /** system prompt 估算 tokens */
  systemPromptTokens: number;
  /** 对话历史（user + assistant）估算 tokens */
  historyTokens: number;
  /** 当前用户消息（仅文本）估算 tokens */
  currentUserTokens: number;
  /** 图像部分估算 tokens（含图像时 > 0） */
  imageTokens: number;
  /** 以上估算之和 */
  totalEstimated: number;
  /** 豆包 API 实际返回的 prompt_tokens（真实值） */
  actualPromptTokens: number;
  /** 豆包 API 实际返回的 completion_tokens（真实值） */
  actualCompletionTokens: number;
  /** 豆包 API 实际返回的 total_tokens（真实值） */
  actualTotalTokens: number;
}

/** /api/multimodal 请求体 */
export interface MultimodalRequestBody {
  sessionId: string;
  /** 可选，base64 编码的 jpeg 图像（不含 data:image/... 前缀），或者带前缀都可 */
  image?: string;
  /** 用户文字/ASR 结果 */
  userText: string;
  settings?: UserSettings;
}

/** /api/multimodal 响应体 */
export interface MultimodalResponseBody {
  ok: boolean;
  replyText?: string;
  /** TTS 音频 base64（若启用且有 key，则为 base64 mp3/wav），否则为 null，前端走浏览器内置 TTS */
  audioBase64?: string | null;
  audioMimeType?: string | null;
  sessionId: string;
  historyCount: number;
  usage?: ArkUsage;
  cost?: ConversationCost;
  /** 本次调用若触发了摘要，在此字段返回摘要详情 */
  summaryApplied?: SummaryApplied;
  /** 🆕 本次 API 请求的 tokens 拆解 */
  tokenBreakdown?: TokenBreakdown;
  /** 错误信息（出现时 ok = false） */
  error?: string;
}

/** /api/clear 请求体 */
export interface ClearRequestBody {
  sessionId: string;
}
