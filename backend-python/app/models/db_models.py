from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID
from pydantic import BaseModel, Field


class UserORM(BaseModel):
    id: int
    uuid: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ConversationORM(BaseModel):
    id: int
    user_id: int | None
    session_uuid: UUID
    title: str | None
    scene_preset: str | None
    quality_mode: str | None
    system_prompt: str | None
    summary: str | None
    summary_tokens: int = 0
    saved_tokens: int = 0
    total_cost_cny: Decimal = Decimal("0")
    is_deleted: bool = False
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ContentPart(BaseModel):
    type: Literal["text", "image_url"]
    text: str | None = None
    image_url: dict[str, Any] | None = None


class MessageORM(BaseModel):
    id: int
    conversation_id: int
    role: Literal["user", "assistant", "system", "tool"]
    content: list[ContentPart] | str
    content_text: str | None
    has_image: bool = False
    image_refs: list[dict] | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    tool_calls: list[dict] | None = None
    tool_call_id: str | None = None
    meta: dict[str, Any] | None = None
    seq: int
    created_at: datetime

    class Config:
        from_attributes = True


class ImageORM(BaseModel):
    id: int
    message_id: int | None
    conversation_id: int
    image_url: str
    image_size: int | None = None
    image_width: int | None = None
    image_height: int | None = None
    image_quality: float | None = None
    complexity_score: float | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class SummaryORM(BaseModel):
    id: int
    conversation_id: int
    summary_text: str
    replaced_msg_count: int
    saved_tokens: int
    summary_tokens: int
    estimated_saved_cny: Decimal
    created_at: datetime

    class Config:
        from_attributes = True


class CostRecordORM(BaseModel):
    id: int
    conversation_id: int
    message_id: int | None
    call_number: int
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    estimated_cost_cny: Decimal
    system_prompt_tokens: int | None
    history_tokens: int | None
    current_user_tokens: int | None
    image_tokens: int | None
    model_name: str | None
    latency_ms: int | None
    created_at: datetime

    class Config:
        from_attributes = True


# ---------- 新增 API 请求/响应 ----------

class CreateConversationRequest(BaseModel):
    user_id: int | None = None
    scene_preset: str = "daily"
    quality_mode: str = "balanced"
    system_prompt: str | None = None


class ConversationListItem(BaseModel):
    session_uuid: UUID
    title: str | None
    scene_preset: str | None
    summary: str | None
    message_count: int
    total_cost_cny: Decimal
    updated_at: datetime


class ConversationDetailResponse(BaseModel):
    conversation: ConversationORM
    messages: list[MessageORM]
    summaries: list[SummaryORM]
    cost_stats: dict[str, Any]
