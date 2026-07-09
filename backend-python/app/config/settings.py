from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """应用配置，从环境变量加载。"""

    # 服务配置
    server_port: int = 8000
    server_host: str = "0.0.0.0"

    # 火山引擎 Ark API
    ark_api_key: str = ""
    ark_api_keys: list[str] = []  # 多 Key 轮转，逗号分隔
    ark_model_endpoint: str = ""
    # 摘要模型（可选纯文本小模型，留空复用主模型）
    ark_summary_api_key: str = ""
    ark_summary_model_endpoint: str = ""

    # 火山引擎 TTS（可选）
    volc_tts_app_id: str = ""
    volc_tts_access_token: str = ""
    volc_tts_cluster: str = "volcano_tts"
    volc_tts_voice_type: str = "BV001_streaming"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # PostgreSQL
    database_url: str = ""

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
