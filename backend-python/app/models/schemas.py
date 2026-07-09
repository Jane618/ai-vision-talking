from __future__ import annotations
from typing import Literal, Union, Any
from pydantic import BaseModel, Field


# ---------- 火山引擎消息模型 ----------

class ChatMessageTextContentPart(BaseModel):
    type: Literal["text"] = "text"
    text: str


class ChatMessageImageContentPart(BaseModel):
    type: Literal["image_url"] = "image_url"
    image_url: dict = Field(default_factory=dict)


ChatMessageContentPart = Union[ChatMessageTextContentPart, ChatMessageImageContentPart]


class ArkChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: Union[str, list[ChatMessageContentPart]]


class ArkUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


# ---------- 用户设置 ----------

class UserSettings(BaseModel):
    temperature: float | None = None
    maxTokens: int | None = None
    systemPrompt: str | None = None
    voiceType: str | None = None
    enableTTS: bool | None = None
    enableSummary: bool | None = None
    summaryThresholdTokens: int | None = None


# ---------- 成本统计 ----------

class ConversationCost(BaseModel):
    callCount: int = 0
    promptTokens: int = 0
    completionTokens: int = 0
    totalTokens: int = 0
    estimatedCostCNY: float = 0.0
    savedTokens: int = 0


# ---------- 会话与历史 ----------

class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: Union[str, list[ChatMessageContentPart]]
    hasImage: bool | None = None
    imageId: str | None = None  # 引用 PostgreSQL images 表中的 image_uuid
    timestamp: int


class Conversation(BaseModel):
    sessionId: str
    history: list[HistoryMessage] = []
    cost: ConversationCost = Field(default_factory=ConversationCost)
    createdAt: int = 0
    lastActiveAt: int = 0
    lastSummaryAt: int | None = None


# ---------- 摘要结果 ----------

class SummaryApplied(BaseModel):
    summary: str
    replacedMessages: int
    savedTokens: int
    summaryTokens: int
    estimatedSavedCNY: float


# ---------- Token 拆解 ----------

class TokenBreakdown(BaseModel):
    systemPromptTokens: int = 0
    historyTokens: int = 0
    currentUserTokens: int = 0
    imageTokens: int = 0
    totalEstimated: int = 0
    actualPromptTokens: int = 0
    actualCompletionTokens: int = 0
    actualTotalTokens: int = 0


# ---------- 请求体 ----------

class MultimodalRequest(BaseModel):
    sessionId: str = ""
    image: str | None = None
    imageId: str | None = None  # 引用已存储的图片，与 image 二选一
    userText: str = ""
    settings: UserSettings | None = None


class ClearRequest(BaseModel):
    sessionId: str


# ---------- 响应体 ----------

class MultimodalResponse(BaseModel):
    ok: bool
    replyText: str | None = None
    audioBase64: str | None = None
    audioMimeType: str | None = None
    sessionId: str = ""
    historyCount: int = 0
    usage: ArkUsage | None = None
    cost: ConversationCost | None = None
    summaryApplied: SummaryApplied | None = None
    tokenBreakdown: TokenBreakdown | None = None
    error: str | None = None


class HealthResponse(BaseModel):
    status: str = "ok"
    serverTime: str = ""
    sessionCount: int = 0
    ttsConfigured: bool = False


class ClearResponse(BaseModel):
    ok: bool
    cleared: bool = False
    sessionId: str = ""
    error: str | None = None
