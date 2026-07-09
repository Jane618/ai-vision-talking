"""图片服务路由：提供 image_uuid 到 JPEG 字节的查询与访问。"""

from fastapi import APIRouter
from fastapi.responses import Response, JSONResponse
from loguru import logger

from app.services.image_store import get_image_bytes

router = APIRouter()


@router.get("/api/images/{image_uuid}")
async def serve_image(image_uuid: str):
    """通过 image_uuid 返回 JPEG 图片。"""
    data = await get_image_bytes(image_uuid)
    if data is None:
        return JSONResponse(status_code=404, content={"ok": False, "error": "图片不存在"})
    return Response(content=data, media_type="image/jpeg")
