from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger

from app.api.health import router as health_router
from app.api.multimodal import router as multimodal_router
from app.api.session import router as session_router
from app.api.conversations import router as conversations_router
from app.core.redis import get_redis_pool, close_redis_pool
from app.core.database import get_db_pool, close_db_pool
from app.config.settings import get_settings
from app.services.session import init_session_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化连接，关闭时清理。"""
    logger.info("[main] AI Talking FastAPI 后端启动中...")
    redis = await get_redis_pool()
    await init_session_manager(redis)
    await get_db_pool()
    settings = get_settings()
    logger.info(f"[main] ARK 已配置: {bool(settings.ark_api_key and settings.ark_model_endpoint)}")
    logger.info(f"[main] TTS 已配置: {bool(settings.volc_tts_app_id and settings.volc_tts_access_token)}")
    logger.info(f"[main] Redis: {settings.redis_url}")
    logger.info(f"[main] PostgreSQL: {'已配置' if settings.database_url else '未配置'}")
    logger.info("[main] 启动完成")
    yield
    await close_db_pool()
    await close_redis_pool()
    logger.info("[main] AI Talking FastAPI 后端已关闭")


app = FastAPI(
    title="AI Talking Backend",
    description="AI Talking 后端 API - Python FastAPI + 豆包多模态",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(health_router)
app.include_router(multimodal_router)
app.include_router(session_router)
app.include_router(conversations_router)


@app.exception_handler(404)
async def not_found_handler(request, exc):
    return JSONResponse(status_code=404, content={"ok": False, "error": "Not Found"})
