import json
import math
from typing import Callable

import httpx
from loguru import logger

from app.models.schemas import ArkUsage
from app.config.settings import get_settings
from app.services.key_rotator import get_key_rotator

ARK_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"

DEFAULT_SYSTEM_PROMPT = (
    "你是一个友善的中文 AI 助手，可以看到摄像头画面并听到用户说话。"
    "请根据看到的画面内容和用户的问题给予简洁、自然的中文回答。"
    "不要说英文。不要使用 markdown 格式。"
)

CHARS_PER_TOKEN = 1.8


def get_default_system_prompt() -> str:
    return DEFAULT_SYSTEM_PROMPT


def normalize_image_data_url(image: str | None) -> str | None:
    if not image:
        return None
    trimmed = image.strip()
    if trimmed.startswith("data:image"):
        return trimmed
    return f"data:image/jpeg;base64,{trimmed}"


async def _resolve_api_key(prefer_key: str | None = None) -> tuple[str, str] | tuple[None, None]:
    """解析 API Key 和 Model。优先使用 key_rotator 轮转，其次用 prefer_key 或 settings。"""
    rotator = get_key_rotator()
    if rotator and rotator.is_configured():
        key = await rotator.get_key()
        if key:
            cfg = get_settings()
            return key, cfg.ark_model_endpoint

    cfg = get_settings()
    api_key = prefer_key or cfg.ark_api_key
    model = cfg.ark_model_endpoint
    if not api_key or not model:
        raise ValueError("未配置 ARK_API_KEY 或 ARK_MODEL_ENDPOINT")
    return api_key, model


async def call_doubao_stream(
    messages: list[dict],
    settings: dict | None = None,
    on_delta: Callable[[str], None] | None = None,
) -> tuple[str, ArkUsage]:
    api_key, model = await _resolve_api_key()
    temperature = (settings or {}).get("temperature", 0.7)
    max_tokens = (settings or {}).get("maxTokens", 512)

    body = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
    }

    logger.info(f"[doubao] 调用 Ark API (stream): model={model}, messages={len(messages)}")

    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST",
            ARK_ENDPOINT,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            json=body,
        ) as response:
            if response.status_code != 200:
                raw = await response.aread()
                detail = raw.decode("utf-8", errors="replace")
                try:
                    j = json.loads(detail)
                    detail = j.get("error", {}).get("message", detail)
                except (json.JSONDecodeError, AttributeError):
                    pass
                raise Exception(f"Ark API {response.status_code}: {detail}")

            reply_text = ""
            usage = ArkUsage()

            async for line_bytes in response.aiter_lines():
                line = line_bytes.strip()
                if not line.startswith("data:"):
                    continue
                payload = line[len("data:"):].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    chunk = json.loads(payload)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content")
                    if content:
                        reply_text += content
                        if on_delta:
                            on_delta(content)
                    if chunk.get("usage"):
                        u = chunk["usage"]
                        usage = ArkUsage(
                            prompt_tokens=u.get("prompt_tokens", 0),
                            completion_tokens=u.get("completion_tokens", 0),
                            total_tokens=u.get("total_tokens", 0),
                        )
                except (json.JSONDecodeError, KeyError, IndexError):
                    logger.debug(f"[doubao] SSE parse error: {payload[:50]}")

    if usage.total_tokens == 0 and reply_text:
        usage.completion_tokens = math.ceil(len(reply_text) / CHARS_PER_TOKEN)
        prompt_chars = sum(
            len(m.get("content", "")) if isinstance(m.get("content"), str) else 0
            for m in messages
        )
        usage.prompt_tokens = math.ceil(prompt_chars / CHARS_PER_TOKEN)
        usage.total_tokens = usage.prompt_tokens + usage.completion_tokens

    return reply_text.strip(), usage


async def call_doubao(
    messages: list[dict],
    settings: dict | None = None,
) -> tuple[str, ArkUsage]:
    return await call_doubao_stream(messages, settings)


