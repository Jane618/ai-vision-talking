import json
import time
import math
from loguru import logger

from app.core.database import get_db_pool
from app.models.schemas import (
    Conversation, HistoryMessage, SummaryApplied, ArkChatMessage,
    UserSettings, ConversationCost, ArkUsage, ChatMessageTextContentPart,
    ChatMessageImageContentPart, TokenBreakdown,
)
from app.services.doubao import call_doubao, call_summary_model, get_default_system_prompt
from app.services.cost import PROMPT_COST_CNY_PER_1K, COMPLETION_COST_CNY_PER_1K

DEFAULT_SUMMARY_THRESHOLD_TOKENS = 8192
KEEP_RECENT_MESSAGES_AFTER_SUMMARY = 8
MIN_MESSAGES_FOR_SUMMARY = 6
SUMMARY_MIN_INTERVAL_MS = 60 * 1000

CHARS_PER_TOKEN = 1.8


def estimate_tokens(content) -> int:
    if isinstance(content, str):
        return math.ceil(len(content) / CHARS_PER_TOKEN)
    total = 0
    for part in content:
        if part.get("type") == "text":
            total += math.ceil(len(part.get("text", "")) / CHARS_PER_TOKEN)
        elif part.get("type") == "image_url":
            total += 200
    return total


def estimate_history_tokens(history: list[HistoryMessage]) -> int:
    return sum(estimate_tokens(m.content) for m in history)


async def summarize_if_needed(
    conv: Conversation,
    settings: dict | None,
    current: dict | None = None,
) -> dict | None:
    threshold = (settings or {}).get(
        "summaryThresholdTokens", DEFAULT_SUMMARY_THRESHOLD_TOKENS
    )
    if (settings or {}).get("enableSummary") is False:
        return None
    if len(conv.history) < MIN_MESSAGES_FOR_SUMMARY:
        return None

    system_content = (
        (current or {}).get("systemPrompt") or get_default_system_prompt()
    ).strip()
    system_prompt_tokens = math.ceil(len(system_content) / CHARS_PER_TOKEN)
    history_tokens = estimate_history_tokens(conv.history)
    current_user_tokens = math.ceil(
        len((current or {}).get("userText", "")) / CHARS_PER_TOKEN
    )
    image_tokens = 200 if (current or {}).get("imageDataUrl") else 0
    estimated_prompt_tokens = (
        system_prompt_tokens + history_tokens + current_user_tokens + image_tokens
    )

    if estimated_prompt_tokens < threshold:
        return None

    now_ms = int(time.time() * 1000)
    if conv.lastSummaryAt and (now_ms - conv.lastSummaryAt) < SUMMARY_MIN_INTERVAL_MS:
        return None

    logger.info(
        f"[conversation] 会话 {conv.sessionId}: "
        f"预计 prompt {estimated_prompt_tokens} tokens >= 阈值 {threshold}"
    )
    return await _run_summary(conv, settings, history_tokens)


