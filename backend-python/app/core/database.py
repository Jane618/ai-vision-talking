import asyncpg
from loguru import logger

from app.config.settings import get_settings

_pool: asyncpg.Pool | None = None


async def get_db_pool() -> asyncpg.Pool:
    """获取 PostgreSQL 连接池（单例）。连接失败时降级为 None，不阻塞启动。"""
    global _pool
    if _pool is None:
        settings = get_settings()
        if not settings.database_url:
            logger.warning("[database] DATABASE_URL 未配置，PostgreSQL 功能不可用")
            return None
        try:
            _pool = await asyncpg.create_pool(
                settings.database_url,
                min_size=3,
                max_size=10,
            )
            logger.info("[database] PostgreSQL 连接池已创建")
        except Exception as e:
            logger.warning(f"[database] PostgreSQL 连接失败，历史会话功能不可用: {e}")
            _pool = None
    return _pool


async def close_db_pool() -> None:
    """关闭 PostgreSQL 连接池。"""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info("[database] PostgreSQL 连接池已关闭")