async def call_doubao_stream_raw(
    messages: list[dict],
    settings: dict | None = None,
    on_delta: Callable[[str], None] | None = None,
) -> ArkUsage:
    """调用豆包多模态 API（流式），通过回调发送 delta，返回 usage。"""
    api_key, model = await _resolve_api_key()
    temperature = (settings or {}).get("temperature", 0.7)
    max_tokens = (settings or {}).get("maxTokens", 512)

    body = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
    }

    logger.info(f"[doubao] 调用 Ark API (stream-raw): model={model}, messages={len(messages)}")

    usage = ArkUsage()
    _reply_chars = 0

    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST",
            ARK_ENDPOINT,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            json=body,
        ) as response:
            if response.status_code != 200:
                raw = await response.aread()
                detail = raw.decode("utf-8", errors="replace")
                try:
                    j = json.loads(detail)
                    detail = j.get("error", {}).get("message", detail)
                except (json.JSONDecodeError, AttributeError):
                    pass
                raise Exception(f"Ark API {response.status_code}: {detail}")

            async for line_bytes in response.aiter_lines():
                line = line_bytes.strip()
                if not line.startswith("data:"):
                    continue
                payload = line[len("data:"):].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    chunk = json.loads(payload)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content")
                    if content:
                        _reply_chars += len(content)
                        if on_delta:
                            on_delta(content)
                    if chunk.get("usage"):
                        u = chunk["usage"]
                        usage = ArkUsage(
                            prompt_tokens=u.get("prompt_tokens", 0),
                            completion_tokens=u.get("completion_tokens", 0),
                            total_tokens=u.get("total_tokens", 0),
                        )
                except (json.JSONDecodeError, KeyError, IndexError):
                    logger.debug(f"[doubao] SSE parse error: {payload[:50]}")

    if usage.total_tokens == 0 and _reply_chars > 0:
        usage.completion_tokens = math.ceil(_reply_chars / CHARS_PER_TOKEN)
        prompt_chars = sum(
            len(m.get("content", "")) if isinstance(m.get("content"), str) else 0
            for m in messages
        )
        usage.prompt_tokens = math.ceil(prompt_chars / CHARS_PER_TOKEN)
        usage.total_tokens = usage.prompt_tokens + usage.completion_tokens

    logger.info(f"[doubao] stream-raw 完成: prompt={usage.prompt_tokens}, completion={usage.completion_tokens}")
    return usage


async def call_summary_model(
    messages: list[dict],
    settings: dict | None = None,
) -> tuple[str, ArkUsage]:
    """调用纯文本摘要模型（比多模态便宜）。如果未配置摘要专用模型，回退到主模型。"""
    cfg = get_settings()
    summary_key = cfg.ark_summary_api_key or cfg.ark_api_key
    summary_model = cfg.ark_summary_model_endpoint

    if not summary_model:
        # 未配置摘要模型，回退到主模型
        logger.info("[doubao] 摘要模型未配置，使用主模型")
        return await call_doubao(messages, settings)

    temperature = (settings or {}).get("temperature", 0.3)
    max_tokens = (settings or {}).get("maxTokens", 300)

    body = {
        "model": summary_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
    }

    logger.info(f"[doubao] 调用摘要模型: model={summary_model}, messages={len(messages)}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        async with client.stream(
            "POST",
            ARK_ENDPOINT,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {summary_key}"},
            json=body,
        ) as response:
            if response.status_code != 200:
                raw = await response.aread()
                detail = raw.decode("utf-8", errors="replace")
                try:
                    j = json.loads(detail)
                    detail = j.get("error", {}).get("message", detail)
                except (json.JSONDecodeError, AttributeError):
                    pass
                raise Exception(f"Ark 摘要模型 {response.status_code}: {detail}")

            reply_text = ""
            usage = ArkUsage()

            async for line_bytes in response.aiter_lines():
                line = line_bytes.strip()
                if not line.startswith("data:"):
                    continue
                payload = line[len("data:"):].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    chunk = json.loads(payload)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content")
                    if content:
                        reply_text += content
                    if chunk.get("usage"):
                        u = chunk["usage"]
                        usage = ArkUsage(
                            prompt_tokens=u.get("prompt_tokens", 0),
                            completion_tokens=u.get("completion_tokens", 0),
                            total_tokens=u.get("total_tokens", 0),
                        )
                except (json.JSONDecodeError, KeyError, IndexError):
                    logger.debug(f"[doubao] 摘要 SSE parse error: {payload[:50]}")

        logger.info(f"[doubao] 摘要完成: prompt={usage.prompt_tokens}, completion={usage.completion_tokens}")
        return reply_text.strip(), usage
