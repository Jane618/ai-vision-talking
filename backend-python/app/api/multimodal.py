import asyncio
import base64
import time
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse, JSONResponse
from loguru import logger

from app.models.schemas import (
    MultimodalRequest,
    MultimodalResponse,
)
from app.services.session import get_session_manager
from app.services.doubao import normalize_image_data_url, call_doubao
from app.services.conversation import (
    summarize_if_needed,
    build_ark_messages,
    build_token_breakdown,
    append_history,
)
from app.services.cost import accumulate_cost, snapshot_cost
from app.services.conversation import persist_conversation_to_pg
from app.services.image_store import store_image
from app.services.tts import tts_service
from app.core.sse import format_sse

router = APIRouter()


@router.post("/api/multimodal/stream")
async def multimodal_stream(request: Request):
    body_bytes = await request.body()
    try:
        body = MultimodalRequest(**(await request.json()))
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": f"请求格式错误: {e}"})

    session_id = (body.sessionId or "").strip()
    user_text = (body.userText or "").strip()
    image = (body.image or "").strip() if body.image else None
    settings = body.settings.model_dump() if body.settings else {}

    if not session_id:
        session_id = str(uuid.uuid4())
        logger.info(f"[multimodal:stream] 自动生成 sessionId: {session_id}")

    if not user_text and not image:
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "sessionId": session_id,
                "historyCount": 0,
                "error": "userText 或 image 至少需要提供一项",
            },
        )

    sm = get_session_manager()
    if not sm:
        return JSONResponse(status_code=503, content={"ok": False, "error": "服务未就绪"})

    async def event_generator():
        try:
            conv = await sm.get_or_create(session_id)

            # 存储图片到 PostgreSQL，获取 image_uuid 用于历史引用
            image_id = None
            image_data_url = None
            if image:
                image_data_url = normalize_image_data_url(image)
                try:
                    # 从 data URL 中提取原始 JPEG 字节
                    b64_data = image
                    if "," in b64_data:
                        b64_data = b64_data.split(",", 1)[1]
                    jpeg_bytes = base64.b64decode(b64_data)
                    image_id = await store_image(session_id, jpeg_bytes)
                except Exception as e:
                    logger.warning(f"[multimodal] 图片存储失败（不影响主流程）: {e}")

            current_ctx = {
                "userText": user_text,
                "imageDataUrl": image_data_url,
                "systemPrompt": settings.get("systemPrompt"),
            }

            summary_applied = await summarize_if_needed(conv, settings, current_ctx)
            if summary_applied:
                yield format_sse("summary", summary_applied)

            messages = build_ark_messages(
                conv=conv,
                user_text=user_text,
                image_data_url=image_data_url,
                system_prompt=settings.get("systemPrompt"),
            )

            # 使用有界 Queue 实现反压：队列满时生产者阻塞，防止内存无限增长
            queue: asyncio.Queue[str | Exception | None] = asyncio.Queue(maxsize=64)

            async def _call_and_feed():
                """后台协程：调用 Ark 流式 API，将 delta 放入 queue，返回 usage。"""
                try:
                    from app.services.doubao import call_doubao_stream_raw
                    usage_result = await call_doubao_stream_raw(
                        messages, settings,
                        on_delta=lambda d: queue.put_nowait(d),
                    )
                    await queue.put(None)
                    return usage_result
                except Exception as e:
                    await queue.put_nowait(e)
                    raise

            task = asyncio.create_task(_call_and_feed())

            reply_text = ""
            try:
                while True:
                    item = await queue.get()
                    if item is None:
                        break
                    if isinstance(item, Exception):
                        raise item
                    reply_text += item
                    yield format_sse("delta", {"text": item})
            finally:
                if not task.done():
                    task.cancel()

            # 获取 usage（需要从 task 的结果中获取）
            final_usage = None
            try:
                if task.done() and not task.cancelled():
                    final_usage = task.result()
            except Exception:
                pass
            if not final_usage:
                from app.models.schemas import ArkUsage
                final_usage = ArkUsage()

            accumulate_cost(conv.cost, final_usage)
            token_breakdown = build_token_breakdown(
                conv, user_text, image_data_url, final_usage, settings.get("systemPrompt"),
            )

            if image_data_url:
                msg: dict = {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_text or "请描述你看到的画面。"},
                        {"type": "image_url", "image_url": {"url": image_data_url, "detail": "auto"}},
                    ],
                    "hasImage": True,
                    "timestamp": int(time.time() * 1000),
                }
                if image_id:
                    msg["imageId"] = image_id
                append_history(conv, msg)
            else:
                append_history(conv, {
                    "role": "user", "content": user_text,
                    "hasImage": False, "timestamp": int(time.time() * 1000),
                })
            append_history(conv, {
                "role": "assistant", "content": reply_text,
                "hasImage": False, "timestamp": int(time.time() * 1000),
            })

            await sm.save(session_id, conv)

            if not summary_applied:
                summary_applied = await summarize_if_needed(
                    conv, settings, {"systemPrompt": settings.get("systemPrompt")},
                )
                if summary_applied:
                    yield format_sse("summary", summary_applied)

            # 异步持久化到 PostgreSQL（不阻塞 SSE 响应）
            asyncio.create_task(persist_conversation_to_pg(
                session_id=session_id,
                user_text=user_text,
                reply_text=reply_text,
                has_image=bool(image_data_url),
                image_id=image_id,
                usage=final_usage,
                token_breakdown=token_breakdown,
                summary_applied=summary_applied,
                settings=settings,
            ))

            yield format_sse("done", {
                "ok": True,
                "replyText": reply_text,
                "audioBase64": None,
                "audioMimeType": None,
                "sessionId": session_id,
                "historyCount": len(conv.history),
                "usage": final_usage.model_dump(),
                "cost": snapshot_cost(conv.cost),
                "summaryApplied": summary_applied,
                "tokenBreakdown": token_breakdown.model_dump(),
            })

        except Exception as e:
            import traceback
            logger.error(f"[multimodal:stream] 异常: {e}\n{traceback.format_exc()}")
            conv_ref = await sm.get_or_create(session_id)
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


