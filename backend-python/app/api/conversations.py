import uuid as _uuid
import time as _time

from fastapi import APIRouter, Query
from loguru import logger

from app.core.database import get_db_pool
from app.models.db_models import (
    CreateConversationRequest,
    ConversationListItem,
    ConversationDetailResponse,
)
from app.models.schemas import Conversation as ConvModel, ConversationCost, HistoryMessage
from app.services.session import get_session_manager

router = APIRouter()


@router.post("/api/conversations")
async def create_conversation(body: CreateConversationRequest):
    pool = await get_db_pool()
    if not pool:
        return {"ok": False, "error": "PostgreSQL 未配置"}
    session_id = _uuid.uuid4().hex[:12]
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO conversations (session_uuid, user_id, scene_preset, quality_mode, system_prompt)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, session_uuid, created_at
            """,
            session_id, body.user_id, body.scene_preset, body.quality_mode, body.system_prompt,
        )
        return {"ok": True, "sessionUuid": str(row["session_uuid"]), "id": row["id"]}


@router.get("/api/conversations")
async def list_conversations(
    userId: int | None = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    pool = await get_db_pool()
    if not pool:
        return {"ok": False, "error": "PostgreSQL 未配置"}
    async with pool.acquire() as conn:
        if userId:
            rows = await conn.fetch(
                """
                SELECT c.session_uuid, c.title, c.scene_preset, c.summary,
                       c.total_cost_cny, c.updated_at, COUNT(m.id) as message_count
                FROM conversations c
                LEFT JOIN messages m ON m.conversation_id = c.id
                WHERE c.user_id = $1 AND c.is_deleted = FALSE
                GROUP BY c.id
                ORDER BY c.updated_at DESC
                LIMIT $2 OFFSET $3
                """,
                userId, limit, offset,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT c.session_uuid, c.title, c.scene_preset, c.summary,
                       c.total_cost_cny, c.updated_at, COUNT(m.id) as message_count
                FROM conversations c
                LEFT JOIN messages m ON m.conversation_id = c.id
                WHERE c.is_deleted = FALSE
                GROUP BY c.id
                ORDER BY c.updated_at DESC
                LIMIT $1 OFFSET $2
                """,
                limit, offset,
            )
        return {"ok": True, "conversations": [dict(r) for r in rows], "total": len(rows)}


@router.get("/api/conversations/{session_uuid}")
async def get_conversation_detail(session_uuid: str):
    pool = await get_db_pool()
    if not pool:
        return {"ok": False, "error": "PostgreSQL 未配置"}
    async with pool.acquire() as conn:
        conv = await conn.fetchrow(
            "SELECT * FROM conversations WHERE session_uuid = $1 AND is_deleted = FALSE",
            session_uuid,
        )
        if not conv:
            return {"ok": False, "error": "会话不存在"}
        conv_id = conv["id"]

        messages = await conn.fetch(
            "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY seq ASC",
            conv_id,
        )
        summaries = await conn.fetch(
            "SELECT * FROM conversation_summaries WHERE conversation_id = $1 ORDER BY created_at ASC",
            conv_id,
        )
        cost_stats = await conn.fetchrow(
            """
            SELECT COUNT(*) as call_count,
                   COALESCE(SUM(prompt_tokens), 0) as total_prompt,
                   COALESCE(SUM(completion_tokens), 0) as total_completion,
                   COALESCE(SUM(total_tokens), 0) as total_tokens,
                   COALESCE(SUM(estimated_cost_cny), 0) as total_cost
            FROM cost_records WHERE conversation_id = $1
            """,
            conv_id,
        )

        return {
            "ok": True,
            "conversation": dict(conv),
            "messages": [dict(m) for m in messages],
            "summaries": [dict(s) for s in summaries],
            "costStats": dict(cost_stats) if cost_stats else {},
        }


@router.delete("/api/conversations/{session_uuid}")
async def delete_conversation(session_uuid: str):
    pool = await get_db_pool()
    if not pool:
        return {"ok": False, "error": "PostgreSQL 未配置"}
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE conversations SET is_deleted = TRUE, updated_at = NOW() WHERE session_uuid = $1",
            session_uuid,
        )
        return {"ok": True, "deleted": result == "UPDATE 1"}


