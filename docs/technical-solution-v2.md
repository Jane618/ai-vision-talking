# AI Talking 后端重构技术方案

> **版本：** v2.0 | **日期：** 2026-06-29 | **状态：** 方案评审 | **作者：** AI Talking Team
>
> 从 Node.js + Express 迁移至 Python + FastAPI，保持 API 完全兼容，前端零改动即可切换

---

## 目录

1. [重构概述](#1-重构概述)
2. [技术栈选型](#2-技术栈选型)
3. [系统架构](#3-系统架构)
4. [API 接口设计](#4-api-接口设计)
5. [SSE 流式实现](#5-sse-流式实现)
6. [会话管理](#6-会话管理)
7. [对话摘要策略](#7-对话摘要策略)
8. [成本统计模块](#8-成本统计模块)
9. [火山引擎 API 集成](#9-火山引擎-api-集成)
10. [前端兼容策略](#10-前端兼容策略)
11. [项目目录结构](#11-项目目录结构)
12. [部署方案](#12-部署方案)
13. [迁移实施路径](#13-迁移实施路径)
14. [风险与缓解措施](#14-风险与缓解措施)
15. [数据库持久化](#15-数据库持久化)

---

## 1. 重构概述

### 1.1 项目背景

AI Talking 是一款端云协同多模态 AI 对话应用。用户通过浏览器打开摄像头与麦克风，AI 实时看到画面内容、听到用户说的话，并以语音 + 文字形式回应。当前后端采用 Node.js + Express + TypeScript 技术栈，具备完整的 SSE 流式对话、多模态理解、对话摘要压缩、成本统计等能力。

### 1.2 重构目标

> **核心目标：** 将后端从 Node.js + Express 迁移到 Python + FastAPI，保持 API 路径和请求/响应结构完全兼容，前端零改动即可切换。

- **技术升级：** 利用 Python 生态在 AI/ML 领域的丰富工具链，为后续接入更多 AI 能力（如 RAG、Agent、多模态推理）奠定基础
- **性能优化：** FastAPI 基于 async/await 原生异步，在高并发 SSE 场景下具有更好的资源利用率
- **类型安全：** Pydantic v2 提供严格的请求/响应校验，减少运行时错误
- **可维护性：** Python 代码简洁度更高，团队可复用 AI 领域的 Python 专业知识

### 1.3 重构范围

| 范围 | 内容 |
| --- | --- |
| **在范围内（本次重构）** | 后端所有 4 个 HTTP 接口重写；会话管理从内存 Map 迁移到 Redis；火山引擎 API 调用改用 httpx；TTS 语音合成服务迁移；对话摘要与成本统计逻辑迁移；Docker 容器化部署方案 |
| **不在范围内（保持不变）** | 前端 React + TypeScript 代码；前端 UI/UX 交互逻辑；浏览器端摄像头/麦克风 API；浏览器端 ASR 语音识别；API 路径和请求/响应格式；SSE 事件类型和数据格式 |

### 1.4 约束条件

| 约束项 | 要求 | 说明 |
| --- | --- | --- |
| API 兼容性 | **必须** | 所有 API 路径、请求参数、响应结构必须与现有 Node.js 后端完全一致 |
| 前端零改动 | **必须** | 前端代码不需要任何修改即可对接新后端 |
| SSE 格式 | **必须** | event/data 格式、事件类型（delta/summary/done/error）不变 |
| 功能对等 | **必须** | 对话摘要、成本统计、TTS 等功能必须完整保留 |
| 无停机切换 | **推荐** | 通过灰度切换实现新旧后端平滑过渡 |

---

## 2. 技术栈选型

### 2.1 前端技术栈（保持不变）

| 技术 | 版本 | 用途 |
| --- | --- | --- |
| React | 19 | UI 框架 |
| Vite | 6.x | 构建工具 |
| TypeScript | 5.x | 类型安全 |

### 2.2 后端技术栈（重构目标）

| 技术 | 版本 | 用途 | 选型理由 |
| --- | --- | --- | --- |
| `Python` | 3.12+ | 运行时 | AI/ML 生态首选，async/await 原生支持，性能优异 |
| `FastAPI` | 0.115+ | Web 框架 | 原生 async，自动 OpenAPI 文档，Pydantic 集成，SSE 原生支持 |
| `Uvicorn` | 0.32+ | ASGI 服务器 | 高性能异步服务器，配合 uvloop 速度极快 |
| `httpx` | 0.27+ | HTTP 客户端 | 异步 HTTP 客户端，替代 node-fetch，支持 HTTP/2 和流式响应 |
| `Pydantic` | v2 | 数据校验 | 请求/响应严格校验，自动 JSON 序列化，性能比 v1 提升 5-50x |
| `Redis` | 7.x | 会话存储 | 替代内存 Map，支持多实例共享、持久化、TTL 自动过期 |
| `redis-py` | 5.x | Redis 客户端 | 官方 Python Redis 客户端，支持 async |
| `Loguru` | 0.7+ | 日志 | 零配置、结构化日志、自动轮转，替代 console.log |
| `python-dotenv` | 1.x | 环境变量 | 与 Node.js dotenv 对等，从 .env 文件加载配置 |
| `uvicorn[standard]` | - | 生产依赖 | 包含 uvloop 和 httptools，提升生产环境性能 |

### 2.3 开发工具链

| 工具 | 用途 | 对应 Node.js 工具 |
| --- | --- | --- |
| `uv` | 包管理与虚拟环境（替代 pip/venv） | npm / pnpm |
| `ruff` | 代码检查 + 格式化 | ESLint + Prettier |
| `pytest` + `pytest-asyncio` | 单元测试 + 集成测试 | Jest / Vitest |
| `httpx` TestClient | FastAPI 内置测试客户端 | supertest |
| `pre-commit` | Git hooks 代码检查 | husky + lint-staged |

---

## 3. 系统架构

### 3.1 整体架构图

```mermaid
flowchart TB
    subgraph Client["客户端"]
        Browser["浏览器<br/>React + TypeScript"]
    end

    subgraph Gateway["接入层"]
        Nginx["Nginx<br/>反向代理 + HTTPS"]
    end

    subgraph Backend["后端服务"]
        FastAPI["FastAPI<br/>Python 3.12 + Uvicorn"]
        subgraph Modules["业务模块"]
            API["API 路由层<br/>/api/*"]
            Session["会话管理<br/>Redis"]
            Summary["对话摘要"]
            Cost["成本统计"]
            TTS["TTS 语音合成"]
        end
    end

    subgraph External["外部服务"]
        Ark["火山引擎 Ark API<br/>豆包多模态模型"]
        TTSApi["火山引擎 TTS<br/>语音合成"]
        RedisSvc["Redis<br/>会话存储"]
    end

    Browser -- "HTTPS<br/>JSON / SSE" --> Nginx
    Nginx -- "HTTP<br/>反向代理" --> FastAPI
    FastAPI --> API
    API --> Session
    API --> Summary
    API --> Cost
    API --> TTS
    Session -- "读写会话" --> RedisSvc
    Summary -- "调用模型摘要" --> Ark
    API -- "多模态对话<br/>流式 SSE" --> Ark
    TTS -- "语音合成" --> TTSApi
```

### 3.2 请求处理流程

```mermaid
sequenceDiagram
    participant B as 浏览器
    participant N as Nginx
    participant F as FastAPI
    participant R as Redis
    participant A as 火山引擎 Ark

    B->>N: POST /api/multimodal/stream
    N->>F: 转发请求
    F->>R: 获取/创建会话
    R-->>F: 返回会话数据
    F->>F: 检查是否需要摘要
    alt 需要摘要
        F->>A: 调用摘要
        A-->>F: 返回摘要文本
        F->>R: 更新会话历史
        F-->>B: event: summary
    end
    F->>A: 调用多模态对话 (stream)
    loop 每个 chunk
        A-->>F: SSE chunk
        F-->>B: event: delta
    end
    F->>F: 累计成本、追加历史
    F->>R: 更新会话
    F-->>B: event: done
```

### 3.3 SSE 数据流详解

流式接口 `/api/multimodal/stream` 的 SSE 数据流包含以下事件类型：

| 事件类型 | 触发时机 | data 内容 | 说明 |
| --- | --- | --- | --- |
| `delta` | 每收到一块模型输出 | `{ "text": "..." }` | 流式增量文本片段，前端实时拼接 |
| `summary` | 触发对话摘要时 | `SummaryApplied` 对象 | 包含摘要文本、替换消息数、节省 tokens 等 |
| `done` | 对话完成 | `MultimodalResponseBody` 对象 | 完整响应，包含 usage、cost、historyCount 等 |
| `error` | 发生异常 | `{ "ok": false, "error": "..." }` | 错误信息，包含已知的会话状态 |

---

## 4. API 接口设计

> **兼容性承诺：** 所有接口的路径、HTTP 方法、请求体结构、响应体结构与现有 Node.js 后端完全一致。前端无需任何修改。

### 4.1 接口总览

| 接口 | 方法 | 用途 | SSE |
| --- | --- | --- | --- |
| `/api/health` | GET | 健康检查 | - |
| `/api/multimodal` | POST | 多模态对话（非流式） | - |
| `/api/multimodal/stream` | POST | 多模态对话（流式 SSE） | Yes |
| `/api/clear` | POST | 清除会话 | - |

### 4.2 Pydantic 模型定义

```python
# app/models/schemas.py
from __future__ import annotations
from typing import Literal, Union
from pydantic import BaseModel, Field


# ---------- 火山引擎消息模型 ----------

class ChatMessageTextContentPart(BaseModel):
    type: Literal["text"] = "text"
    text: str


class ChatMessageImageContentPart(BaseModel):
    type: Literal["image_url"] = "image_url"
    image_url: dict = Field(default_factory=dict)  # {"url": "...", "detail": "auto"}


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
```

### 4.3 GET /api/health

健康检查接口，返回服务状态信息。

```python
@app.get("/api/health")
async def health_check():
    from datetime import datetime, timezone
    return HealthResponse(
        status="ok",
        serverTime=datetime.now(timezone.utc).isoformat(),
        sessionCount=await session_manager.get_session_count(),
        ttsConfigured=tts_service.is_configured(),
    )
```

### 4.4 POST /api/multimodal

非流式多模态对话接口，返回完整的响应结果（含 TTS 音频）。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 否（自动生成） | 会话 ID，不传时后端自动生成 UUID |
| `image` | string | 否 | Base64 编码的 JPEG 图像 |
| `userText` | string | 否* | 用户文字输入（ASR 识别结果） |
| `settings` | UserSettings | 否 | 用户可选设置 |

> *image 和 userText 至少需要提供一项

**响应体：**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ok` | bool | 请求是否成功 |
| `replyText` | string? | AI 回复文本 |
| `audioBase64` | string? | TTS 音频 Base64（未配置 TTS 时为 null） |
| `audioMimeType` | string? | 音频 MIME 类型（如 audio/mpeg） |
| `sessionId` | string | 会话 ID |
| `historyCount` | int | 当前会话历史消息数 |
| `usage` | ArkUsage? | Token 使用量 |
| `cost` | ConversationCost? | 累计成本信息 |
| `summaryApplied` | SummaryApplied? | 摘要详情（本次触发摘要时返回） |
| `tokenBreakdown` | TokenBreakdown? | Token 使用拆解 |
| `error` | string? | 错误信息 |

### 4.5 POST /api/clear

清除指定会话及其历史记录。

```python
@app.post("/api/clear")
async def clear_session(body: ClearRequest):
    if not body.sessionId or not body.sessionId.strip():
        return ClearResponse(ok=False, error="缺少 sessionId")
    existed = await session_manager.clear_session(body.sessionId.strip())
    return ClearResponse(ok=True, cleared=existed, sessionId=body.sessionId.strip())
```

---

## 5. SSE 流式实现

### 5.1 FastAPI StreamingResponse 方案

FastAPI 提供了 `StreamingResponse` 用于流式响应，配合 `text/event-stream` Content-Type 即可实现 SSE。与 Express 的 `res.write()` 方式不同，FastAPI 使用 async generator 函数来产出 SSE 事件。

> **关键差异：** Express 中使用 `res.write(event + data + \n\n)` 直接写入响应流；FastAPI 中通过 `StreamingResponse` 的 async generator 逐个 yield SSE 格式字符串，效果等价。

### 5.2 SSE 事件格式化工具函数

```python
# app/core/sse.py
import json
from typing import Any


def format_sse(event: str, data: Any) -> str:
    """将事件名和数据格式化为 SSE 协议字符串。

    格式：
        event: {event_name}
        data: {json_string}

        （末尾两个换行符表示事件结束）
    """
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
```

### 5.3 流式接口完整实现

```python
# app/api/multimodal.py
import uuid
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.models.schemas import (
    MultimodalRequest,
    MultimodalResponse,
)
from app.services.session import session_manager
from app.services.doubao import call_doubao_stream, normalize_image_data_url
from app.services.conversation import (
    summarize_if_needed,
    build_ark_messages,
    build_token_breakdown,
    append_history,
    accumulate_cost,
    snapshot_cost,
)
from app.core.sse import format_sse
from app.config.settings import get_settings

router = APIRouter()


@router.post("/api/multimodal/stream")
async def multimodal_stream(request: Request):
    # 解析请求体
    body_bytes = await request.body()
    body = MultimodalRequest(**(await request.json()))

    session_id = (body.sessionId or "").strip()
    user_text = (body.userText or "").strip()
    image = (body.image or "").strip() if body.image else None
    settings = body.settings or {}

    if not session_id:
        session_id = str(uuid.uuid4())
        logger.info(f"[multimodal:stream] 自动生成 sessionId: {session_id}")

    if not user_text and not image:
        # 返回 400（与 Express 保持一致）
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "sessionId": session_id,
                "historyCount": 0,
                "error": "userText 或 image 至少需要提供一项",
            },
        )

    async def event_generator():
        try:
            conv = await session_manager.get_or_create(session_id)
            image_data_url = normalize_image_data_url(image) if image else None

            # 检查是否需要摘要（调用前）
            summary_applied = await summarize_if_needed(
                conv, settings,
                {"userText": user_text, "imageDataUrl": image_data_url,
                 "systemPrompt": settings.systemPrompt},
            )
            if summary_applied:
                yield format_sse("summary", summary_applied)

            # 构造消息并调用流式 API
            messages = build_ark_messages(
                conv=conv,
                user_text=user_text,
                image_data_url=image_data_url,
                system_prompt=settings.systemPrompt,
            )

            reply_text, usage = await call_doubao_stream(
                messages, settings,
                on_delta=lambda delta: None,  # delta 在下方手动发送
            )

            # 实际实现中，call_doubao_stream 接收 on_delta 回调
            # 但在 SSE 场景下，我们需要在 generator 内部 yield
            # 因此改用"收集全部后一次性发送 delta"策略
            # 或使用 async queue 实现真正流式（见下方说明）

            # --- 实际流式方案（使用 async queue）---
            # 上面的代码展示了概念流程。
            # 真正的流式实现需要使用 asyncio.Queue：

            # await call_doubao_stream(messages, settings, on_delta=queue.put_nowait)
            # while True:
            #     delta = await queue.get()
            #     if delta is None: break  # 流结束标记
            #     yield format_sse("delta", {"text": delta})

            # 后续处理（成本累计、历史追加等）
            accumulate_cost(conv, usage)
            token_breakdown = build_token_breakdown(
                conv, user_text, image_data_url, usage, settings.systemPrompt,
            )

            # 追加历史
            if image_data_url:
                append_history(conv, {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_text or "请描述你看到的画面。"},
                        {"type": "image_url", "image_url": {"url": image_data_url, "detail": "auto"}},
                    ],
                    "hasImage": True, "timestamp": int(time.time() * 1000),
                })
            else:
                append_history(conv, {
                    "role": "user", "content": user_text,
                    "hasImage": False, "timestamp": int(time.time() * 1000),
                })
            append_history(conv, {
                "role": "assistant", "content": reply_text,
                "hasImage": False, "timestamp": int(time.time() * 1000),
            })

            # 调用后摘要检查
            if not summary_applied:
                summary_applied = await summarize_if_needed(
                    conv, settings,
                    {"systemPrompt": settings.systemPrompt},
                )
                if summary_applied:
                    yield format_sse("summary", summary_applied)

            # 发送 done 事件
            yield format_sse("done", {
                "ok": True,
                "replyText": reply_text,
                "audioBase64": None,
                "audioMimeType": None,
                "sessionId": session_id,
                "historyCount": len(conv.history),
                "usage": usage,
                "cost": snapshot_cost(conv.cost),
                "summaryApplied": summary_applied,
                "tokenBreakdown": token_breakdown,
            })

        except Exception as e:
            logger.error(f"[multimodal:stream] 异常: {e}")
            conv_ref = await session_manager.get_or_create(session_id)
            yield format_sse("error", {
                "ok": False,
                "sessionId": session_id,
                "historyCount": len(conv_ref.history),
                "cost": snapshot_cost(conv_ref.cost),
                "error": str(e),
            })

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

### 5.4 真正的流式 Delta 实现（asyncio.Queue 方案）

上面的概念代码中，`call_doubao_stream` 先收集完所有文本再 yield delta，这不是真正的流式。下面展示使用 `asyncio.Queue` 实现逐 chunk 流式转发的方案：

```python
# app/api/multimodal.py（流式核心）
import asyncio
from typing import AsyncGenerator


async def multimodal_stream_realtime(
    session_id: str, user_text: str, image: str | None, settings: dict,
) -> AsyncGenerator[str, None]:
    """真正的实时流式 SSE 生成器。"""
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    conv = await session_manager.get_or_create(session_id)
    image_data_url = normalize_image_data_url(image) if image else None

    # 摘要检查（调用前）
    summary_applied = await summarize_if_needed(...)
    if summary_applied:
        yield format_sse("summary", summary_applied)

    # 在后台任务中调用流式 API，通过 queue 传递 delta
    messages = build_ark_messages(conv, user_text, image_data_url, ...)

    async def _call_and_feed():
        """后台协程：调用 Ark 流式 API，将 delta 放入 queue。"""
        try:
            reply_parts = []
            usage = await call_doubao_stream(
                messages, settings,
                on_delta=lambda d: queue.put_nowait(d),
            )
            await queue.put(None)  # 流结束标记
            # 将完整结果存入共享状态供主 generator 使用
            queue.task_done()
        except Exception as e:
            queue.put_nowait(e)  # 传递异常

    task = asyncio.create_task(_call_and_feed())

    try:
        # 从 queue 中逐个读取 delta 并 yield SSE 事件
        while True:
            item = await queue.get()
            if item is None:
                break
            if isinstance(item, Exception):
                raise item
            yield format_sse("delta", {"text": item})
    finally:
        task.cancel()

    # 获取完整结果（从后台任务的状态中获取）
    reply_text = task.result()  # 包含完整文本和 usage
    # ... 后续历史追加、成本累计、done 事件（同上）
```

### 5.5 非流式接口实现

```python
# app/api/multimodal.py
@router.post("/api/multimodal")
async def multimodal(body: MultimodalRequest):
    session_id = (body.sessionId or "").strip()
    user_text = (body.userText or "").strip()
    image = (body.image or "").strip() if body.image else None
    settings = body.settings or {}

    if not session_id:
        session_id = str(uuid.uuid4())

    if not user_text and not image:
        return MultimodalResponse(
            ok=False, sessionId=session_id, historyCount=0,
            error="userText 或 image 至少需要提供一项",
        )

    try:
        conv = await session_manager.get_or_create(session_id)
        image_data_url = normalize_image_data_url(image) if image else None

        # 摘要检查
        summary_applied = await summarize_if_needed(
            conv, settings,
            {"userText": user_text, "imageDataUrl": image_data_url,
             "systemPrompt": settings.systemPrompt},
        )

        # 调用对话 API
        messages = build_ark_messages(
            conv, user_text, image_data_url, settings.systemPrompt,
        )
        reply_text, usage = await call_doubao(messages, settings)
        accumulate_cost(conv, usage)

        # Token 拆解
        token_breakdown = build_token_breakdown(
            conv, user_text, image_data_url, usage, settings.systemPrompt,
        )

        # 追加历史
        if image_data_url:
            append_history(conv, {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text or "请描述你看到的画面。"},
                    {"type": "image_url", "image_url": {
                        "url": image_data_url, "detail": "auto",
                    }},
                ],
                "hasImage": True, "timestamp": int(time.time() * 1000),
            })
        else:
            append_history(conv, {
                "role": "user", "content": user_text,
                "hasImage": False, "timestamp": int(time.time() * 1000),
            })
        append_history(conv, {
            "role": "assistant", "content": reply_text,
            "hasImage": False, "timestamp": int(time.time() * 1000),
        })

        # 调用后摘要
        if not summary_applied:
            summary_applied = await summarize_if_needed(
                conv, settings, {"systemPrompt": settings.systemPrompt},
            )

        # TTS
        audio_base64 = None
        audio_mime_type = None
        if settings.get("enableTTS", True) and reply_text:
            tts_result = await tts_service.synthesize(
                reply_text, voice_type=settings.get("voiceType"),
            )
            if tts_result:
                audio_base64 = tts_result.audio_base64
                audio_mime_type = tts_result.mime_type

        return MultimodalResponse(
            ok=True,
            replyText=reply_text,
            audioBase64=audio_base64,
            audioMimeType=audio_mime_type,
            sessionId=session_id,
            historyCount=len(conv.history),
            usage=usage,
            cost=snapshot_cost(conv.cost),
            summaryApplied=summary_applied,
            tokenBreakdown=token_breakdown,
        )

    except Exception as e:
        logger.error(f"[multimodal] 异常: {e}")
        conv_ref = await session_manager.get_or_create(session_id)
        return MultimodalResponse(
            ok=False, sessionId=session_id,
            historyCount=len(conv_ref.history),
            cost=snapshot_cost(conv_ref.cost),
            error=str(e),
        )
```

---

## 6. 会话管理

### 6.1 从内存 Map 迁移到 Redis

现有 Node.js 后端使用 `Map<sessionId, Conversation>` 存储在进程内存中，存在以下问题：

- 进程重启后所有会话丢失
- 无法在多实例部署时共享会话
- 内存占用随会话数增长无法控制

迁移到 Redis 后可以解决上述所有问题，同时 Redis 的 TTL 机制可以自动清理过期会话，替代现有的 `setInterval` 定时清理逻辑。

### 6.2 Redis 会话结构设计

> **Key 设计：** 使用 `session:{sessionId}` 作为 Redis Key，类型为 `Hash`，TTL 设为 10 分钟（与现有空闲超时一致，每次访问时刷新）。

| Hash Field | 类型 | 说明 |
| --- | --- | --- |
| `sessionId` | string | 会话唯一标识 |
| `history` | string (JSON) | 历史消息数组 JSON 序列化 |
| `cost` | string (JSON) | 成本统计对象 JSON 序列化 |
| `createdAt` | int | 创建时间（ms 时间戳） |
| `lastActiveAt` | int | 最后活跃时间（ms 时间戳） |
| `lastSummaryAt` | int | 最后摘要时间（ms 时间戳） |

### 6.3 Redis 会话管理实现

```python
# app/services/session.py
import json
import time
from typing import Optional

from redis.asyncio import Redis
from loguru import logger

from app.models.schemas import Conversation, ConversationCost, HistoryMessage

# Redis Key 前缀
SESSION_KEY_PREFIX = "session:"
# 会话空闲 TTL（秒），与 Node.js 保持一致
SESSION_TTL_SECONDS = 10 * 60


class SessionManager:
    """基于 Redis 的会话管理器，替代 Node.js 中的内存 Map。"""

    def __init__(self, redis: Redis):
        self._redis = redis

    def _key(self, session_id: str) -> str:
        return f"{SESSION_KEY_PREFIX}{session_id}"

    async def get_or_create(self, session_id: str) -> Conversation:
        """获取或创建会话，每次访问刷新 TTL。"""
        key = self._key(session_id)
        data = await self._redis.hgetall(key)
        if data:
            conv = self._deserialize(data)
            conv.lastActiveAt = int(time.time() * 1000)
            await self._save(key, conv)
            return conv

        # 新建会话
        conv = Conversation(
            sessionId=session_id,
            history=[],
            cost=ConversationCost(),
            createdAt=int(time.time() * 1000),
            lastActiveAt=int(time.time() * 1000),
        )
        await self._save(key, conv)
        logger.info(f"[session] 新建会话 {session_id}")
        return conv

    async def get(self, session_id: str) -> Optional[Conversation]:
        """获取会话（不自动创建）。"""
        key = self._key(session_id)
        data = await self._redis.hgetall(key)
        if not data:
            return None
        conv = self._deserialize(data)
        conv.lastActiveAt = int(time.time() * 1000)
        await self._save(key, conv)
        return conv

    async def clear_session(self, session_id: str) -> bool:
        """清除指定会话，返回是否 existed。"""
        key = self._key(session_id)
        existed = await self._redis.exists(key)
        if existed:
            await self._redis.delete(key)
            logger.info(f"[session] 清除会话 {session_id}")
        return bool(existed)

    async def save(self, session_id: str, conv: Conversation) -> None:
        """保存会话到 Redis（手动刷新 TTL）。"""
        key = self._key(session_id)
        await self._save(key, conv)

    async def get_session_count(self) -> int:
        """获取当前活跃会话数量。"""
        pattern = f"{SESSION_KEY_PREFIX}*"
        count = 0
        async for _ in self._redis.scan_iter(match=pattern):
            count += 1
        return count

    async def _save(self, key: str, conv: Conversation) -> None:
        """序列化并存入 Redis Hash，同时设置 TTL。"""
        mapping = {
            "sessionId": conv.sessionId,
            "history": json.dumps(
                [m.model_dump() for m in conv.history],
                ensure_ascii=False,
            ),
            "cost": conv.cost.model_dump_json(),
            "createdAt": str(conv.createdAt),
            "lastActiveAt": str(conv.lastActiveAt),
        }
        if conv.lastSummaryAt is not None:
            mapping["lastSummaryAt"] = str(conv.lastSummaryAt)
        await self._redis.hset(key, mapping=mapping)
        await self._redis.expire(key, SESSION_TTL_SECONDS)

    def _deserialize(self, data: dict) -> Conversation:
        """从 Redis Hash 数据反序列化为 Conversation 对象。"""
        history_data = json.loads(data.get(b"history", b"[]").decode())
        cost_data = json.loads(data.get(b"cost", b"{}").decode())
        history = [HistoryMessage(**m) for m in history_data]
        cost = ConversationCost(**cost_data)
        last_summary = None
        if b"lastSummaryAt" in data:
            last_summary = int(data[b"lastSummaryAt"].decode())
        return Conversation(
            sessionId=data.get(b"sessionId", b"").decode(),
            history=history,
            cost=cost,
            createdAt=int(data.get(b"createdAt", b"0").decode()),
            lastActiveAt=int(data.get(b"lastActiveAt", b"0").decode()),
            lastSummaryAt=last_summary,
        )
```

### 6.4 会话自动清理

Redis 的 `EXPIRE` 命令会在每次 `save` 时刷新 TTL。当会话超过 10 分钟未被访问，Redis 自动删除该 Key，无需额外的定时清理任务（相比 Node.js 中的 `setInterval` 方案更加优雅）。

> **优势对比：** Node.js 中使用 `setInterval` 每 60 秒遍历所有会话检查空闲超时，复杂度为 O(n)；Redis TTL 由服务端自动管理，零应用层开销。

---

## 7. 对话摘要策略

### 7.1 摘要触发条件

对话摘要与 Node.js 现有逻辑完全一致，触发条件如下：

| 条件 | 说明 | 常量 |
| --- | --- | --- |
| 启用摘要 | `settings.enableSummary !== false` | 默认开启 |
| 最小消息数 | 历史消息 >= 6 条才触发摘要 | `MIN_MESSAGES_FOR_SUMMARY = 6` |
| 最小时间间隔 | 距上次摘要 >= 60 秒，避免频繁摘要 | `SUMMARY_MIN_INTERVAL_MS = 60000` |
| Token 阈值 | system + history + user + image 估算 tokens >= 阈值 | `DEFAULT_SUMMARY_THRESHOLD_TOKENS = 8192` |

### 7.2 摘要执行流程

```mermaid
flowchart TD
    A[收到对话请求] --> B{历史消息 >= 6?}
    B -- 否 --> Z[跳过摘要]
    B -- 是 --> C{距上次摘要 >= 60s?}
    C -- 否 --> Z
    C -- 是 --> D{估算 tokens >= 阈值?}
    D -- 否 --> Z
    D -- 是 --> E[拆分历史]
    E --> F[旧消息 -> 摘要模型]
    F --> G[获取摘要文本]
    G --> H[新历史 = 摘要消息 + 最近 8 条]
    H --> I[累计 savedTokens]
    I --> J[返回 SummaryApplied]
```

### 7.3 Python 摘要实现

```python
# app/services/conversation.py
import time
import math
from loguru import logger

from app.models.schemas import (
    Conversation, HistoryMessage, SummaryApplied, ArkChatMessage,
    UserSettings, ConversationCost, ArkUsage,
)
from app.services.doubao import call_doubao, get_default_system_prompt

# ---------- 常量（与 Node.js 完全一致） ----------
DEFAULT_SUMMARY_THRESHOLD_TOKENS = 8192
KEEP_RECENT_MESSAGES_AFTER_SUMMARY = 8
MIN_MESSAGES_FOR_SUMMARY = 6
SUMMARY_MIN_INTERVAL_MS = 60 * 1000  # 60秒

CHARS_PER_TOKEN = 1.8  # 1 token ≈ 1.8 个中文字符


def estimate_tokens(content) -> int:
    """估算一段内容的近似 token 数（纯启发式，与 Node.js 逻辑一致）。"""
    if isinstance(content, str):
        return math.ceil(len(content) / CHARS_PER_TOKEN)
    total = 0
    for part in content:
        if part.get("type") == "text":
            total += math.ceil(len(part.get("text", "")) / CHARS_PER_TOKEN)
        elif part.get("type") == "image_url":
            total += 200  # 图片固定估算
    return total


def estimate_history_tokens(history: list[HistoryMessage]) -> int:
    """估算会话历史累计 tokens。"""
    return sum(estimate_tokens(m.content) for m in history)


async def summarize_if_needed(
    conv: Conversation,
    settings: dict | None,
    current: dict | None = None,
) -> dict | None:
    """判断是否需要摘要，并执行。逻辑与 Node.js conversation.ts 完全对等。"""
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
    """执行摘要：保留最近 8 条，其余调用模型摘要。"""
    keep_start = max(0, len(conv.history) - KEEP_RECENT_MESSAGES_AFTER_SUMMARY)
    summary_messages = conv.history[:keep_start]
    recent_messages = conv.history[keep_start:]

    if len(summary_messages) < 2:
        return None

    # 构造摘要 prompt
    summary_system_prompt = (
        "你是一个对话摘要助手。请用简洁中文总结下面的多轮对话。"
        "你需要以"角色：用户说什么；助手回答什么"的方式总结对话内容，"
        "并且挑出对话中用户最重要的问题和重要的观点。输出 3-5 句话即可。"
    )
    messages: list[dict] = [{"role": "system", "content": summary_system_prompt}]
    for m in summary_messages:
        text = _extract_text(m.content) if isinstance(m.content, list) else m.content
        messages.append({"role": m.role, "content": text})

    try:
        reply_text, usage = await call_doubao(
            messages, {"temperature": 0.3, "maxTokens": 300},
        )

        # 计算节省
        old_tokens = history_tokens_before
        new_tokens = (
            math.ceil(len(reply_text) / CHARS_PER_TOKEN)
            + estimate_history_tokens(recent_messages)
        )
        saved_tokens = max(0, old_tokens - new_tokens)

        # 构造新历史：[摘要 as assistant] + 最近消息
        summary_msg = HistoryMessage(
            role="assistant",
            content="【对话摘要】" + reply_text,
            timestamp=int(time.time() * 1000),
        )
        conv.history = [summary_msg] + recent_messages
        conv.lastSummaryAt = int(time.time() * 1000)
        conv.cost.savedTokens += saved_tokens

        # 摘要调用自身的 token 开销也计费
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
    """从多模态内容数组中提取纯文本。"""
    return " ".join(
        p["text"] for p in parts
        if p.get("type") == "text" and isinstance(p.get("text"), str)
    ).strip()
```

---

## 8. 成本统计模块

### 8.1 统计指标

成本统计模块与 Node.js 现有逻辑完全一致，使用相同的粗略参考单价进行费用估算。

| 指标 | 类型 | 说明 |
| --- | --- | --- |
| `callCount` | int | 累计 API 调用次数（含对话 + 摘要） |
| `promptTokens` | int | 累计 prompt tokens |
| `completionTokens` | int | 累计 completion tokens |
| `totalTokens` | int | 累计总 tokens |
| `estimatedCostCNY` | float | 估算费用（元），基于粗略参考单价 |
| `savedTokens` | int | 通过摘要累计节省的 tokens |

### 8.2 参考单价

> **注意：** 以下为粗略参考单价，实际费用以火山引擎官方计费为准。

| 类型 | 单价（元/1K tokens） | 常量名 |
| --- | --- | --- |
| Prompt | 0.003 | `PROMPT_COST_CNY_PER_1K` |
| Completion | 0.006 | `COMPLETION_COST_CNY_PER_1K` |

### 8.3 成本累计实现

```python
# app/services/cost.py
from app.models.schemas import ConversationCost, ArkUsage

# 粗略参考单价（元 / 1K tokens）
PROMPT_COST_CNY_PER_1K = 0.003
COMPLETION_COST_CNY_PER_1K = 0.006


def accumulate_cost(cost: ConversationCost, usage: ArkUsage) -> None:
    """将本轮使用量累计到会话成本。与 Node.js 逻辑完全一致。"""
    cost.callCount += 1
    cost.promptTokens += usage.prompt_tokens
    cost.completionTokens += usage.completion_tokens
    cost.totalTokens += usage.total_tokens
    cost.estimatedCostCNY = (
        (cost.promptTokens / 1000) * PROMPT_COST_CNY_PER_1K
        + (cost.completionTokens / 1000) * COMPLETION_COST_CNY_PER_1K
    )


def snapshot_cost(cost: ConversationCost) -> dict:
    """浅拷贝成本对象（避免外部修改影响原始数据）。"""
    return cost.model_dump()
```

---

## 9. 火山引擎 API 集成

### 9.1 httpx 异步 HTTP 客户端

使用 `httpx.AsyncClient` 替代 Node.js 的 `node-fetch`。httpx 支持 HTTP/2、自动连接池管理、流式响应等特性，且 API 设计与 requests 类似，学习成本低。

### 9.2 豆包多模态模型调用

```python
# app/services/doubao.py
import json
import math
from typing import Callable, Optional

import httpx
from loguru import logger

from app.models.schemas import ArkUsage
from app.config.settings import get_settings

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
    """将原始 base64 图像规范化为 data:image/jpeg;base64,... 格式。"""
    if not image:
        return None
    trimmed = image.strip()
    if trimmed.startswith("data:image"):
        return trimmed
    return f"data:image/jpeg;base64,{trimmed}"


async def call_doubao_stream(
    messages: list[dict],
    settings: dict | None = None,
    on_delta: Optional[Callable[[str], None]] = None,
) -> tuple[str, ArkUsage]:
    """调用豆包多模态 API（流式），返回 (完整文本, usage)。

    与 Node.js callDoubaoStream 逻辑完全对等。
    """
    cfg = get_settings()
    api_key = cfg.ark_api_key
    model = cfg.ark_model_endpoint
    if not api_key or not model:
        raise ValueError("未配置 ARK_API_KEY 或 ARK_MODEL_ENDPOINT，请检查 .env 文件。")

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

    logger.info(
        f"[doubao] 调用 Ark API (stream): model={model}, "
        f"messages={len(messages)}, temp={temperature}, maxTokens={max_tokens}"
    )

    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST",
            ARK_ENDPOINT,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
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
            model_name = model

            async for line_bytes in response.aiter_lines():
                line = line_bytes.strip()
                if not line.startswith("data:"):
                    continue
                payload = line[len("data:"):].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    chunk = json.loads(payload)
                    model_name = chunk.get("model", model_name)
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

    # API 未返回 usage 时做估算
    if usage.total_tokens == 0 and reply_text:
        usage.completion_tokens = math.ceil(len(reply_text) / CHARS_PER_TOKEN)
        prompt_chars = sum(
            len(m.get("content", "")) if isinstance(m.get("content"), str) else 0
            for m in messages
        )
        usage.prompt_tokens = math.ceil(prompt_chars / CHARS_PER_TOKEN)
        usage.total_tokens = usage.prompt_tokens + usage.completion_tokens
        logger.info(
            f"[doubao] API 未返回 usage，估算: "
            f"prompt={usage.prompt_tokens}, completion={usage.completion_tokens}"
        )

    logger.info(
        f"[doubao] 完成: prompt={usage.prompt_tokens}, "
        f"completion={usage.completion_tokens}, "
        f"total={usage.total_tokens}, replyLen={len(reply_text)}"
    )

    return reply_text.strip(), usage


async def call_doubao(
    messages: list[dict],
    settings: dict | None = None,
) -> tuple[str, ArkUsage]:
    """非流式调用（实际调用流式版本但忽略 delta）。"""
    return await call_doubao_stream(messages, settings)
```

### 9.3 TTS 语音合成集成

```python
# app/services/tts.py
import json
import time
from dataclasses import dataclass

import httpx
from loguru import logger

from app.config.settings import get_settings


@dataclass
class TTSResult:
    audio_base64: str
    mime_type: str


class TTSService:
    """火山引擎 TTS 语音合成服务。"""

    def __init__(self):
        self._configured: bool | None = None

    def is_configured(self) -> bool:
        """检查是否配置了 TTS 凭证。"""
        if self._configured is None:
            cfg = get_settings()
            self._configured = bool(cfg.volc_tts_app_id and cfg.volc_tts_access_token)
        return self._configured

    async def synthesize(
        self,
        text: str,
        voice_type: str | None = None,
    ) -> TTSResult | None:
        """调用火山引擎 TTS 合成语音。失败时返回 None（前端走浏览器内置 TTS）。"""
        if not text or not text.strip():
            return None
        if not self.is_configured():
            logger.info("[tts] 未配置 TTS 凭证，跳过。前端将使用浏览器内置 TTS。")
            return None

        cfg = get_settings()
        input_text = text[:1024]  # 截断超长文本
        voice = voice_type or cfg.volc_tts_voice_type or "BV001_streaming"

        body = {
            "app": {
                "appid": cfg.volc_tts_app_id,
                "token": cfg.volc_tts_access_token,
                "cluster": cfg.volc_tts_cluster or "volcano_tts",
            },
            "user": {"uid": "ai-talking-user"},
            "audio": {
                "voice_type": voice,
                "encoding": "mp3",
                "speed_ratio": 1.0,
                "volume_ratio": 1.0,
                "pitch_ratio": 1.0,
            },
            "request": {
                "reqid": f"req_{int(time.time() * 1000)}_{int(time.time() * 1000) % 1000000}",
                "text": input_text,
                "text_type": "plain",
                "operation": "query",
            },
        }

        try:
            logger.info(f"[tts] 调用火山 TTS: voice={voice}, textLen={len(input_text)}")
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    "https://openspeech.bytedance.com/api/v1/tts",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer;{cfg.volc_tts_access_token}",
                    },
                    json=body,
                )
                if resp.status_code != 200:
                    logger.warning(f"[tts] 失败 {resp.status_code}: {resp.text[:200]}")
                    return None

                data = resp.json()
                base64_audio = data.get("data")
                if not base64_audio:
                    logger.warning("[tts] 响应中没有 data 字段")
                    return None

                logger.info(f"[tts] 合成完成, base64 len={len(base64_audio)}")
                return TTSResult(audio_base64=base64_audio, mime_type="audio/mpeg")

        except Exception as e:
            logger.warning(f"[tts] 调用异常: {e}")
            return None


# 全局单例
tts_service = TTSService()
```

---

## 10. 前端兼容策略

> **核心承诺：** 通过严格遵循以下兼容策略，前端代码无需任何修改即可对接 Python 后端。

### 10.1 API 路径不变

| API 路径 | HTTP 方法 | 兼容 |
| --- | --- | --- |
| `/api/health` | GET | 一致 |
| `/api/multimodal` | POST | 一致 |
| `/api/multimodal/stream` | POST | 一致 |
| `/api/clear` | POST | 一致 |

### 10.2 请求/响应 JSON 结构不变

所有请求体和响应体的字段名、类型、嵌套结构严格保持一致。Pydantic 模型定义的 `alias` 或 `serialization_alias` 可用于精确控制 JSON 字段名。以下是关键对应关系：

| JSON 字段名 | TypeScript 类型 | Python Pydantic 类型 |
| --- | --- | --- |
| `sessionId` | string | `str` |
| `userText` | string | `str` |
| `replyText` | string \| undefined | `str \| None` |
| `audioBase64` | string \| null | `str \| None` |
| `historyCount` | number | `int` |
| `usage.prompt_tokens` | number | `int` |
| `cost.estimatedCostCNY` | number | `float` |
| `summaryApplied.savedTokens` | number | `int` |

### 10.3 SSE 事件格式不变

SSE 事件的 `event:` 和 `data:` 行格式严格保持一致：

```
event: delta
data: {"text": "你好"}

event: summary
data: {"summary": "用户问了天气...", "replacedMessages": 6, "savedTokens": 1200, ...}

event: done
data: {"ok": true, "replyText": "今天天气晴朗...", "sessionId": "abc-123", ...}

event: error
data: {"ok": false, "sessionId": "abc-123", "error": "调用超时", ...}
```

### 10.4 兼容性验证方法

1. **自动化接口测试：** 使用 pytest + httpx 编写完整的 API 契约测试，验证每个接口的请求/响应格式
2. **SSE 事件格式测试：** 逐事件验证 event 类型和 data JSON 结构
3. **前端联调：** 修改前端配置中的后端地址（从 localhost:3001 切换到 localhost:8000），验证所有功能正常
4. **字段缺失检测：** 对比 TypeScript 类型定义和 Pydantic 模型，确保字段一一对应

---

## 11. 项目目录结构

### 11.1 Python 后端目录结构

```
ai-talking-backend/
├── pyproject.toml            # 项目配置（uv/pip）
├── uv.lock                   # 依赖锁定文件
├── .env.example             # 环境变量模板
├── .python-version           # Python 版本锁定（3.12）
├── Dockerfile                # Docker 构建文件
├── ruff.toml                 # Ruff 代码检查配置
├── app/                      # 应用主目录
│   ├── __init__.py
│   ├── main.py               # FastAPI 应用入口
│   ├── api/                  # API 路由层
│   │   ├── __init__.py
│   │   ├── multimodal.py      # /api/multimodal, /api/multimodal/stream
│   │   ├── health.py          # /api/health
│   │   └── session.py         # /api/clear
│   ├── services/             # 业务逻辑层
│   │   ├── __init__.py
│   │   ├── doubao.py          # 火山引擎 Ark API 调用
│   │   ├── tts.py             # TTS 语音合成服务
│   │   ├── conversation.py    # 对话管理（摘要、消息构造、Token 拆解）
│   │   ├── session.py         # Redis 会话管理
│   │   └── cost.py            # 成本统计
│   ├── models/               # 数据模型
│   │   ├── __init__.py
│   │   └── schemas.py         # Pydantic 模型定义
│   ├── config/               # 配置管理
│   │   ├── __init__.py
│   │   └── settings.py         # 环境变量配置（pydantic-settings）
│   └── core/                  # 核心工具
│       ├── __init__.py
│       ├── sse.py             # SSE 格式化工具
│       └── redis.py           # Redis 连接管理
├── tests/                    # 测试目录
│   ├── conftest.py            # pytest fixtures
│   ├── api/                   # API 接口测试
│   ├── services/              # 业务逻辑测试
│   └── models/                # 模型测试
└── scripts/                   # 运维脚本
    └── start.sh               # 启动脚本
```

### 11.2 Node.js 与 Python 文件对照表

| Node.js 文件 | Python 文件 | 功能 |
| --- | --- | --- |
| `src/index.ts` | `app/main.py` | 应用入口、路由注册 |
| `src/types.ts` | `app/models/schemas.py` | 类型/模型定义 |
| `src/services/doubao.ts` | `app/services/doubao.py` | 火山引擎 API 调用 |
| `src/services/tts.ts` | `app/services/tts.py` | TTS 语音合成 |
| `src/services/conversation.ts` | `app/services/conversation.py` | 对话管理、摘要 |
| （内嵌在 Map 中） | `app/services/session.py` | Redis 会话管理 |
| （内嵌在 conversation.ts） | `app/services/cost.py` | 成本统计 |
| `.env` | `.env` | 环境变量 |

### 11.3 FastAPI 应用入口

```python
# app/main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from loguru import logger

from app.api.health import router as health_router
from app.api.multimodal import router as multimodal_router
from app.api.session import router as session_router
from app.core.redis import get_redis_pool, close_redis_pool
from app.config.settings import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化 Redis 连接，关闭时清理。"""
    logger.info("[main] AI Talking FastAPI 后端启动中...")
    await get_redis_pool()  # 初始化 Redis 连接池
    settings = get_settings()
    logger.info(f"[main] ARK 已配置: {bool(settings.ark_api_key and settings.ark_model_endpoint)}")
    logger.info(f"[main] TTS 已配置: {settings.volc_tts_app_id and settings.volc_tts_access_token}")
    logger.info("[main] 启动完成")
    yield
    await close_redis_pool()
    logger.info("[main] AI Talking FastAPI 后端已关闭")


app = FastAPI(
    title="AI Talking Backend",
    description="AI Talking 后端 API - Python FastAPI + 豆包多模态",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(health_router)
app.include_router(multimodal_router)
app.include_router(session_router)

# 404 兜底
from fastapi.responses import JSONResponse

@app.exception_handler(404)
async def not_found_handler(request, exc):
    return JSONResponse(status_code=404, content={"ok": False, "error": "Not Found"})
```

### 11.4 配置管理

```python
# app/config/settings.py
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """应用配置，从环境变量加载。与 Node.js .env.example 一一对应。"""

    # 服务配置
    server_port: int = 8000
    server_host: str = "0.0.0.0"

    # 火山引擎 Ark API
    ark_api_key: str = ""
    ark_model_endpoint: str = ""

    # 火山引擎 TTS（可选）
    volc_tts_app_id: str = ""
    volc_tts_access_token: str = ""
    volc_tts_cluster: str = "volcano_tts"
    volc_tts_voice_type: str = "BV001_streaming"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }


# 全局单例
_settings: Settings | None = None

def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
```

---

## 12. 部署方案

### 12.1 生产环境架构

```mermaid
flowchart LR
    subgraph Internet["互联网"]
        Client["浏览器 / 手机"]
    end

    subgraph Server["服务器"]
        Nginx["Nginx<br/>:443 HTTPS"]
        Gunicorn["Gunicorn<br/>+ Uvicorn Workers<br/>:8000"]
        Redis["Redis<br/>:6379"]
    end

    subgraph External["外部"]
        Ark["火山引擎 API"]
    end

    Client -- "HTTPS" --> Nginx
    Nginx -- "proxy_pass :8000" --> Gunicorn
    Gunicorn -- "读写" --> Redis
    Gunicorn -- "HTTP API" --> Ark
```

### 12.2 Gunicorn + Uvicorn Workers

使用 Gunicorn 作为进程管理器，配合 Uvicorn worker class 运行 FastAPI 应用。每个 worker 是一个独立的 ASGI 进程，通过 Redis 共享会话状态。

```bash
# 生产环境启动（4 个 worker，每个 worker 内 1 个 asyncio 事件循环）
gunicorn app.main:app \
    --bind 0.0.0.0:8000 \
    --workers 4 \
    --worker-class uvicorn.workers.UvicornWorker \
    --timeout 120 \
    --keep-alive 5 \
    --access-logfile - \
    --error-logfile -
```

### 12.3 Docker 容器化

```dockerfile
# Dockerfile
# 多阶段构建：先安装依赖，再复制源码
FROM python:3.12-slim AS builder

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen --no-dev

FROM python:3.12-slim

WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY app/ ./app/
COPY .env.example .env.example

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["gunicorn", "app.main:app", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "4", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--timeout", "120"]
```

```yaml
# docker-compose.yml
version: "3.9"

services:
  backend:
    build: ./ai-talking-backend
    ports:
      - "8000:8000"
    env_file:
      - ./ai-talking-backend/.env
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
      - ./frontend/dist:/usr/share/nginx/html:ro
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  redis_data:
```

### 12.4 Nginx 反向代理配置

```nginx
# nginx.conf
upstream fastapi_backend {
    server backend:8000;
}

server {
    listen 443 ssl http2;
    server_name _;

    ssl_certificate     /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # 前端静态资源
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
        # 带 hash 的静态资源长缓存
        location ~* \.[a-f0-9]{8,}\.(js|css)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
            expires 1m;
        }
    }

    # API 反向代理
    location /api/ {
        proxy_pass http://fastapi_backend;
        proxy_http_version 1.1;

        # SSE 流式支持
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 禁用 Nginx 缓冲（关键！SSE 必须关闭）
        proxy_buffering off;
        proxy_cache off;

        # 超时设置（对话可能较慢）
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

### 12.5 HTTPS 配置

移动端浏览器访问摄像头和麦克风必须使用 HTTPS。推荐使用 mkcert 生成本地开发证书：

```bash
# 安装 mkcert（macOS）
brew install mkcert
mkcert -install

# 生成证书（覆盖 localhost 和局域网 IP）
mkcert localhost 127.0.0.1 192.168.1.10

# 产物：localhost+2.pem（证书）和 localhost+2-key.pem（私钥）
```

---

## 13. 迁移实施路径

### 13.1 四阶段迁移计划

**阶段一：接口契约固化**

预计工期：1-2 天 | 产出：API 契约文档 + 自动化测试

- 梳理现有 4 个 API 接口的完整请求/响应格式，记录为 JSON Schema
- 编写 pytest 自动化接口契约测试（基于现有 Node.js 后端运行）
- 记录 SSE 事件的 event 类型和 data JSON 格式
- 确认前端使用的所有 API 调用点和期望格式
- **验收标准：** 契约测试全部通过，覆盖所有接口和 SSE 事件

**阶段二：后端并行重构**

预计工期：5-7 天 | 产出：完整的 Python 后端代码

- 搭建 Python 项目骨架（pyproject.toml、目录结构、Dockerfile）
- 实现 Pydantic 模型定义（与 TypeScript 类型一一对应）
- 实现 Redis 会话管理（替代内存 Map）
- 实现 httpx 调用火山引擎 API（流式 + 非流式）
- 实现 TTS 服务、对话摘要、成本统计
- 实现 4 个 API 路由（含 SSE StreamingResponse）
- 通过契约测试验证接口兼容性
- **验收标准：** Python 后端独立运行，契约测试全部通过

**阶段三：联调验证**

预计工期：2-3 天 | 产出：前端与 Python 后端完整联调

- 前端配置切换到 Python 后端地址
- 端到端功能验证：文本对话、图像对话、SSE 流式、TTS 语音
- 验证对话摘要触发和摘要结果正确性
- 验证成本统计、Token 拆解数据准确性
- 验证会话管理（新建、清除、Redis 持久化）
- 性能对比测试（响应时间、内存占用）
- **验收标准：** 所有前端功能正常，无功能回归

**阶段四：灰度切换**

预计工期：1-2 天 | 产出：Python 后端正式上线

- Nginx 配置 upstream 负载均衡，Python 后端设为 primary
- 保留 Node.js 后端作为 fallback（可随时切换回）
- 灰度发布：先内部测试，再小范围用户
- 监控错误率、响应时间、Redis 连接状态
- 确认稳定后，完全切换到 Python 后端
- 下线 Node.js 后端
- **验收标准：** Python 后端稳定运行 48 小时，零故障

### 13.2 Nginx 灰度切换配置

```nginx
# nginx.conf（灰度切换）
upstream backend_pool {
    # Python 后端（主）
    server python_backend:8000 weight=9;
    # Node.js 后端（备，可随时切回）
    server node_backend:3001 weight=1;
}

server {
    location /api/ {
        proxy_pass http://backend_pool;
        # ... 其他 SSE 配置同上
    }
}
```

---

## 14. 风险与缓解措施

| # | 风险 | 等级 | 缓解措施 |
| --- | --- | --- | --- |
| 1 | **API 格式不兼容** - JSON 字段名、类型、嵌套结构差异导致前端解析失败 | 高 | 使用 Pydantic `model_dump()` 精确控制 JSON 输出；编写自动化契约测试对比新旧后端；逐接口逐一验证，不遗漏任何字段 |
| 2 | **SSE 流式行为差异** - FastAPI StreamingResponse 与 Express res.write() 行为不完全一致 | 高 | 确保 `Cache-Control: no-cache, no-transform` 和 `X-Accel-Buffering: no`；Nginx 关闭 `proxy_buffering`；前端联调测试重点验证流式场景 |
| 3 | **Redis 依赖引入** - Redis 单点故障导致所有会话丢失 | 中 | Redis 配置 AOF 持久化，避免重启丢数据；生产环境使用 Redis Sentinel 或 Cluster 高可用方案；TTS 失败时前端可回退到浏览器内置 TTS |
| 4 | **对话摘要逻辑偏差** - Python 实现的摘要触发条件和执行逻辑与 Node.js 不完全一致 | 中 | 所有常量（阈值、间隔、保留数）与 Node.js 保持一致；编写单元测试对比摘要触发条件；联调时使用相同对话序列验证摘要行为 |
| 5 | **火山引擎 API 调用差异** - httpx 与 node-fetch 在流式解析、超时处理等行为上有差异 | 中 | httpx `async_client.stream()` 支持原生流式，与 node-fetch 对等；设置合理的超时（60s），与 Node.js 行为一致；完善的错误处理和重试机制 |
| 6 | **Token 估算差异** - Python 和 Node.js 的字符/token 换算可能因编码差异导致不一致 | 低 | 使用相同的 `CHARS_PER_TOKEN = 1.8` 常量；Token 估算本身是粗略值，微小差异不影响功能 |
| 7 | **团队 Python 熟练度** - 团队主要经验在 Node.js/TypeScript，Python 经验不足 | 低 | 本方案提供了完整的代码示例和目录结构；FastAPI 学习曲线平缓，与 Express 概念对应；Pydantic v2 与 TypeScript 类型系统概念相似 |
| 8 | **UUID 格式差异** - Python `uuid.uuid4()` 与 Node.js `uuid v4()` 格式一致（均为标准 UUID4） | 无 | 两者均输出标准 UUID4 格式（`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`），无需特殊处理 |

---

## 15. 数据库持久化

### 15.1 数据库选型

推荐使用 **PostgreSQL**，理由如下：

- **JSONB 原生支持多模态消息：** `content` 字段使用 JSONB 类型，天然支持多模态内容（文本 + 图片 URL）的存储和查询，无需额外拆分
- **全文检索：** 内置 `tsvector` / `tsquery` 全文搜索，可用于会话历史搜索
- **ACID 保障：** 事务性保证数据一致性，适合金融级成本记录存储
- **pgvector 扩展：** 后续可接入向量嵌入，支持语义搜索和 RAG 能力
- **成熟生态：** `asyncpg` 提供高性能异步驱动，`SQLAlchemy` / `encode/databases` 提供 ORM 支持
- **低成本运维：** 单实例即可满足当前规模，配合 Docker 部署简单

### 15.2 表结构设计

```sql
-- 用户表
CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 会话表
CREATE TABLE conversations (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
    session_uuid    UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    title           VARCHAR(255),
    scene_preset    VARCHAR(50),
    quality_mode    VARCHAR(50),
    system_prompt   TEXT,
    summary         TEXT,
    summary_tokens  INT DEFAULT 0,
    saved_tokens    INT DEFAULT 0,
    total_cost_cny  DECIMAL(12,6) DEFAULT 0,
    is_deleted      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 消息表
CREATE TABLE messages (
    id              BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content         JSONB NOT NULL,
    content_text    TEXT,
    has_image       BOOLEAN DEFAULT FALSE,
    image_refs      JSONB,
    prompt_tokens       INT,
    completion_tokens   INT,
    total_tokens        INT,
    tool_calls      JSONB,
    tool_call_id    VARCHAR(100),
    meta            JSONB,
    seq             INT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 图片表
CREATE TABLE images (
    id              BIGSERIAL PRIMARY KEY,
    message_id      BIGINT REFERENCES messages(id) ON DELETE CASCADE,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    image_data      BYTEA,
    image_url       TEXT,
    image_size      INT,
    image_width     INT,
    image_height    INT,
    image_quality   DECIMAL(3,2),
    complexity_score DECIMAL(3,2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 摘要历史表
CREATE TABLE conversation_summaries (
    id                  BIGSERIAL PRIMARY KEY,
    conversation_id     BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    summary_text        TEXT NOT NULL,
    replaced_msg_count  INT NOT NULL,
    saved_tokens        INT NOT NULL,
    summary_tokens      INT NOT NULL,
    estimated_saved_cny DECIMAL(12,6),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 成本记录表
CREATE TABLE cost_records (
    id                  BIGSERIAL PRIMARY KEY,
    conversation_id     BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id          BIGINT REFERENCES messages(id),
    call_number         INT NOT NULL,
    prompt_tokens       INT NOT NULL,
    completion_tokens   INT NOT NULL,
    total_tokens        INT NOT NULL,
    estimated_cost_cny  DECIMAL(12,6) NOT NULL,
    system_prompt_tokens INT,
    history_tokens      INT,
    current_user_tokens INT,
    image_tokens        INT,
    model_name          VARCHAR(100),
    latency_ms          INT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_messages_conversation_seq ON messages(conversation_id, seq);
CREATE INDEX idx_messages_role ON messages(role);
CREATE INDEX idx_conversations_user ON conversations(user_id, updated_at DESC);
CREATE INDEX idx_cost_records_conversation ON cost_records(conversation_id, call_number);
```

**表关系图：**

```
users (1) ───< (N) conversations (1) ───< (N) messages (1) ───< (0..1) images
                              (1) ───< (N) conversation_summaries
                              (1) ───< (N) cost_records
```

### 15.3 Pydantic 数据库模型

```python
# app/models/db_schemas.py
from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from typing import Optional, Any
from pydantic import BaseModel, Field
import uuid


# ========== ORM 行模型 ==========

class UserORM(BaseModel):
    id: int
    uuid: uuid.UUID
    created_at: datetime
    updated_at: datetime


class ConversationORM(BaseModel):
    id: int
    user_id: int | None = None
    session_uuid: uuid.UUID
    title: str | None = None
    scene_preset: str | None = None
    quality_mode: str | None = None
    system_prompt: str | None = None
    summary: str | None = None
    summary_tokens: int = 0
    saved_tokens: int = 0
    total_cost_cny: Decimal = Decimal("0")
    is_deleted: bool = False
    created_at: datetime
    updated_at: datetime


class ContentPart(BaseModel):
    """多模态内容的一个部分（文本或图片）。"""
    type: str  # "text" | "image_url"
    text: str | None = None
    image_url: dict | None = None  # {"url": "...", "detail": "auto"}


class MessageORM(BaseModel):
    id: int
    conversation_id: int
    role: str  # "user" | "assistant" | "system" | "tool"
    content: Any  # JSONB: str 或 list[ContentPart]
    content_text: str | None = None
    has_image: bool = False
    image_refs: list[dict] | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    tool_calls: list[dict] | None = None
    tool_call_id: str | None = None
    meta: dict | None = None
    seq: int
    created_at: datetime


class ImageORM(BaseModel):
    id: int
    message_id: int | None = None
    conversation_id: int
    image_data: bytes | None = None
    image_url: str | None = None
    image_size: int | None = None
    image_width: int | None = None
    image_height: int | None = None
    image_quality: Decimal | None = None
    complexity_score: Decimal | None = None
    created_at: datetime


class CostRecordORM(BaseModel):
    id: int
    conversation_id: int
    message_id: int | None = None
    call_number: int
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    estimated_cost_cny: Decimal
    system_prompt_tokens: int | None = None
    history_tokens: int | None = None
    current_user_tokens: int | None = None
    image_tokens: int | None = None
    model_name: str | None = None
    latency_ms: int | None = None
    created_at: datetime


class ConversationSummaryORM(BaseModel):
    id: int
    conversation_id: int
    summary_text: str
    replaced_msg_count: int
    saved_tokens: int
    summary_tokens: int
    estimated_saved_cny: Decimal | None = None
    created_at: datetime


# ========== 请求 / 响应模型 ==========

class CreateConversationRequest(BaseModel):
    """创建新会话。"""
    title: str | None = None
    scene_preset: str | None = None
    quality_mode: str | None = None
    system_prompt: str | None = None


class ConversationListItem(BaseModel):
    """会话列表中的一个条目。"""
    session_uuid: uuid.UUID
    title: str | None
    scene_preset: str | None
    summary: str | None
    message_count: int = 0
    total_cost_cny: float = 0.0
    created_at: datetime
    updated_at: datetime


class ConversationDetailResponse(BaseModel):
    """完整的会话详情（含消息、图片、摘要、成本）。"""
    session_uuid: uuid.UUID
    title: str | None
    scene_preset: str | None
    quality_mode: str | None
    system_prompt: str | None
    summary: str | None
    summary_tokens: int
    saved_tokens: int
    total_cost_cny: float
    messages: list[MessageORM] = []
    images: list[ImageORM] = []
    summaries: list[ConversationSummaryORM] = []
    cost_records: list[CostRecordORM] = []
    created_at: datetime
    updated_at: datetime


class HistoryQueryParams(BaseModel):
    """历史会话查询参数。"""
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
```

### 15.4 数据库存储层实现

```python
# app/repositories/conversation_repo.py
import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

import asyncpg
from loguru import logger

from app.models.db_schemas import (
    ConversationORM,
    MessageORM,
    ImageORM,
    CostRecordORM,
    ConversationSummaryORM,
)


class ConversationRepository:
    """会话数据持久化层（PostgreSQL）。"""

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    # ---------- 会话 ----------

    async def create_conversation(
        self,
        user_id: int | None = None,
        session_uuid: UUID | None = None,
        title: str | None = None,
        scene_preset: str | None = None,
        quality_mode: str | None = None,
        system_prompt: str | None = None,
    ) -> ConversationORM:
        """创建新会话，返回会话记录。"""
        if session_uuid is None:
            session_uuid = __import__("uuid").uuid4()
        now = datetime.now(timezone.utc)
        row = await self._pool.fetchrow(
            """
            INSERT INTO conversations (user_id, session_uuid, title, scene_preset, quality_mode, system_prompt)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, user_id, session_uuid, title, scene_preset, quality_mode,
                      system_prompt, summary, summary_tokens, saved_tokens,
                      total_cost_cny, is_deleted, created_at, updated_at
            """,
            user_id, session_uuid, title, scene_preset, quality_mode, system_prompt,
        )
        return ConversationORM(**dict(row))

    async def get_conversation_by_uuid(
        self, session_uuid: UUID, include_deleted: bool = False,
    ) -> ConversationORM | None:
        """根据 session_uuid 获取会话。"""
        row = await self._pool.fetchrow(
            """
            SELECT * FROM conversations
            WHERE session_uuid = $1 AND (is_deleted = FALSE OR $2 = TRUE)
            """,
            session_uuid, include_deleted,
        )
        return ConversationORM(**dict(row)) if row else None

    async def list_user_conversations(
        self,
        user_id: int | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[ConversationORM], int]:
        """列出用户的会话（分页），返回 (列表, 总数)。"""
        offset = (page - 1) * page_size
        if user_id is not None:
            count_row = await self._pool.fetchrow(
                "SELECT COUNT(*) FROM conversations WHERE user_id = $1 AND is_deleted = FALSE",
                user_id,
            )
            rows = await self._pool.fetch(
                """
                SELECT * FROM conversations
                WHERE user_id = $1 AND is_deleted = FALSE
                ORDER BY updated_at DESC
                LIMIT $2 OFFSET $3
                """,
                user_id, page_size, offset,
            )
        else:
            count_row = await self._pool.fetchrow(
                "SELECT COUNT(*) FROM conversations WHERE is_deleted = FALSE",
            )
            rows = await self._pool.fetch(
                """
                SELECT * FROM conversations
                WHERE is_deleted = FALSE
                ORDER BY updated_at DESC
                LIMIT $1 OFFSET $2
                """,
                page_size, offset,
            )
        total = count_row["count"]
        return [ConversationORM(**dict(r)) for r in rows], total

    async def soft_delete_conversation(self, session_uuid: UUID) -> bool:
        """软删除会话，返回是否成功。"""
        result = await self._pool.execute(
            "UPDATE conversations SET is_deleted = TRUE WHERE session_uuid = $1 AND is_deleted = FALSE",
            session_uuid,
        )
        return "UPDATE 1" in result

    # ---------- 消息 ----------

    async def append_message(
        self,
        conversation_id: int,
        role: str,
        content: str | list[dict],
        content_text: str | None = None,
        has_image: bool = False,
        image_refs: list[dict] | None = None,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        total_tokens: int | None = None,
        tool_calls: list[dict] | None = None,
        tool_call_id: str | None = None,
        meta: dict | None = None,
    ) -> MessageORM:
        """追加一条消息到会话。"""
        row = await self._pool.fetchrow(
            """
            INSERT INTO messages
                (conversation_id, role, content, content_text, has_image, image_refs,
                 prompt_tokens, completion_tokens, total_tokens, tool_calls, tool_call_id, meta, seq)
            SELECT $1, $2, $3::jsonb, $4, $5, $6::jsonb,
                   $7, $8, $9, $10::jsonb, $11, $12::jsonb,
                   COALESCE(MAX(seq), 0) + 1
            FROM messages WHERE conversation_id = $1
            RETURNING *
            """,
            conversation_id, role, json.dumps(content) if not isinstance(content, str) else content,
            content_text, has_image,
            json.dumps(image_refs) if image_refs else None,
            prompt_tokens, completion_tokens, total_tokens,
            json.dumps(tool_calls) if tool_calls else None,
            tool_call_id,
            json.dumps(meta) if meta else None,
        )
        return MessageORM(**dict(row))

    # ---------- 图片 ----------

    async def store_image(
        self,
        conversation_id: int,
        message_id: int | None = None,
        image_data: bytes | None = None,
        image_url: str | None = None,
        image_size: int | None = None,
        image_width: int | None = None,
        image_height: int | None = None,
        image_quality: float | None = None,
        complexity_score: float | None = None,
    ) -> ImageORM:
        """存储图片记录。"""
        row = await self._pool.fetchrow(
            """
            INSERT INTO images
                (conversation_id, message_id, image_data, image_url, image_size,
                 image_width, image_height, image_quality, complexity_score)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
            """,
            conversation_id, message_id, image_data, image_url, image_size,
            image_width, image_height, image_quality, complexity_score,
        )
        return ImageORM(**dict(row))

    # ---------- 消息查询 ----------

    async def get_messages_by_conversation(
        self, conversation_id: int, limit: int | None = None,
    ) -> list[MessageORM]:
        """获取会话的所有消息（按 seq 排序）。"""
        query = "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY seq ASC"
        params: list = [conversation_id]
        if limit is not None:
            query += " LIMIT $2"
            params.append(limit)
        rows = await self._pool.fetch(query, *params)
        return [MessageORM(**dict(r)) for r in rows]

    # ---------- 摘要 ----------

    async def save_summary(
        self,
        conversation_id: int,
        summary_text: str,
        replaced_msg_count: int,
        saved_tokens: int,
        summary_tokens: int,
        estimated_saved_cny: float | None = None,
    ) -> ConversationSummaryORM:
        """保存摘要记录。"""
        row = await self._pool.fetchrow(
            """
            INSERT INTO conversation_summaries
                (conversation_id, summary_text, replaced_msg_count,
                 saved_tokens, summary_tokens, estimated_saved_cny)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            """,
            conversation_id, summary_text, replaced_msg_count,
            saved_tokens, summary_tokens, estimated_saved_cny,
        )
        return ConversationSummaryORM(**dict(row))

    # ---------- 成本 ----------

    async def record_cost(
        self,
        conversation_id: int,
        message_id: int | None = None,
        call_number: int = 0,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        total_tokens: int = 0,
        estimated_cost_cny: float = 0.0,
        system_prompt_tokens: int | None = None,
        history_tokens: int | None = None,
        current_user_tokens: int | None = None,
        image_tokens: int | None = None,
        model_name: str | None = None,
        latency_ms: int | None = None,
    ) -> CostRecordORM:
        """记录一条成本明细。"""
        row = await self._pool.fetchrow(
            """
            INSERT INTO cost_records
                (conversation_id, message_id, call_number, prompt_tokens,
                 completion_tokens, total_tokens, estimated_cost_cny,
                 system_prompt_tokens, history_tokens, current_user_tokens,
                 image_tokens, model_name, latency_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
            """,
            conversation_id, message_id, call_number, prompt_tokens,
            completion_tokens, total_tokens, Decimal(str(estimated_cost_cny)),
            system_prompt_tokens, history_tokens, current_user_tokens,
            image_tokens, model_name, latency_ms,
        )
        return CostRecordORM(**dict(row))

    # ---------- 会话回放 ----------

    async def get_conversation_for_replay(self, session_uuid: UUID) -> dict | None:
        """完整恢复一个会话（会话信息 + 消息 + 图片 + 摘要 + 成本），用于回放或断点续传。"""
        conv = await self.get_conversation_by_uuid(session_uuid)
        if not conv:
            return None

        messages = await self.get_messages_by_conversation(conv.id)

        images_rows = await self._pool.fetch(
            "SELECT * FROM images WHERE conversation_id = $1", conv.id,
        )
        images = [ImageORM(**dict(r)) for r in images_rows]

        summaries_rows = await self._pool.fetch(
            "SELECT * FROM conversation_summaries WHERE conversation_id = $1 ORDER BY created_at ASC",
            conv.id,
        )
        summaries = [ConversationSummaryORM(**dict(r)) for r in summaries_rows]

        cost_rows = await self._pool.fetch(
            "SELECT * FROM cost_records WHERE conversation_id = $1 ORDER BY call_number ASC",
            conv.id,
        )
        cost_records = [CostRecordORM(**dict(r)) for r in cost_rows]

        return {
            "conversation": conv,
            "messages": messages,
            "images": images,
            "summaries": summaries,
            "cost_records": cost_records,
        }
```

### 15.5 FastAPI 新增 API 接口

```python
# app/api/conversations.py
import uuid
from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from app.models.db_schemas import (
    CreateConversationRequest,
    ConversationListItem,
    ConversationDetailResponse,
    HistoryQueryParams,
)
from app.repositories.conversation_repo import ConversationRepository
from app.config.settings import get_settings
from loguru import logger

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def _get_repo() -> ConversationRepository:
    """获取数据库仓库实例（实际通过依赖注入）。"""
    from app.core.db import get_db_pool
    return ConversationRepository(get_db_pool())


@router.post("", status_code=201)
async def create_conversation(body: CreateConversationRequest):
    """创建新会话。"""
    repo = _get_repo()
    conv = await repo.create_conversation(
        title=body.title,
        scene_preset=body.scene_preset,
        quality_mode=body.quality_mode,
        system_prompt=body.system_prompt,
    )
    logger.info(f"[conversations] 创建会话: uuid={conv.session_uuid}")
    return {"ok": True, "session_uuid": str(conv.session_uuid), "conversation_id": conv.id}


@router.get("")
async def list_conversations(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """列出历史会话（分页）。"""
    repo = _get_repo()
    conversations, total = await repo.list_user_conversations(
        page=page, page_size=page_size,
    )
    items = [
        ConversationListItem(
            session_uuid=c.session_uuid,
            title=c.title,
            scene_preset=c.scene_preset,
            summary=c.summary,
            message_count=0,  # 可通过子查询获取
            total_cost_cny=float(c.total_cost_cny),
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c in conversations
    ]
    return {
        "ok": True,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "items": [item.model_dump() for item in items],
    }


@router.get("/{session_uuid}")
async def get_conversation_detail(session_uuid: str):
    """获取完整会话详情（含消息、图片、摘要、成本）。"""
    repo = _get_repo()
    try:
        uuid_val = uuid.UUID(session_uuid)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的 session_uuid 格式")

    data = await repo.get_conversation_for_replay(uuid_val)
    if not data:
        raise HTTPException(status_code=404, detail="会话不存在")

    conv = data["conversation"]
    resp = ConversationDetailResponse(
        session_uuid=conv.session_uuid,
        title=conv.title,
        scene_preset=conv.scene_preset,
        quality_mode=conv.quality_mode,
        system_prompt=conv.system_prompt,
        summary=conv.summary,
        summary_tokens=conv.summary_tokens,
        saved_tokens=conv.saved_tokens,
        total_cost_cny=float(conv.total_cost_cny),
        messages=data["messages"],
        images=data["images"],
        summaries=data["summaries"],
        cost_records=data["cost_records"],
        created_at=conv.created_at,
        updated_at=conv.updated_at,
    )
    return {"ok": True, **resp.model_dump()}


@router.delete("/{session_uuid}")
async def delete_conversation(session_uuid: str):
    """软删除会话。"""
    repo = _get_repo()
    try:
        uuid_val = uuid.UUID(session_uuid)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的 session_uuid 格式")

    deleted = await repo.soft_delete_conversation(uuid_val)
    if not deleted:
        raise HTTPException(status_code=404, detail="会话不存在或已删除")
    return {"ok": True, "session_uuid": session_uuid, "deleted": True}


@router.post("/migrate")
async def migrate_anonymous_to_user(
    anonymous_session_uuid: str,
    user_id: int,
):
    """匿名会话迁移到登录用户：将匿名用户的会话关联到 user_id。"""
    repo = _get_repo()
    try:
        uuid_val = uuid.UUID(anonymous_session_uuid)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的 session_uuid 格式")

    conv = await repo.get_conversation_by_uuid(uuid_val)
    if not conv:
        raise HTTPException(status_code=404, detail="会话不存在")

    if conv.user_id is not None and conv.user_id != user_id:
        raise HTTPException(status_code=400, detail="该会话已关联其他用户")

    # 更新 user_id
    result = await repo._pool.execute(
        "UPDATE conversations SET user_id = $1, updated_at = NOW() WHERE session_uuid = $2",
        user_id, uuid_val,
    )
    logger.info(f"[conversations] 迁移匿名会话 {uuid_val} -> user {user_id}")
    return {"ok": True, "session_uuid": anonymous_session_uuid, "user_id": user_id}
```

**接口总览：**

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `POST /api/conversations` | POST | 创建会话 |
| `GET /api/conversations` | GET | 列出历史会话（分页） |
| `GET /api/conversations/{session_uuid}` | GET | 获取完整会话详情（含消息、图片、摘要、成本） |
| `DELETE /api/conversations/{session_uuid}` | DELETE | 软删除会话 |
| `POST /api/conversations/migrate` | POST | 匿名转登录迁移 |

### 15.6 数据库连接与配置

**asyncpg 连接池初始化：**

```python
# app/core/db.py
import asyncpg
from loguru import logger

from app.config.settings import get_settings

_pool: asyncpg.Pool | None = None


async def get_db_pool() -> asyncpg.Pool:
    """获取全局数据库连接池（懒初始化）。"""
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = await asyncpg.create_pool(
            dsn=settings.database_url,
            min_size=2,
            max_size=10,
            command_timeout=60,
        )
        logger.info(f"[db] PostgreSQL 连接池已初始化: {settings.database_url[:50]}...")
    return _pool


async def close_db_pool() -> None:
    """关闭连接池。"""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("[db] PostgreSQL 连接池已关闭")
```

**settings.py 新增 DATABASE_URL 配置：**

```python
# app/config/settings.py（扩展）
class Settings(BaseSettings):
    # ... 之前所有字段保持不变 ...

    # PostgreSQL 数据库（新增）
    database_url: str = "postgresql://postgres:postgres@localhost:5432/ai_talking"

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }
```

**.env.example 新增条目：**

```bash
# PostgreSQL
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_talking
```

### 15.7 匿名用户与登录用户策略

**匿名用户：**

- `user_id = NULL`，不关联任何 users 记录
- 前端在 `localStorage` 中保存 `session_uuid`，刷新页面后可恢复会话
- 会话数据保存在 PostgreSQL 中，刷新页面不会丢失（相比纯 Redis 方案更可靠）
- 匿名用户的会话仅在本设备可见

**登录用户：**

- `user_id` 关联 users 表记录，跨设备同步
- 通过 `GET /api/conversations` 列出该用户所有会话
- 支持跨设备查看历史对话

**匿名转登录迁移：**

```python
# 迁移流程示例
async def migrate_on_login(anonymous_session_uuid: str, user_id: int):
    """
    当用户从匿名状态登录时调用：
    1. 将匿名会话的 user_id 更新为当前登录用户
    2. 前端无需切换 session_uuid，会话无缝延续
    """
    repo = ConversationRepository(get_db_pool())
    conv = await repo.get_conversation_by_uuid(UUID(anonymous_session_uuid))

    if conv and conv.user_id is None:
        # 执行迁移
        await repo._pool.execute(
            "UPDATE conversations SET user_id = $1, updated_at = NOW() WHERE id = $2",
            user_id, conv.id,
        )
        logger.info(f"[migrate] 匿名会话 {anonymous_session_uuid} -> user_id={user_id}")
    elif conv and conv.user_id is not None and conv.user_id != user_id:
        logger.warning(f"[migrate] 会话 {anonymous_session_uuid} 已关联其他用户，跳过迁移")
```

### 15.8 设计决策汇总

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 数据库 | PostgreSQL + JSONB | 原生支持多模态消息的灵活结构，同时具备关系型数据的事务保障和索引能力 |
| content 字段 | content (JSONB) + content_text (TEXT) 双字段 | JSONB 保留完整结构信息；content_text 提供纯文本摘要，用于全文检索和前端展示，避免每次解析 JSONB |
| 图片存储 | images 独立表 | 与消息解耦，支持一张消息多张图片、图片元数据（尺寸/质量/复杂度）独立管理 |
| seq 字段 | messages.seq INT NOT NULL | 保证消息顺序，替代 created_at（并发场景下时间戳可能相同），支持按序号快速分页 |
| 成本记录 | cost_records 独立表 | 每次调用一条记录，可做细粒度分析（每轮成本、模型对比、延迟追踪）， conversations 表只存汇总 |
| 摘要历史 | conversation_summaries 独立表 | 保留摘要历史，可回溯查看摘要效果和节省 token 趋势 |
| 删除策略 | 软删除 (is_deleted) | 用户可恢复误删会话；避免级联删除导致数据永久丢失 |
| 数据库驱动 | asyncpg | 原生异步，性能远优于同步 psycopg2；直接返回 dict-like Row，无需 ORM 中间层 |

### 15.9 与现有会话管理的关系

数据库持久化层与现有的 Redis 会话管理形成互补，各司其职：

| 维度 | Redis（实时热数据） | PostgreSQL（持久化冷数据） |
| --- | --- | --- |
| **定位** | 当前活跃会话的实时状态 | 所有会话的完整历史 |
| **数据内容** | 会话的 history + cost + 摘要信息（当前轮次） | 完整的消息记录、图片、成本明细、摘要历史 |
| **生命周期** | TTL 10 分钟自动清理，进程重启不保留 | 永久保存，除非软删除 |
| **性能特点** | 微秒级读写，适合高频访问 | 毫秒级读写，适合批量查询 |
| **写入时机** | 每次对话请求时实时读写 | 每轮对话完成后，异步写入 PostgreSQL（不阻塞 SSE 流式响应） |
| **读取时机** | 对话过程中获取/更新当前会话状态 | 打开历史会话列表、查看历史对话详情 |

**数据流示意：**

1. 用户发送消息 -> FastAPI 从 Redis 读取当前会话 -> 调用 AI 模型 -> SSE 流式返回
2. 对话完成后 -> FastAPI 将消息、成本等异步写入 PostgreSQL
3. 用户打开历史列表 -> FastAPI 从 PostgreSQL 查询分页数据
4. 用户点击某条历史 -> FastAPI 从 PostgreSQL 查询完整会话（含消息、图片、摘要、成本），恢复到 Redis 以支持继续对话

> **关键原则：** Redis 负责实时交互的热路径，PostgreSQL 负责数据持久化的冷路径。两者通过 `session_uuid` 关联，写入互不阻塞。

---

*AI Talking 后端重构技术方案 v2.0 | 2026-06-29 | Node.js Express -> Python FastAPI | 前端零改动*
