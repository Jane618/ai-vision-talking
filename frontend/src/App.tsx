import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatHistory } from './components/ChatHistory';
import { CostStats } from './components/CostStats';
import { SettingsPanel } from './components/SettingsPanel';
import { VideoPreview } from './components/VideoPreview';
import { useASR } from './hooks/useASR';
import { useCamera } from './hooks/useCamera';
import { useConversation } from './hooks/useConversation';
import { captureFrame } from './video/frameSampler';
import { isCapacitor } from './platform';
import { saveApiConfig, loadApiConfig, type ApiConfig } from './api/apiConfig';

/**
 * 中断播报关键词列表
 */
const STOP_SPEAKING_KEYWORDS = ['停止', '停一下', '别讲了', '别说话', '别说了', '停', '闭嘴', '暂停播报', '停止播报'];

function containsStopKeyword(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  return STOP_SPEAKING_KEYWORDS.some((kw) => t.includes(kw));
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

/**
 * API Key 设置面板（原生 App 场景）
 * 用户可以直接在界面上输入火山引擎的 API Key 和 Model Endpoint，
 * 无需通过 .env / 打包配置。
 */
function ApiKeySettings({
  onClose,
  onSave,
}: { onClose: () => void; onSave: (cfg: ApiConfig) => void }) {
  const existing = loadApiConfig();
  const [apiKey, setApiKey] = useState(existing.apiKey || '');
  const [endpoint, setEndpoint] = useState(existing.endpoint || '');
  const [showKey, setShowKey] = useState(false);

  const handleSave = () => {
    const cfg: ApiConfig = {
      apiKey: apiKey.trim(),
      endpoint: endpoint.trim(),
    };
    saveApiConfig(cfg);
    onSave(cfg);
    onClose();
  };

  return (
    <div className="api-modal" role="dialog" aria-label="API Key 设置">
      <div className="api-modal__content">
        <h2 className="api-modal__title">API Key 设置</h2>
        <p className="api-modal__hint">
          在火山引擎控制台创建多模态模型后，把 API Key 和 Endpoint 填在这里。
          数据仅保存在本机浏览器。
        </p>
        <label className="api-modal__label">
          API Key
          <div className="api-modal__input-wrap">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="例如：xxxxxxxxx"
              className="api-modal__input"
            />
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setShowKey((s) => !s)}
              style={{ minWidth: 0, padding: '6px 10px' }}
            >
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
        </label>
        <label className="api-modal__label">
          Model Endpoint
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="例如：doubao-vision-128k-chat"
            className="api-modal__input"
          />
        </label>
        <div className="api-modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>取消</button>
          <button type="button" className="btn btn--primary" onClick={handleSave} disabled={!apiKey.trim() || !endpoint.trim()}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState({
    frameIntervalMs: 3000,
    imageQuality: 0.8,
    imageSize: 512,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [inputText, setInputText] = useState('');
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [showApiPanel, setShowApiPanel] = useState(false);
  const [apiConfigured, setApiConfigured] = useState(() => {
    const c = loadApiConfig();
    return !!(c.apiKey && c.endpoint);
  });

  const { videoRef, isReady: cameraReady, error: cameraError, start: startCamera, stop: stopCamera } = useCamera();

  const prevImageDataRef = useRef<ImageData | null>(null);
  const currentFrameRef = useRef<string | null>(null);
  useEffect(() => { currentFrameRef.current = currentFrame; }, [currentFrame]);

  const {
    messages, isSending, isSpeaking, error: convError, cost, sessionId,
    sendMessage, clearMessages, resetSession, stopSpeaking,
  } = useConversation({
    settings,
    getCurrentFrame: () => currentFrameRef.current || undefined,
  });

  const {
    start: startASR, stop: stopASR, isListening, isSupported: asrSupported, interimText,
  } = useASR({
    lang: 'zh-CN',
    silenceMs: 1200,
    onSentenceEnd: (text) => {
      if (containsStopKeyword(text)) { stopSpeaking(); return; }
      const frameForSend = currentFrameRef.current || undefined;
      sendMessage(text, frameForSend);
    },
  });

  // 把实时识别文本显示到输入框
  useEffect(() => { if (isListening) setInputText(interimText || ''); }, [interimText, isListening]);

  // 画面抽帧
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(async () => {
      const video = videoRef.current;
      if (!video || !cameraReady) return;
      try {
        const { base64, changed, imageData } = await captureFrame(
          video,
          { imageSize: settings.imageSize, imageQuality: settings.imageQuality },
          prevImageDataRef.current,
        );
        if (changed) {
          prevImageDataRef.current = imageData;
          setCurrentFrame(base64);
        }
      } catch { /* ignore */ }
    }, settings.frameIntervalMs);
    return () => window.clearInterval(id);
  }, [isRunning, settings, videoRef, cameraReady]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;
    const frameForSend = currentFrameRef.current || undefined;
    setInputText('');
    await sendMessage(text, frameForSend);
  }, [inputText, sendMessage]);

  const handleToggleRunning = () => setIsRunning((v) => !v);
  const handleToggleListening = () => { isListening ? stopASR() : startASR(); };
  const handleToggleCamera = () => { cameraReady ? stopCamera() : startCamera(); };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">AI Talking · 多模态语音对话</h1>
        <div className="app__hint">
          {isCapacitor() ? '📱 原生模式' : '🌐 浏览器模式'}
          {isCapacitor() && !apiConfigured && (
            <button type="button" className="btn btn--primary" style={{ marginLeft: 8 }} onClick={() => setShowApiPanel(true)}>
              ⚙ 配置 API Key
            </button>
          )}
        </div>
      </header>

      <main className="app__grid">
        <section className="app__left">
          <VideoPreview
            videoRef={videoRef}
            isReady={cameraReady}
            error={cameraError}
            isRecording={isListening}
            currentFrame={currentFrame}
            cameraDisabled={!cameraReady}
            onToggleCamera={handleToggleCamera}
          />
        </section>

        <section className="app__right">
          <ChatHistory messages={messages} isSending={isSending} onClear={clearMessages} onResetSession={resetSession} />

          <div className="input-bar">
            <input
              type="text"
              className="input"
              placeholder="输入消息后按 Enter 发送，或点击右侧「语音输入」"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSending}
            />
            <button
              type="button"
              className={`btn btn--with-icon ${isListening ? 'btn--danger' : 'btn--primary'}`}
              onClick={handleToggleListening}
              disabled={!asrSupported || isSending}
              title={asrSupported ? '开启/关闭语音识别' : '当前浏览器不支持语音识别'}
            >
              <MicIcon className="btn__icon" />
              <span>{isListening ? '停止语音' : '语音输入'}</span>
            </button>
            {isSpeaking && (
              <button type="button" className="btn btn--warning btn--with-icon" onClick={stopSpeaking}
                title="停止当前 AI 语音播报（也可以说「停止」）">
                <span>⏹</span><span>停止播报</span>
              </button>
            )}
            <button type="button" className="btn btn--primary" onClick={handleSend} disabled={isSending}>发送</button>
          </div>

          <div className="app__bottom">
            <SettingsPanel settings={settings} onChange={setSettings} isRunning={isRunning} onToggleRunning={handleToggleRunning} />
            <CostStats cost={cost} sessionId={sessionId} />
          </div>
        </section>
      </main>

      {convError && (
        <footer className="app__footer"><div className="error">{convError}</div></footer>
      )}

      {showApiPanel && (
        <ApiKeySettings
          onClose={() => setShowApiPanel(false)}
          onSave={(cfg) => { setApiConfigured(!!(cfg.apiKey && cfg.endpoint)); }}
        />
      )}
    </div>
  );
}
