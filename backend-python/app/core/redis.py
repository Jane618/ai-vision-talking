from redis.asyncio import Redis, ConnectionPool
from loguru import logger

from app.config.settings import get_settings

_pool: ConnectionPool | None = None


async def get_redis_pool() -> Redis:
    """获取 Redis 连接池（单例）。"""
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = ConnectionPool.from_url(settings.redis_url, decode_responses=True)
        logger.info(f"[redis] 连接池已创建: {settings.redis_url}")
    return Redis(connection_pool=_pool)


async def close_redis_pool() -> None:
    """关闭 Redis 连接池。"""
    global _pool
    if _pool:
        await _pool.disconnect()
        _pool = None
        logger.info("[redis] 连接池已关闭")
