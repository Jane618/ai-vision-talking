from datetime import datetime, timezone

from fastapi import APIRouter

from app.models.schemas import HealthResponse
from app.services.session import get_session_manager
from app.services.tts import tts_service

router = APIRouter()


@router.get("/api/health")
async def health_check():
    sm = get_session_manager()
    session_count = 0
    if sm:
        session_count = await sm.get_session_count()
    return HealthResponse(
        status="ok",
        serverTime=datetime.now(timezone.utc).isoformat(),
        sessionCount=session_count,
        ttsConfigured=tts_service.is_configured(),
    )