async def _run_summary(
    conv: Conversation,
    settings: dict | None,
    history_tokens_before: int,
) -> dict | None:
    keep_start = max(0, len(conv.history) - KEEP_RECENT_MESSAGES_AFTER_SUMMARY)
    summary_messages = conv.history[:keep_start]
    recent_messages = conv.history[keep_start:]

    if len(summary_messages) < 2:
        return None

    summary_system_prompt = (
        '你是一个对话摘要助手。请用简洁中文总结下面的多轮对话。'
        '你需要以"角色:用户说什么;助手回答什么"的方式总结对话内容，'
        '并且挑出对话中用户最重要的问题和重要的观点。输出 3-5 句话即可。'
    )
    messages: list[dict] = [{"role": "system", "content": summary_system_prompt}]
    for m in summary_messages:
        text = _extract_text(m.content) if isinstance(m.content, list) else m.content
        messages.append({"role": m.role, "content": text})

    try:
        reply_text, usage = await call_summary_model(
            messages, {"temperature": 0.3, "maxTokens": 300},
        )

        old_tokens = history_tokens_before
        new_tokens = (
            math.ceil(len(reply_text) / CHARS_PER_TOKEN)
            + estimate_history_tokens(recent_messages)
        )
        saved_tokens = max(0, old_tokens - new_tokens)

        summary_msg = HistoryMessage(
            role="assistant",
            content="【对话摘要】" + reply_text,
            timestamp=int(time.time() * 1000),
        )
        conv.history = [summary_msg] + recent_messages
        conv.lastSummaryAt = int(time.time() * 1000)
        conv.cost.savedTokens += saved_tokens

        conv.cost.promptTokens += usage.prompt_tokens
        conv.cost.completionTokens += usage.completion_tokens
        conv.cost.totalTokens += usage.total_tokens
        conv.cost.estimatedCostCNY = (
            (conv.cost.promptTokens / 1000) * PROMPT_COST_CNY_PER_1K
            + (conv.cost.completionTokens / 1000) * COMPLETION_COST_CNY_PER_1K
        )

        return SummaryApplied(
            summary=reply_text,
            replacedMessages=len(summary_messages),
            savedTokens=saved_tokens,
            summaryTokens=usage.total_tokens,
            estimatedSavedCNY=(saved_tokens / 1000) * PROMPT_COST_CNY_PER_1K,
        ).model_dump()

    except Exception as e:
        logger.error(f"[conversation] 会话 {conv.sessionId}: 摘要失败: {e}")
        return None


def _extract_text(parts: list[dict]) -> str:
    return " ".join(
        p["text"] for p in parts
        if p.get("type") == "text" and isinstance(p.get("text"), str)
    ).strip()


def build_ark_messages(
    conv: Conversation,
    user_text: str,
    image_data_url: str | None = None,
    system_prompt: str | None = None,
) -> list[dict]:
    messages: list[dict] = []

    system_content = system_prompt or get_default_system_prompt()
    messages.append({"role": "system", "content": system_content})

    for m in conv.history:
        messages.append({
            "role": m.role,
            "content": m.content if isinstance(m.content, str) else [
                part.model_dump() for part in m.content
            ],
        })

    if image_data_url:
        messages.append({
            "role": "user",
            "content": [
                {"type": "text", "text": user_text or "请描述你看到的画面。"},
                {"type": "image_url", "image_url": {"url": image_data_url, "detail": "auto"}},
            ],
        })
    else:
        messages.append({"role": "user", "content": user_text})

    return messages


def build_token_breakdown(
    conv: Conversation,
    user_text: str,
    image_data_url: str | None,
    usage: ArkUsage,
    system_prompt: str | None = None,
) -> TokenBreakdown:
    system_content = system_prompt or get_default_system_prompt()
    system_prompt_tokens = math.ceil(len(system_content) / CHARS_PER_TOKEN)
    history_tokens = estimate_history_tokens(conv.history)
    current_user_tokens = math.ceil(len(user_text) / CHARS_PER_TOKEN)
    image_tokens = 200 if image_data_url else 0

    return TokenBreakdown(
        systemPromptTokens=system_prompt_tokens,
        historyTokens=history_tokens,
        currentUserTokens=current_user_tokens,
        imageTokens=image_tokens,
        totalEstimated=system_prompt_tokens + history_tokens + current_user_tokens + image_tokens,
        actualPromptTokens=usage.prompt_tokens,
        actualCompletionTokens=usage.completion_tokens,
        actualTotalTokens=usage.total_tokens,
    )


def append_history(conv: Conversation, msg: dict) -> None:
    """向会话历史追加一条消息。支持 imageId 字段用于引用已存储的图片。"""
    conv.history.append(HistoryMessage(**msg))


