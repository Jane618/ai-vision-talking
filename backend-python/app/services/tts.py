import json
import time
from dataclasses import dataclass

import httpx
from loguru import logger

from app.config.settings import get_settings


@dataclass
class TTSResult:
    audio_base64: str
    mime_type: str


class TTSService:

    def __init__(self):
        self._configured: bool | None = None

    def is_configured(self) -> bool:
        if self._configured is None:
            cfg = get_settings()
            self._configured = bool(cfg.volc_tts_app_id and cfg.volc_tts_access_token)
        return self._configured

    async def synthesize(
        self,
        text: str,
        voice_type: str | None = None,
    ) -> TTSResult | None:
        if not text or not text.strip():
            return None
        if not self.is_configured():
            logger.info("[tts] 未配置 TTS 凭证，跳过。前端将使用浏览器内置 TTS。")
            return None

        cfg = get_settings()
        input_text = text[:1024]
        voice = voice_type or cfg.volc_tts_voice_type or "BV001_streaming"

        body = {
            "app": {
                "appid": cfg.volc_tts_app_id,
                "token": cfg.volc_tts_access_token,
                "cluster": cfg.volc_tts_cluster or "volcano_tts",
            },
            "user": {"uid": "ai-talking-user"},
            "audio": {
                "voice_type": voice,
                "encoding": "mp3",
                "speed_ratio": 1.0,
                "volume_ratio": 1.0,
                "pitch_ratio": 1.0,
            },
            "request": {
                "reqid": f"req_{int(time.time() * 1000)}_{int(time.time() * 1000) % 1000000}",
                "text": input_text,
                "text_type": "plain",
                "operation": "query",
            },
        }

        try:
            logger.info(f"[tts] 调用火山 TTS: voice={voice}, textLen={len(input_text)}")
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    "https://openspeech.bytedance.com/api/v1/tts",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer;{cfg.volc_tts_access_token}",
                    },
                    json=body,
                )
                if resp.status_code != 200:
                    logger.warning(f"[tts] 失败 {resp.status_code}: {resp.text[:200]}")
                    return None

                data = resp.json()
                base64_audio = data.get("data")
                if not base64_audio:
                    logger.warning("[tts] 响应中没有 data 字段")
                    return None

                logger.info(f"[tts] 合成完成, base64 len={len(base64_audio)}")
                return TTSResult(audio_base64=base64_audio, mime_type="audio/mpeg")

        except Exception as e:
            logger.warning(f"[tts] 调用异常: {e}")
            return None


tts_service = TTSService()
