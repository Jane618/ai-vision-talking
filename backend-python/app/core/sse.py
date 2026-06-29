import json
from typing import Any


def format_sse(event: str, data: Any) -> str:
    """将事件名和数据格式化为 SSE 协议字符串。"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