async def persist_conversation_to_pg(
    session_id: str,
    user_text: str,
    reply_text: str,
    has_image: bool,
    image_id: str | None,
    usage: ArkUsage,
    token_breakdown: TokenBreakdown | None,
    summary_applied: dict | None,
    settings: dict | None,
) -> None:
    """将本轮对话持久化到 PostgreSQL（优雅降级：PG 不可用时跳过）。"""
    pool = await get_db_pool()
    if not pool:
        logger.debug(f"[persist] PostgreSQL 未配置，跳过持久化 session={session_id}")
        return

    try:
        async with pool.acquire() as conn:
            # 1. 查找或创建会话记录
            row = await conn.fetchrow(
                "SELECT id FROM conversations WHERE session_uuid::text = $1 AND is_deleted = FALSE",
                session_id,
            )
            if row:
                conv_id = row["id"]
            else:
                row = await conn.fetchrow(
                    """
                    INSERT INTO conversations (session_uuid, scene_preset, quality_mode, system_prompt)
                    VALUES ($1, $2, $3, $4)
                    RETURNING id
                    """,
                    session_id,
                    (settings or {}).get("scenePresetId", "daily"),
                    (settings or {}).get("qualityMode", "balanced"),
                    (settings or {}).get("systemPrompt"),
                )
                conv_id = row["id"]

            # 2. 获取当前最大 seq
            seq_row = await conn.fetchrow(
                "SELECT COALESCE(MAX(seq), 0) as max_seq FROM messages WHERE conversation_id = $1",
                conv_id,
            )
            seq = seq_row["max_seq"]

            # 3. 写入用户消息
            content_for_json = (
                [{"type": "text", "text": user_text or "请描述你看到的画面。"}]
                if has_image
                else (user_text or "")
            )
            await conn.execute(
                """
                INSERT INTO messages (conversation_id, role, content, content_text, has_image, seq)
                VALUES ($1, 'user', $2::jsonb, $3, $4, $5)
                """,
                conv_id,
                json.dumps(content_for_json, ensure_ascii=False),
                user_text or "",
                has_image,
                seq + 1,
            )

            # 4. 写入 AI 回复
            await conn.execute(
                """
                INSERT INTO messages (conversation_id, role, content, content_text,
                    prompt_tokens, completion_tokens, total_tokens, seq)
                VALUES ($1, 'assistant', $2::jsonb, $3, $4, $5, $6, $7)
                """,
                conv_id,
                json.dumps(reply_text or "", ensure_ascii=False),
                reply_text or "",
                usage.prompt_tokens if usage else 0,
                usage.completion_tokens if usage else 0,
                usage.total_tokens if usage else 0,
                seq + 2,
            )

            # 5. 写入费用记录
            if usage and usage.total_tokens > 0:
                cost_cny = (
                    (usage.prompt_tokens / 1000) * PROMPT_COST_CNY_PER_1K
                    + (usage.completion_tokens / 1000) * COMPLETION_COST_CNY_PER_1K
                )
                tbd = token_breakdown.model_dump() if token_breakdown else {}
                await conn.execute(
                    """
                    INSERT INTO cost_records (conversation_id, call_number,
                        prompt_tokens, completion_tokens, total_tokens, estimated_cost_cny,
                        system_prompt_tokens, history_tokens, current_user_tokens, image_tokens,
                        model_name)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    """,
                    conv_id,
                    (seq // 2) + 1,
                    usage.prompt_tokens,
                    usage.completion_tokens,
                    usage.total_tokens,
                    cost_cny,
                    tbd.get("systemPromptTokens"),
                    tbd.get("historyTokens"),
                    tbd.get("currentUserTokens"),
                    tbd.get("imageTokens"),
                    "ark",
                )
                await conn.execute(
                    "UPDATE conversations SET total_cost_cny = total_cost_cny + $1, updated_at = NOW() WHERE id = $2",
                    cost_cny, conv_id,
                )

            # 6. 写入摘要记录
            if summary_applied:
                await conn.execute(
                    """
                    INSERT INTO conversation_summaries (conversation_id,
                        summary_text, replaced_msg_count, saved_tokens, summary_tokens, estimated_saved_cny)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    """,
                    conv_id,
                    summary_applied.get("summary", ""),
                    summary_applied.get("replacedMessages", 0),
                    summary_applied.get("savedTokens", 0),
                    summary_applied.get("summaryTokens", 0),
                    summary_applied.get("estimatedSavedCNY", 0),
                )
                await conn.execute(
                    "UPDATE conversations SET summary = $1, updated_at = NOW() WHERE id = $2",
                    summary_applied.get("summary", ""), conv_id,
                )

            logger.info(f"[persist] 会话 {session_id} 已持久化到 PG ({seq + 2} 条消息)")
    except Exception as e:
        logger.warning(f"[persist] PG 持久化失败（不影响主流程）: {e}")
