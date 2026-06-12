/**
 * Express 入口与路由
 * - POST /api/multimodal: 多模态对话
 * - GET  /api/health:    健康检查
 * - POST /api/clear:     清除会话
 */

import 'dotenv/config';

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

// 中间件
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' })); // 允许较大的 base64 图像
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 日志中间件（不打印 body 以避免泄露图像 base64）
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
      return res.status(200).json({
        ok: false,
        error: '缺少 sessionId',
      });
    }
    const existed = clearSession(sessionId);
    return res.status(200).json({
      ok: true,
      cleared: existed,
      sessionId,
    });
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

    // 参数校验
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

      // 图像规范化（若有）
      const imageDataUrl = image ? normalizeImageDataUrl(image) : undefined;

      // 构造发给 Ark 的消息
      const messages = buildArkMessages({
        conv,
        userText,
        imageDataUrl,
        systemPrompt: settings.systemPrompt,
      });

      // 调用豆包
      const { replyText, usage } = await callDoubao(messages, settings);

      // 累加成本
      accumulateCost(conv, usage);

      // 将本轮写入历史（user 侧保留 text+image 的多模态结构，AI 侧为纯文本）
      if (imageDataUrl) {
        appendHistory(conv, {
          role: 'user',
          content: [
            { type: 'text', text: userText || '请描述你看到的画面。' },
            {
              type: 'image_url',
              image_url: { url: imageDataUrl, detail: 'auto' },
            },
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

      // 可选 TTS
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
      // 返回 200 但带 error 字段，避免前端 HTTP 层错误判定
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

// 启动
app.listen(PORT, () => {
  console.log(`[server] AI Talking backend 启动成功，监听端口 ${PORT}`);
  console.log(
    `[server] ARK 已配置: ${!!process.env.ARK_API_KEY && !!process.env.ARK_MODEL_ENDPOINT}`,
  );
  console.log(`[server] TTS 已配置: ${isTTSConfigured()}`);
});

export default app;