@router.post("/api/multimodal")
async def multimodal(request: Request):
    body = MultimodalRequest(**(await request.json()))

    session_id = (body.sessionId or "").strip()
    user_text = (body.userText or "").strip()
    image = (body.image or "").strip() if body.image else None
    settings = body.settings.model_dump() if body.settings else {}

    if not session_id:
        session_id = str(uuid.uuid4())

    if not user_text and not image:
        return MultimodalResponse(
            ok=False, sessionId=session_id, historyCount=0,
            error="userText 或 image 至少需要提供一项",
        )

    try:
        sm = get_session_manager()
        if not sm:
            return MultimodalResponse(ok=False, error="服务未就绪")
        conv = await sm.get_or_create(session_id)
        image_data_url = normalize_image_data_url(image) if image else None

        # 存储图片到 PostgreSQL
        image_id = None
        if image:
            try:
                b64_data = image
                if "," in b64_data:
                    b64_data = b64_data.split(",", 1)[1]
                jpeg_bytes = base64.b64decode(b64_data)
                image_id = await store_image(session_id, jpeg_bytes)
            except Exception as e:
                logger.warning(f"[multimodal] 图片存储失败（不影响主流程）: {e}")

        current_ctx = {
            "userText": user_text,
            "imageDataUrl": image_data_url,
            "systemPrompt": settings.get("systemPrompt"),
        }
        summary_applied = await summarize_if_needed(conv, settings, current_ctx)

        messages = build_ark_messages(
            conv, user_text, image_data_url, settings.get("systemPrompt"),
        )
        reply_text, usage = await call_doubao(messages, settings)
        accumulate_cost(conv.cost, usage)

        token_breakdown = build_token_breakdown(
            conv, user_text, image_data_url, usage, settings.get("systemPrompt"),
        )

        if image_data_url:
            msg: dict = {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text or "请描述你看到的画面。"},
                    {"type": "image_url", "image_url": {"url": image_data_url, "detail": "auto"}},
                ],
                "hasImage": True,
                "timestamp": int(time.time() * 1000),
            }
            if image_id:
                msg["imageId"] = image_id
            append_history(conv, msg)
        else:
            append_history(conv, {
                "role": "user", "content": user_text,
                "hasImage": False, "timestamp": int(time.time() * 1000),
            })
        append_history(conv, {
            "role": "assistant", "content": reply_text,
            "hasImage": False, "timestamp": int(time.time() * 1000),
        })

        if not summary_applied:
            summary_applied = await summarize_if_needed(
                conv, settings, {"systemPrompt": settings.get("systemPrompt")},
            )

        # 持久化到 PostgreSQL
        await persist_conversation_to_pg(
            session_id=session_id,
            user_text=user_text,
            reply_text=reply_text,
            has_image=bool(image_data_url),
            image_id=image_id,
            usage=usage,
            token_breakdown=token_breakdown,
            summary_applied=summary_applied,
            settings=settings,
        )

        audio_base64 = None
        audio_mime_type = None
        if settings.get("enableTTS", True) and reply_text:
            tts_result = await tts_service.synthesize(
                reply_text, voice_type=settings.get("voiceType"),
            )
            if tts_result:
                audio_base64 = tts_result.audio_base64
                audio_mime_type = tts_result.mime_type

        await sm.save(session_id, conv)

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
        sm = get_session_manager()
        conv_ref = await sm.get_or_create(session_id) if sm else None
        return MultimodalResponse(
            ok=False, sessionId=session_id,
            historyCount=len(conv_ref.history) if conv_ref else 0,
            cost=snapshot_cost(conv_ref.cost) if conv_ref else None,
            error=str(e),
        )
