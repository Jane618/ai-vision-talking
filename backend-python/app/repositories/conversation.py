from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from loguru import logger


class ConversationRepository:

    def __init__(self, pool):
        self._pool = pool

    async def create_conversation(
        self,
        user_id: int | None,
        scene_preset: str,
        quality_mode: str,
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        sql = """
        INSERT INTO conversations (user_id, scene_preset, quality_mode, system_prompt)
        VALUES ($1, $2, $3, $4)
        RETURNING id, session_uuid, created_at
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(sql, user_id, scene_preset, quality_mode, system_prompt)
            return dict(row)

    async def get_conversation_by_uuid(self, session_uuid: UUID) -> dict[str, Any] | None:
        sql = "SELECT * FROM conversations WHERE session_uuid = $1 AND is_deleted = FALSE"
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(sql, session_uuid)
            return dict(row) if row else None

    async def append_message(
        self,
        conversation_id: int,
        role: str,
        content: list[dict] | str,
        seq: int,
        content_text: str = "",
        has_image: bool = False,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        total_tokens: int | None = None,
    ) -> int:
        sql = """
        INSERT INTO messages (
            conversation_id, role, content, content_text,
            has_image, prompt_tokens, completion_tokens, total_tokens, seq
        ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
        RETURNING id
        """
        async with self._pool.acquire() as conn:
            return await conn.fetchval(
                sql,
                conversation_id, role,
                content, content_text, has_image,
                prompt_tokens, completion_tokens, total_tokens, seq,
            )

    async def save_summary(
        self,
        conversation_id: int,
        summary_text: str,
        replaced_msg_count: int,
        saved_tokens: int,
        summary_tokens: int,
        estimated_saved_cny: float,
    ) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO conversation_summaries (
                    conversation_id, summary_text, replaced_msg_count,
                    saved_tokens, summary_tokens, estimated_saved_cny
                ) VALUES ($1, $2, $3, $4, $5, $6)
                """,
                conversation_id, summary_text, replaced_msg_count,
                saved_tokens, summary_tokens, estimated_saved_cny,
            )
            await conn.execute(
                "UPDATE conversations SET summary = $1, updated_at = NOW() WHERE id = $2",
                summary_text, conversation_id,
            )

    async def record_cost(
        self,
        conversation_id: int,
        message_id: int | None,
        call_number: int,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        estimated_cost_cny: float,
        breakdown: dict | None = None,
        model_name: str | None = None,
        latency_ms: int | None = None,
    ) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO cost_records (
                    conversation_id, message_id, call_number,
                    prompt_tokens, completion_tokens, total_tokens,
                    estimated_cost_cny, system_prompt_tokens, history_tokens,
                    current_user_tokens, image_tokens, model_name, latency_ms
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                """,
                conversation_id, message_id, call_number,
                prompt_tokens, completion_tokens, total_tokens,
                estimated_cost_cny,
                breakdown.get("systemPromptTokens") if breakdown else None,
                breakdown.get("historyTokens") if breakdown else None,
                breakdown.get("currentUserTokens") if breakdown else None,
                breakdown.get("imageTokens") if breakdown else None,
                model_name, latency_ms,
            )
            await conn.execute(
                "UPDATE conversations SET total_cost_cny = total_cost_cny + $1, updated_at = NOW() WHERE id = $2",
                estimated_cost_cny, conversation_id,
            )

    async def get_conversation_for_replay(self, session_uuid: UUID) -> dict[str, Any] | None:
        async with self._pool.acquire() as conn:
            conv = await conn.fetchrow(
                "SELECT * FROM conversations WHERE session_uuid = $1 AND is_deleted = FALSE",
                session_uuid,
            )
            if not conv:
                return None
            conv_id = conv["id"]
            messages = await conn.fetch(
                "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY seq ASC", conv_id
            )
            summaries = await conn.fetch(
                "SELECT * FROM conversation_summaries WHERE conversation_id = $1 ORDER BY created_at ASC", conv_id
            )
            images = await conn.fetch(
                "SELECT * FROM images WHERE conversation_id = $1", conv_id
            )
            cost_stats = await conn.fetchrow(
                """
                SELECT COUNT(*) as call_count,
                       COALESCE(SUM(prompt_tokens), 0) as total_prompt,
                       COALESCE(SUM(completion_tokens), 0) as total_completion,
                       COALESCE(SUM(total_tokens), 0) as total_tokens,
                       COALESCE(SUM(estimated_cost_cny), 0) as total_cost
                FROM cost_records WHERE conversation_id = $1
                """, conv_id,
            )
            return {
                "conversation": dict(conv),
                "messages": [dict(m) for m in messages],
                "summaries": [dict(s) for s in summaries],
                "images": [dict(i) for i in images],
                "cost_stats": dict(cost_stats) if cost_stats else {},
            }
