"""Ark API Key 轮转器。多 Key 轮转，避免单 Key 被限流。"""

import asyncio
from typing import List

from loguru import logger


class KeyRotator:
    """Round-robin Key 选择器。"""

    def __init__(self, keys: List[str] | None = None):
        self._keys = keys or []
        self._index = 0
        self._lock = asyncio.Lock()

    async def get_key(self) -> str | None:
        if not self._keys:
            return None
        async with self._lock:
            key = self._keys[self._index]
            self._index = (self._index + 1) % len(self._keys)
            return key

    def is_configured(self) -> bool:
        return len(self._keys) > 0


# 全局单例
_key_rotator: KeyRotator | None = None


def init_key_rotator(keys: List[str]) -> KeyRotator:
    global _key_rotator
    _key_rotator = KeyRotator(keys)
    logger.info(f"[key_rotator] 已初始化，{len(keys)} 个 Key")
    return _key_rotator


def get_key_rotator() -> KeyRotator | None:
    return _key_rotator
