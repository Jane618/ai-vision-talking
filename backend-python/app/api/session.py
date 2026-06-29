from fastapi import APIRouter

from app.models.schemas import ClearRequest, ClearResponse
from app.services.session import get_session_manager

router = APIRouter()


@router.post("/api/clear")
async def clear_session(body: ClearRequest):
    if not body.sessionId or not body.sessionId.strip():
        return ClearResponse(ok=False, error="缺少 sessionId")
    sm = get_session_manager()
    if not sm:
        return ClearResponse(ok=False, error="服务未就绪", sessionId=body.sessionId)
    existed = await sm.clear_session(body.sessionId.strip())
    return ClearResponse(ok=True, cleared=existed, sessionId=body.sessionId.strip())
