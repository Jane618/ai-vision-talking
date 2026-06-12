import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatHistory } from './components/ChatHistory';
import { CostStats } from './components/CostStats';
import { SettingsPanel } from './components/SettingsPanel';
import { VideoPreview } from './components/VideoPreview';
import { useASR } from './hooks/useASR';
import { useCamera } from './hooks/useCamera';
import { useConversation } from './hooks/useConversation';
import type { MultimodalSettings } from './api/client';
import { captureFrame } from './video/frameSampler';

/**
 * 话筒图标（Feather Icons · Mic）
 */
function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

/**
 * 主组件：
 * - 左侧：视频预览 + 当前抽帧缩略图
 * - 右上：对话历史
 * - 右下：设置面板 + 成本统计
 * - 底部：文本输入框（回车发送），支持语音输入
 */
export default function App() {
  const [settings, setSettings] = useState<MultimodalSettings>({
    frameIntervalMs: 3000,
    imageQuality: 0.8,
    imageSize: 512,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [inputText, setInputText] = useState('');
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);

  const { videoRef, isReady: cameraReady, error: cameraError, start: startCamera, stop: stopCamera } =
    useCamera();

  // 上一次发送的 ImageData，用于判断画面是否变化
  const prevImageDataRef = useRef<ImageData | null>(null);
  const currentFrameRef = useRef<string | null>(null);
  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  const {
    messages,
    isSending,
    error: convError,
    cost,
    sessionId,
    sendMessage,
    clearMessages,
    resetSession,
  } = useConversation({
    settings,
    getCurrentFrame: () => currentFrameRef.current || undefined,
  });

  // 语音识别：静音结束 -> 直接发送
  const {
    start: startASR,
    stop: stopASR,
    isListening,
    isSupported: asrSupported,
    interimText,
  } = useASR({
    lang: 'zh-CN',
    silenceMs: 1200,
    onSentenceEnd: (text) => {
      const frameForSend = currentFrameRef.current || undefined;
      sendMessage(text, frameForSend);
    },
  });

  // 运行中：按 frameIntervalMs 周期抽帧，并在有变化时更新 currentFrame
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
      } catch {
        /* 抽帧失败忽略，下一帧继续 */
      }
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

  const handleToggleRunning = () => {
    setIsRunning((v) => !v);
  };

  const handleToggleListening = () => {
    if (isListening) {
      stopASR();
    } else {
      startASR();
    }
  };

  const handleToggleCamera = () => {
    if (cameraReady) {
      stopCamera();
    } else {
      startCamera();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">AI Talking · 多模态语音对话</h1>
        <span className="hint">摄像头 + 语音 + 文本 → 多模态模型</span>
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
          <ChatHistory
            messages={messages}
            interimText={interimText}
            isSending={isSending}
            onClear={clearMessages}
            onResetSession={resetSession}
          />

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
            <button type="button" className="btn btn--primary" onClick={handleSend} disabled={isSending}>
              发送
            </button>
          </div>

          <div className="app__bottom">
            <SettingsPanel
              settings={settings}
              onChange={setSettings}
              isRunning={isRunning}
              onToggleRunning={handleToggleRunning}
            />
            <CostStats cost={cost} sessionId={sessionId} />
          </div>
        </section>
      </main>

      {convError && (
        <footer className="app__footer">
          <div className="error">{convError}</div>
        </footer>
      )}
    </div>
  );
}
