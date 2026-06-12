/**
 * Express 入口与路由
 *
 * 环境变量：
 *   SERVER_PORT          默认 3001
 *   SERVER_HOST          默认 0.0.0.0（允许同局域网访问）；可改为 127.0.0.1 仅本地
 *   SERVER_CERT_FILE     HTTPS 证书路径（可选）
 *   SERVER_KEY_FILE      HTTPS 私钥路径（可选）
 *   ARK_API_KEY          豆包多模态模型 API Key
 *   ARK_MODEL_ENDPOINT   豆包多模态模型 endpoint
 *   VOLC_TTS_*           火山引擎 TTS（可选）
 */

import 'dotenv/config';

import fs from 'fs';
import http from 'http';
import https from 'https';

import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

import {
  callDoubao,
  normalizeImageDataUrl,
} from './services/doubao';
import { isTTSConfigured, synthesize } from './services/tts';
import {
  accumulateCost,
  appendHistory,
  buildArkMessages,
  clearSession,
  getOrCreateSession,
  getSessionCount,
  snapshotCost,
} from './services/conversation';
import type {
  ClearRequestBody,
  MultimodalRequestBody,
  MultimodalResponseBody,
} from './types';

const app = express();
const PORT = Number(process.env.SERVER_PORT || 3001);
const HOST = process.env.SERVER_HOST || '0.0.0.0';
const CERT_FILE = process.env.SERVER_CERT_FILE || '';
const KEY_FILE = process.env.SERVER_KEY_FILE || '';

// 中间件
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 日志中间件
app.use((req, _res, next) => {
  console.log(`[http] ${req.method} ${req.path}`);
  next();
});

/** 健康检查 */
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    serverTime: new Date().toISOString(),
    sessionCount: getSessionCount(),
    ttsConfigured: isTTSConfigured(),
  });
});

/** 清除会话 */
app.post('/api/clear', (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as ClearRequestBody;
    let sessionId = body.sessionId?.trim();
    if (!sessionId) {
      return res.status(200).json({ ok: false, error: '缺少 sessionId' });
    }
    const existed = clearSession(sessionId);
    return res.status(200).json({ ok: true, cleared: existed, sessionId });
  } catch (err) {
    console.error('[clear] 异常:', err);
    return res.status(200).json({
      ok: false,
      error: (err as Error).message || '未知错误',
    });
  }
});

/** 多模态对话 */
app.post(
  '/api/multimodal',
  async (req: Request, res: Response<MultimodalResponseBody>) => {
    const body = (req.body || {}) as MultimodalRequestBody;

    let sessionId = body.sessionId?.trim();
    const userText = (body.userText || '').trim();
    const image = body.image?.trim();
    const settings = body.settings || {};

    if (!sessionId) {
      sessionId = uuidv4();
      console.log(`[multimodal] 客户端未传 sessionId，自动生成: ${sessionId}`);
    }
    if (!userText && !image) {
      return res.status(200).json({
        ok: false,
        sessionId,
        historyCount: 0,
        error: 'userText 或 image 至少需要提供一项',
      });
    }

    try {
      const conv = getOrCreateSession(sessionId);
      const imageDataUrl = image ? normalizeImageDataUrl(image) : undefined;

      const messages = buildArkMessages({
        conv,
        userText,
        imageDataUrl,
        systemPrompt: settings.systemPrompt,
      });

      const { replyText, usage } = await callDoubao(messages, settings);
      accumulateCost(conv, usage);

      if (imageDataUrl) {
        appendHistory(conv, {
          role: 'user',
          content: [
            { type: 'text', text: userText || '请描述你看到的画面。' },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'auto' } },
          ],
          hasImage: true,
          timestamp: Date.now(),
        });
      } else {
        appendHistory(conv, {
          role: 'user',
          content: userText,
          hasImage: false,
          timestamp: Date.now(),
        });
      }
      appendHistory(conv, {
        role: 'assistant',
        content: replyText,
        hasImage: false,
        timestamp: Date.now(),
      });

      let audioBase64: string | null = null;
      let audioMimeType: string | null = null;
      if (settings.enableTTS !== false && replyText) {
        const ttsRes = await synthesize(replyText, {
          voiceType: settings.voiceType,
        });
        if (ttsRes) {
          audioBase64 = ttsRes.audioBase64;
          audioMimeType = ttsRes.mimeType;
        }
      }

      return res.status(200).json({
        ok: true,
        replyText,
        audioBase64,
        audioMimeType,
        sessionId,
        historyCount: conv.history.length,
        usage,
        cost: snapshotCost(conv.cost),
      });
    } catch (err) {
      console.error('[multimodal] 异常:', err);
      const convRef = getOrCreateSession(sessionId);
      return res.status(200).json({
        ok: false,
        sessionId,
        historyCount: convRef.history.length,
        cost: snapshotCost(convRef.cost),
        error: (err as Error).message || '未知错误',
      });
    }
  },
);

// 全局兜底（404）
app.use((_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: 'Not Found' });
});

// 启动：优先 HTTPS（若同时提供 cert + key），否则 HTTP
const useHttps =
  CERT_FILE && KEY_FILE && fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE);

let server: http.Server | https.Server;
if (useHttps) {
  const options = {
    cert: fs.readFileSync(CERT_FILE),
    key: fs.readFileSync(KEY_FILE),
  };
  server = https.createServer(options, app);
} else {
  server = http.createServer(app);
}

server.listen(PORT, HOST, () => {
  const scheme = useHttps ? 'https' : 'http';
  console.log(`[server] AI Talking backend 启动成功：${scheme}://${HOST}:${PORT}`);
  console.log(
    `[server] ARK 已配置: ${!!process.env.ARK_API_KEY && !!process.env.ARK_MODEL_ENDPOINT}`,
  );
  console.log(`[server] TTS 已配置: ${isTTSConfigured()}`);
});

export default app;
