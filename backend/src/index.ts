/**
 * Express 入口与路由
 *
 * 同时托管前端静态资源（frontend/dist）+ 提供 /api/* 后端接口，
 * 这样手机 / 桌面端只要访问一个 HTTPS 入口（https://<IP>:3001）就能
 * - 拿到前端页面（/ 或任意非 /api 的路径会 fallback 到 index.html）
 * - 调 /api/health、/api/multimodal、/api/clear
 *
 * 环境变量：
 *   SERVER_PORT          默认 3001
 *   SERVER_HOST          默认 0.0.0.0（允许同局域网访问）；可改为 127.0.0.1 仅本地
 *   SERVER_CERT_FILE     HTTPS 证书路径（可选，不提供则走 HTTP）
 *   SERVER_KEY_FILE      HTTPS 私钥路径（可选）
 *   SERVER_FRONTEND_DIR  前端构建产物目录，默认 ../frontend/dist（相对 backend/）
 *   ARK_API_KEY          豆包多模态模型 API Key
 *   ARK_MODEL_ENDPOINT   豆包多模态模型 endpoint
 *   VOLC_TTS_*           火山引擎 TTS（可选）
 */

import 'dotenv/config';

import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';

import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

import {
  callDoubao,
  callDoubaoStream,
  normalizeImageDataUrl,
} from './services/doubao';
import { isTTSConfigured, synthesize } from './services/tts';
import {
  accumulateCost,
  appendHistory,
  buildArkMessages,
  buildTokenBreakdown,
  clearSession,
  getOrCreateSession,
  getSessionCount,
  snapshotCost,
  summarizeIfNeeded,
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

// 前端构建产物目录：
//   开发态（backend 仓库与 frontend 仓库同级）：
//     <repo>/backend/src/index.ts → dist/index.js → <repo>/backend/dist
//     frontend/dist 相对 backend 就是 ../frontend/dist
//   也可以用 SERVER_FRONTEND_DIR 显式覆盖
const FRONTEND_DIR =
  process.env.SERVER_FRONTEND_DIR ||
  path.resolve(__dirname, '..', '..', 'frontend', 'dist');

// 中间件
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 日志中间件
app.use((req, _res, next) => {
  console.log(`[http] ${req.method} ${req.path}`);
  next();
});

// 托管前端静态产物（index.html、CSS、JS、manifest 等）
// - /assets/*、/manifest.json、/icon-*.png 等静态文件走 express.static
// - 不存在的路径（例如用户刷新 / 时）fallback 到 index.html，支持 SPA 路由
if (fs.existsSync(FRONTEND_DIR)) {
  console.log(`[server] 前端静态目录: ${FRONTEND_DIR}`);
  app.use(
    express.static(FRONTEND_DIR, {
      index: 'index.html',
      maxAge: '1m',
      setHeaders: (res, filePath) => {
        // 带 hash 的 js/css 可长缓存；其它按默认处理
        if (/\.[a-f0-9]{8,}\.(js|css)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  // SPA fallback：任何非 /api/* 的 GET 请求未命中静态文件 → 返回 index.html
  app.get('*', (req: Request, res: Response, next) => {
    if (req.path.startsWith('/api/')) return next();
    const indexHtml = path.join(FRONTEND_DIR, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.sendFile(indexHtml);
    } else {
      res.status(404).json({ ok: false, error: 'Not Found' });
    }
  });
} else {
  console.warn(
    `[server] ⚠️  前端静态目录不存在: ${FRONTEND_DIR}。请先在 frontend 下执行 npm run build。`,
  );
}

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

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** 多模态对话（文本流式响应） */
app.post('/api/multimodal/stream', async (req: Request, res: Response) => {
  const body = (req.body || {}) as MultimodalRequestBody;

  let sessionId = body.sessionId?.trim();
  const userText = (body.userText || '').trim();
  const image = body.image?.trim();
  const settings = body.settings || {};

  if (!sessionId) {
    sessionId = uuidv4();
    console.log(`[multimodal:stream] 客户端未传 sessionId，自动生成: ${sessionId}`);
  }
  if (!userText && !image) {
    return res.status(400).json({
      ok: false,
      sessionId,
      historyCount: 0,
      error: 'userText 或 image 至少需要提供一项',
    });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    const conv = getOrCreateSession(sessionId);
    const imageDataUrl = image ? normalizeImageDataUrl(image) : undefined;

    const summaryApplied = await summarizeIfNeeded(conv, settings, {
      userText,
      imageDataUrl,
      systemPrompt: settings.systemPrompt,
    });

    if (summaryApplied) {
      writeSse(res, 'summary', summaryApplied);
    }

    const messages = buildArkMessages({
      conv,
      userText,
      imageDataUrl,
      systemPrompt: settings.systemPrompt,
    });

    const { replyText, usage } = await callDoubaoStream(
      messages,
      settings,
      (delta) => writeSse(res, 'delta', { text: delta }),
    );
    accumulateCost(conv, usage);

    const tokenBreakdown = buildTokenBreakdown({
      conv,
      userText,
      imageDataUrl,
      usage,
      systemPrompt: settings.systemPrompt,
    });

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

    writeSse(res, 'done', {
      ok: true,
      replyText,
      audioBase64: null,
      audioMimeType: null,
      sessionId,
      historyCount: conv.history.length,
      usage,
      cost: snapshotCost(conv.cost),
      summaryApplied,
      tokenBreakdown,
    });
    res.end();
  } catch (err) {
    console.error('[multimodal:stream] 异常:', err);
    const convRef = getOrCreateSession(sessionId);
    writeSse(res, 'error', {
      ok: false,
      sessionId,
      historyCount: convRef.history.length,
      cost: snapshotCost(convRef.cost),
      error: (err as Error).message || '未知错误',
    });
    res.end();
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

      // 🆕 先检查是否需要摘要（在构造 messages 之前，这样
      // 构造的历史会是摘要替换后的）。
      const summaryApplied = await summarizeIfNeeded(conv, settings, {
        userText,
        imageDataUrl,
        systemPrompt: settings.systemPrompt,
      });

      const messages = buildArkMessages({
        conv,
        userText,
        imageDataUrl,
        systemPrompt: settings.systemPrompt,
      });

      const { replyText, usage } = await callDoubao(messages, settings);
      accumulateCost(conv, usage);

      // 🆕 构建本次请求的 tokens 拆解（在 appendHistory 之前，基于调用时的历史）
      const tokenBreakdown = buildTokenBreakdown({
        conv,
        userText,
        imageDataUrl,
        usage,
        systemPrompt: settings.systemPrompt,
      });

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
        summaryApplied,
        tokenBreakdown,
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
