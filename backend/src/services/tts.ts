/**
 * 火山引擎 TTS (语音合成) 封装
 * - 若未配置 VOLC_TTS_APP_ID / VOLC_TTS_ACCESS_TOKEN，则返回 null
 * - 前端检测到 audioBase64 为 null 时，使用浏览器内置 SpeechSynthesis 回退
 * - 返回 base64 编码的音频数据
 */

import fetch from 'node-fetch';

export interface TTSResult {
  audioBase64: string;
  mimeType: string;
}

export interface TTSSettings {
  voiceType?: string;
  speedRatio?: number; // 0.5 - 2.0
  volumeRatio?: number; // 0.1 - 3.0
}

/** 是否配置了有效的火山引擎 TTS 凭证 */
export function isTTSConfigured(): boolean {
  const appId = process.env.VOLC_TTS_APP_ID;
  const token = process.env.VOLC_TTS_ACCESS_TOKEN;
  return !!(appId && token);
}

/**
 * 调用火山引擎 TTS。若未配置凭证或调用失败，返回 null（让前端走浏览器内置 TTS）。
 */
export async function synthesize(
  text: string,
  settings?: TTSSettings,
): Promise<TTSResult | null> {
  if (!text || !text.trim()) return null;
  if (!isTTSConfigured()) {
    console.log('[tts] 未配置火山引擎 TTS 凭证，跳过 TTS，前端将使用浏览器内置 TTS 回退。');
    return null;
  }

  const appId = process.env.VOLC_TTS_APP_ID as string;
  const accessToken = process.env.VOLC_TTS_ACCESS_TOKEN as string;
  const cluster = process.env.VOLC_TTS_CLUSTER || 'volcano_tts';
  const voiceType =
    settings?.voiceType || process.env.VOLC_TTS_VOICE_TYPE || 'BV001_streaming';

  // 截断超长文本，避免 TTS 失败
  const inputText = text.length > 1024 ? text.slice(0, 1024) : text;

  const body = {
    app: {
      appid: appId,
      token: accessToken,
      cluster,
    },
    user: {
      uid: 'ai-talking-user',
    },
    audio: {
      voice_type: voiceType,
      encoding: 'mp3',
      speed_ratio: settings?.speedRatio ?? 1.0,
      volume_ratio: settings?.volumeRatio ?? 1.0,
      pitch_ratio: 1.0,
    },
    request: {
      reqid: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text: inputText,
      text_type: 'plain',
      operation: 'query',
    },
  };

  try {
    console.log(
      `[tts] 调用火山 TTS: voice=${voiceType}, textLen=${inputText.length}`,
    );
    const resp = await fetch('https://openspeech.bytedance.com/api/v1/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer;${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(`[tts] 失败 ${resp.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = (await resp.json()) as any;
    const base64: string | undefined = data?.data;
    if (!base64) {
      console.warn('[tts] 响应中没有 data 字段');
      return null;
    }
    console.log(`[tts] 合成完成, base64 len=${base64.length}`);
    return {
      audioBase64: base64,
      mimeType: 'audio/mpeg',
    };
  } catch (err) {
    console.warn('[tts] 调用异常:', (err as Error).message);
    return null;
  }
}
