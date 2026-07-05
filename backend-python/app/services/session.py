import json
import time
from typing import Optional

from redis.asyncio import Redis
from loguru import logger

from app.models.schemas import Conversation, ConversationCost, HistoryMessage

SESSION_KEY_PREFIX = "session:"
SESSION_TTL_SECONDS = 10 * 60


class SessionManager:

    def __init__(self, redis: Redis):
        self._redis = redis

    def _key(self, session_id: str) -> str:
        return f"{SESSION_KEY_PREFIX}{session_id}"

    async def get_or_create(self, session_id: str) -> Conversation:
        key = self._key(session_id)
        data = await self._redis.hgetall(key)
        if data:
            conv = self._deserialize(data)
            conv.lastActiveAt = int(time.time() * 1000)
            await self._save(key, conv)
            return conv

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
        key = self._key(session_id)
        data = await self._redis.hgetall(key)
        if not data:
            return None
        conv = self._deserialize(data)
        conv.lastActiveAt = int(time.time() * 1000)
        await self._save(key, conv)
        return conv

    async def save(self, session_id: str, conv: Conversation) -> None:
        key = self._key(session_id)
        await self._save(key, conv)

    async def clear_session(self, session_id: str) -> bool:
        key = self._key(session_id)
        existed = await self._redis.exists(key)
        if existed:
            await self._redis.delete(key)
            logger.info(f"[session] 清除会话 {session_id}")
        return bool(existed)

    async def get_session_count(self) -> int:
        pattern = f"{SESSION_KEY_PREFIX}*"
        count = 0
        async for _ in self._redis.scan_iter(match=pattern):
            count += 1
        return count

    async def _save(self, key: str, conv: Conversation) -> None:
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
        # decode_responses=True 时 key/value 均为 str，兼容 bytes（decode_responses=False）
        def _get(key: str, default: str = "") -> str:
            val = data.get(key) or data.get(key.encode(), default)
            return val.decode("utf-8") if isinstance(val, bytes) else val

        history_data = json.loads(_get("history", "[]"))
        cost_data = json.loads(_get("cost", "{}"))
        history = [HistoryMessage(**m) for m in history_data]
        cost = ConversationCost(**cost_data)

        last_summary = None
        raw_last_summary = _get("lastSummaryAt", "")
        if raw_last_summary:
            last_summary = int(raw_last_summary)

        session_id = _get("sessionId", "")
        created_at = int(_get("createdAt", "0"))
        last_active_at = int(_get("lastActiveAt", "0"))

        return Conversation(
            sessionId=session_id,
            history=history,
            cost=cost,
            createdAt=created_at,
            lastActiveAt=last_active_at,
            lastSummaryAt=last_summary,
        )


session_manager: SessionManager | None = None


async def init_session_manager(redis: Redis) -> SessionManager:
    global session_manager
    session_manager = SessionManager(redis)
    return session_manager


def get_session_manager() -> SessionManager | None:
    return session_manager
