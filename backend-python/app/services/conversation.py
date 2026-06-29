import time
import math
from loguru import logger

from app.models.schemas import (
    Conversation, HistoryMessage, SummaryApplied, ArkChatMessage,
    UserSettings, ConversationCost, ArkUsage, ChatMessageTextContentPart,
    ChatMessageImageContentPart, TokenBreakdown,
)
from app.services.doubao import call_doubao, get_default_system_prompt
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
        reply_text, usage = await call_doubao(
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
    conv.history.append(HistoryMessage(**msg))
