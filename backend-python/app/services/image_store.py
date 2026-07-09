"""
图片存储服务：将 JPEG 字节存入 PostgreSQL images 表，返回 image_uuid 供引用。
提供 data URL 重建能力，用于 Ark API 调用时嵌入图片。
"""

import time
import base64
from typing import Any

from loguru import logger

from app.core.database import get_db_pool


async def store_image(
    session_id: str,
    image_data: bytes,
    metadata: dict[str, Any] | None = None,
) -> str | None:
    """将 JPEG 图片字节存入 PostgreSQL，返回 image_uuid 字符串。
    若 PostgreSQL 未配置则返回 None，调用方应降级处理。
    """
    pool = await get_db_pool()
    if not pool:
        logger.warning("[image_store] PostgreSQL 未配置，跳过图片持久化")
        return None

    # 构建 data URL（后续 Ark API 需要这个格式）
    image_b64 = base64.b64encode(image_data).decode("ascii")
    data_url = f"data:image/jpeg;base64,{image_b64}"
    now = int(time.time() * 1000)

    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                """
                INSERT INTO images (
                    session_uuid, image_data, image_url, image_size,
                    image_width, image_height, image_quality, complexity_score,
                    created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9::double precision / 1000))
                RETURNING image_uuid
                """,
                session_id,
                image_data,
                data_url,
                (metadata or {}).get("size"),
                (metadata or {}).get("width"),
                (metadata or {}).get("height"),
                (metadata or {}).get("quality"),
                (metadata or {}).get("complexity_score"),
                now,
            )
            image_uuid = str(row["image_uuid"]) if row else None
            logger.debug(f"[image_store] 已存储图片 {image_uuid} ({len(image_data)} bytes)")
            return image_uuid
        except Exception as e:
            logger.warning(f"[image_store] 存储图片失败: {e}")
            return None


async def get_image_data_url(image_uuid: str) -> str | None:
    """根据 image_uuid 取出对应的 data URL（用于 Ark API 消息构建）。"""
    pool = await get_db_pool()
    if not pool:
        return None

    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                "SELECT image_url FROM images WHERE image_uuid::text = $1",
                image_uuid,
            )
            return row["image_url"] if row else None
        except Exception as e:
            logger.warning(f"[image_store] 读取图片 data URL 失败: {e}")
            return None


async def get_image_bytes(image_uuid: str) -> bytes | None:
    """根据 image_uuid 取出原始 JPEG 字节。"""
    pool = await get_db_pool()
    if not pool:
        return None

    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                "SELECT image_data FROM images WHERE image_uuid::text = $1",
                image_uuid,
            )
            return row["image_data"] if row else None
        except Exception as e:
            logger.warning(f"[image_store] 读取图片字节失败: {e}")
            return None


async def delete_session_images(session_id: str) -> int:
    """删除某个会话关联的所有图片（会话清理时调用）。"""
    pool = await get_db_pool()
    if not pool:
        return 0

    async with pool.acquire() as conn:
        try:
            result = await conn.execute(
                "DELETE FROM images WHERE session_uuid = $1",
                session_id,
            )
            return int(result.split()[-1]) if result else 0
        except Exception as e:
            logger.warning(f"[image_store] 删除会话图片失败: {e}")
            return 0