@router.post("/api/conversations/migrate")
async def migrate_conversations(body: dict):
    pool = await get_db_pool()
    if not pool:
        return {"ok": False, "error": "PostgreSQL 未配置"}
    old_uuids = body.get("sessionUuids", [])
    user_id = body.get("userId")
    if not user_id or not old_uuids:
        return {"ok": False, "error": "缺少 userId 或 sessionUuids"}

    migrated = 0
    async with pool.acquire() as conn:
        for suuid in old_uuids:
            conv = await conn.fetchrow(
                "SELECT id FROM conversations WHERE session_uuid = $1 AND is_deleted = FALSE",
                suuid,
            )
            if conv and conv["user_id"] is None:
                await conn.execute(
                    "UPDATE conversations SET user_id = $1, updated_at = NOW() WHERE id = $2",
                    user_id, conv["id"],
                )
                migrated += 1

    return {"ok": True, "migrated": migrated}


@router.post("/api/conversations/{session_uuid}/resume")
async def resume_conversation(session_uuid: str):
    """从 PG 加载历史会话，写入 Redis（复用原 sessionId），返回原 sessionId。"""
    pool = await get_db_pool()
    if not pool:
        return {"ok": False, "error": "PostgreSQL 未配置"}

    sm = get_session_manager()
    if not sm:
        return {"ok": False, "error": "会话管理器未就绪"}

    async with pool.acquire() as conn:
        conv = await conn.fetchrow(
            "SELECT * FROM conversations WHERE session_uuid = $1 AND is_deleted = FALSE",
            session_uuid,
        )
        if not conv:
            return {"ok": False, "error": "会话不存在"}

        conv_id = conv["id"]
        rows = await conn.fetch(
            "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY seq ASC",
            conv_id,
        )

        history: list[HistoryMessage] = []
        for msg in rows:
            role = msg["role"]
            content = msg["content"] if isinstance(msg["content"], str) else msg["content"]
            history.append(HistoryMessage(
                role=role,
                content=content,
                hasImage=msg["has_image"] or False,
                timestamp=int(msg["created_at"].timestamp() * 1000) if msg["created_at"] else 0,
            ))

        cost_row = await conn.fetchrow(
            """
            SELECT COUNT(*) as call_count,
                   COALESCE(SUM(prompt_tokens), 0) as total_prompt,
                   COALESCE(SUM(completion_tokens), 0) as total_completion,
                   COALESCE(SUM(total_tokens), 0) as total_tokens,
                   COALESCE(SUM(estimated_cost_cny), 0) as total_cost
            FROM cost_records WHERE conversation_id = $1
            """,
            conv_id,
        )

    # 复用原 session_uuid 写入 Redis
    restored = ConvModel(
        sessionId=session_uuid,
        history=history,
        cost=ConversationCost(
            callCount=cost_row["call_count"] if cost_row else 0,
            promptTokens=cost_row["total_prompt"] if cost_row else 0,
            completionTokens=cost_row["total_completion"] if cost_row else 0,
            totalTokens=cost_row["total_tokens"] if cost_row else 0,
            estimatedCostCNY=float(cost_row["total_cost"]) if cost_row else 0.0,
        ),
        createdAt=int(_time.time() * 1000),
        lastActiveAt=int(_time.time() * 1000),
    )

    await sm.save(session_uuid, restored)
    logger.info(f"[conversations] 恢复会话 {session_uuid}（{len(history)} 条消息）")

    return {
        "ok": True,
        "sessionId": session_uuid,
        "historyCount": len(history),
        "cost": {
            "callCount": cost_row["call_count"] if cost_row else 0,
            "promptTokens": cost_row["total_prompt"] if cost_row else 0,
            "completionTokens": cost_row["total_completion"] if cost_row else 0,
            "totalTokens": cost_row["total_tokens"] if cost_row else 0,
            "estimatedCostCNY": float(cost_row["total_cost"]) if cost_row else 0.0,
            "savedTokens": 0,
        },
    }
