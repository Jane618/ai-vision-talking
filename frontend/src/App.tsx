import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatHistory } from './components/ChatHistory';
import { SessionList } from './components/SessionList';
import { CostStats } from './components/CostStats';
import { ThemeToggle } from './components/ThemeToggle';
import { VideoPreview } from './components/VideoPreview';
import { useASR } from './hooks/useASR';
import { useCamera } from './hooks/useCamera';
import { useConversation } from './hooks/useConversation';
import type { MultimodalSettings, ConversationMessage } from './api/client';
import { API_BASE, resumeSession } from './api/client';
import { captureFrame, type CaptureResult } from './video/frameSampler';
import { processFrame } from './video/frameProcessor';
import { getScenePreset, DEFAULT_SCENE_PRESET_ID } from './presets/scenePresets';
import { getQualityModePreset } from './presets/qualityModes';

/**
 * 中断播报关键词列表：用户在语音输入时说这些词即可中断当前播报。
 */
const STOP_SPEAKING_KEYWORDS = ['停止', '停一下', '别讲了', '别说话', '别说了', '停', '闭嘴', '暂停播报', '停止播报'];

function containsStopKeyword(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  return STOP_SPEAKING_KEYWORDS.some((kw) => t.includes(kw));
}

/**
 * 主组件：
 * - 顶部 Header（左上角状态栏：会话统计；中间标题；右侧主题切换）
 * - 主体两列平分：左侧摄像头模块（含可展开的画面设置 + 场景预设），右侧对话模块（含可展开对话摘要）
 * - 输入栏在对话模块底部
 */
export default function App() {
  const defaultPreset = getScenePreset(DEFAULT_SCENE_PRESET_ID);
  const defaultQualityMode = getQualityModePreset('balanced');
  const [settings, setSettings] = useState<MultimodalSettings>({
    ...defaultPreset.settings,
    ...defaultQualityMode.settings,
    qualityMode: defaultQualityMode.id,
    scenePresetId: defaultPreset.id,
  });
  const [inputText, setInputText] = useState('');
  const [mobileTab, setMobileTab] = useState<'camera' | 'chat'>('chat');
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [historySessionUuid, setHistorySessionUuid] = useState<string | null>(null);
  const [historyMessages, setHistoryMessages] = useState<ConversationMessage[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [previewFrame, setPreviewFrame] = useState<string | null>(null);
  const [lastCapture, setLastCapture] = useState<CaptureResult | null>(null);

  const { videoRef, isReady: cameraReady, error: cameraError, start: startCamera, stop: stopCamera } =
    useCamera();

  // 上一次发送的 ImageData，用于判断画面是否变化
  const prevImageDataRef = useRef<ImageData | null>(null);
  const currentFrameRef = useRef<string | null>(null);
  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  useEffect(() => {
    if (!cameraReady) {
      currentFrameRef.current = null;
      prevImageDataRef.current = null;
      setCurrentFrame(null);
      setPreviewFrame(null);
      setLastCapture(null);
    }
  }, [cameraReady]);

  const {
    messages,
    isSending,
    isInputLocked,
    isSpeaking,
    error: convError,
    cost,
    sessionId,
    sendMessage,
    clearMessages,
    resetSession,
    setSessionMessages,
    setSessionCost,
    stopSpeaking,
  } = useConversation({
    settings,
    getCurrentFrame: () => (cameraReady ? currentFrameRef.current || undefined : undefined),
  });

  const handleShowHistory = useCallback(() => {
    setView('history');
    setHistoryMessages(null);
    setHistorySessionUuid(null);
  }, []);

  const handleSelectHistorySession = useCallback(async (sessionUuid: string) => {
    setHistorySessionUuid(sessionUuid);
    setHistoryLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/conversations/${encodeURIComponent(sessionUuid)}`);
      const json = await resp.json();
      if (json.ok && Array.isArray(json.messages)) {
        const msgs: ConversationMessage[] = json.messages.map((m: any) => ({
          id: `h_${m.id}`,
          role: m.role as 'user' | 'assistant' | 'system',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          ts: new Date(m.created_at).getTime(),
          hasImage: !!m.has_image,
        }));
        setHistoryMessages(msgs);
      }
    } catch (err) {
      console.error('加载历史会话失败:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const handleResumeSession = useCallback(async () => {
    if (!historySessionUuid) return;
    const result = await resumeSession(historySessionUuid);
    if (result.ok) {
      // 用原 sessionId 恢复，历史消息和费用填充到对话区
      resetSession(result.sessionId);
      if (historyMessages) {
        setSessionMessages(historyMessages);
      }
      if (result.cost) {
        setSessionCost(result.cost);
      }
      setView('chat');
      setHistoryMessages(null);
      setHistorySessionUuid(null);
    }
  }, [historySessionUuid, historyMessages, resetSession, setSessionMessages, setSessionCost]);

  const handleBackToChat = useCallback(() => {
    setView('chat');
    setHistoryMessages(null);
    setHistorySessionUuid(null);
  }, []);

  const captureLatestFrameForSend = useCallback(async (): Promise<string | Blob | undefined> => {
    const video = videoRef.current;
    if (!cameraReady || !video) {
      return undefined;
    }

    try {
      // 优先使用 Worker 路径（异步、不阻塞主线程）
      const result = await processFrame(video, {
        imageSize: settings.imageSize,
        imageQuality: settings.imageQuality,
        adaptiveImageQuality: settings.adaptiveImageQuality,
        imageQualityMin: settings.imageQualityMin,
      });

      // 将 Blob 转为 data URL 用于本地预览
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(result.blob);
      });

      currentFrameRef.current = dataUrl;
      setCurrentFrame(dataUrl);
      setPreviewFrame(dataUrl);
      setLastCapture({
        base64: dataUrl,
        changed: true,
        imageData: new ImageData(result.width, result.height),
        effectiveQuality: result.effectiveQuality,
        complexity: result.complexity,
        estimatedBytes: result.estimatedBytes,
      });

      return result.blob;
    } catch {
      // Worker 失败，回退到同步路径
      try {
        const fallback = await captureFrame(
          video,
          {
            imageSize: settings.imageSize,
            imageQuality: settings.imageQuality,
            adaptiveImageQuality: settings.adaptiveImageQuality,
            imageQualityMin: settings.imageQualityMin,
          },
          null,
        );

        prevImageDataRef.current = fallback.imageData;
        currentFrameRef.current = fallback.base64;
        setCurrentFrame(fallback.base64);
        setPreviewFrame(fallback.base64);
        setLastCapture(fallback);
        return fallback.base64;
      } catch {
        return cameraReady ? currentFrameRef.current || undefined : undefined;
      }
    }
  }, [cameraReady, settings, videoRef]);

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
      if (containsStopKeyword(text)) {
        stopSpeaking();
        return;
      }
      void (async () => {
        const frameForSend = await captureLatestFrameForSend();
        await sendMessage(text, frameForSend);
      })();
    },
  });

  // 将实时识别文本显示到输入框
  useEffect(() => {
    if (isListening) {
      setInputText(interimText || '');
    }
  }, [interimText, isListening]);

  const handleInputChange = useCallback(
    (text: string) => {
      if (isSpeaking) {
        stopSpeaking();
      }
      setInputText(text);
    },
    [isSpeaking, stopSpeaking],
  );

  // 摄像头开启后持续抽帧，用于右下角本地预览缩略图；真正发送时会即时抓取当前画面。
  useEffect(() => {
    if (!cameraReady) return;
    const id = window.setInterval(async () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        const result = await captureFrame(
          video,
          {
            imageSize: settings.imageSize,
            imageQuality: settings.imageQuality,
            adaptiveImageQuality: settings.adaptiveImageQuality,
            imageQualityMin: settings.imageQualityMin,
          },
          null,
        );
        const { base64 } = result;
        setPreviewFrame(base64);
        setLastCapture(result);
      } catch {
        /* 抽帧失败忽略，下一帧继续 */
      }
    }, settings.frameIntervalMs);
    return () => window.clearInterval(id);
  }, [settings, videoRef, cameraReady]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    const frameForSend = await captureLatestFrameForSend();
    await sendMessage(text, frameForSend);
  }, [captureLatestFrameForSend, inputText, sendMessage]);

  const handleToggleListening = () => {
    if (isInputLocked) return;
    if (isListening) {
      stopASR();
      setInputText('');
    } else {
      if (isSpeaking) {
        stopSpeaking();
      }
      startASR();
    }
  };

  const handleToggleCamera = () => {
    if (cameraReady) {
      currentFrameRef.current = null;
      prevImageDataRef.current = null;
      setCurrentFrame(null);
      setPreviewFrame(null);
      setLastCapture(null);
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

  return isMobile ? (
    <div className="app app--mobile">
      <header className="app__header">
        <div className="app__header-left" />
        <div className="app__header-center">
          <h1 className="app__title">AI Talking</h1>
        </div>
        <div className="app__header-right">
          <CostStats cost={cost} sessionId={sessionId} />
          <ThemeToggle />
        </div>
      </header>

      {/* Tab 栏 */}
      <div className="mobile-tabs">
        <button
          className={`mobile-tabs__btn ${mobileTab === 'camera' ? 'mobile-tabs__btn--active' : ''}`}
          onClick={() => setMobileTab('camera')}
        >
          摄像头
        </button>
        <button
          className={`mobile-tabs__btn ${mobileTab === 'chat' ? 'mobile-tabs__btn--active' : ''}`}
          onClick={() => setMobileTab('chat')}
        >
          对话
        </button>
      </div>

      {/* 精简统计栏 */}
      <div className="cost-stats--compact">
        <span>{cost.callCount}次</span>
        <span className="cost-stats--compact__sep">·</span>
        <span>{cost.totalTokens}tok</span>
        <span className="cost-stats--compact__sep">·</span>
        <span>¥{cost.estimatedCostCNY.toFixed(4)}</span>
      </div>

      {/* 内容区 */}
      <div className="mobile-content">
        {mobileTab === 'camera' ? (
          <VideoPreview
            videoRef={videoRef}
            isReady={cameraReady}
            error={cameraError}
            isRecording={isListening}
            currentFrame={previewFrame || currentFrame}
            cameraDisabled={!cameraReady}
            onToggleCamera={handleToggleCamera}
            settings={settings}
            onSettingsChange={setSettings}
            lastCapture={lastCapture}
          />
        ) : (
          <ChatHistory
            messages={messages}
            isSending={isSending}
            onClear={clearMessages}
            onResetSession={resetSession}
            settings={settings}
            onSettingsChange={setSettings}
            input={{
              inputText,
              onInputChange: handleInputChange,
              onInputKeyDown: handleKeyDown,
              onSend: handleSend,
              onToggleListening: handleToggleListening,
              onStopSpeaking: stopSpeaking,
              isListening,
              isSpeaking,
              isInputLocked,
              asrSupported: asrSupported ?? false,
            }}
          />
        )}
      </div>

      {/* 固定底部输入栏 */}
      <div className="mobile-input-bar">
        <button className="mobile-input-bar__voice" onClick={handleToggleListening}>
          {isListening ? '⏹' : '🎤'}
        </button>
        <input
          className="mobile-input-bar__input"
          type="text"
          value={inputText}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          disabled={isInputLocked}
        />
        <button className="mobile-input-bar__send" onClick={handleSend}>
          ➤
        </button>
      </div>

      {convError && (
        <footer className="app__footer">
          <div className="error">{convError}</div>
        </footer>
      )}
    </div>
  ) : (
    <div className="app app--split">
      <header className="app__header">
        <div className="app__header-left" />
        <div className="app__header-center">
          <h1 className="app__title">AI Talking · 多模态语音对话</h1>
        </div>
        <div className="app__header-right">
          <CostStats cost={cost} sessionId={sessionId} />
          <ThemeToggle />
        </div>
      </header>

      <main className="app__grid app__grid--split">
        <section className="app__column app__column--left">
          <VideoPreview
            videoRef={videoRef}
            isReady={cameraReady}
            error={cameraError}
            isRecording={isListening}
            currentFrame={previewFrame || currentFrame}
            cameraDisabled={!cameraReady}
            onToggleCamera={handleToggleCamera}
            settings={settings}
            onSettingsChange={setSettings}
            lastCapture={lastCapture}
          />
        </section>

        <section className="app__column app__column--right">
          {view === 'history' && !historyMessages ? (
            <SessionList
              onSelectSession={handleSelectHistorySession}
              onBack={handleBackToChat}
            />
          ) : view === 'history' && historyMessages ? (
            <ChatHistory
              messages={historyMessages}
              settings={settings}
              onSettingsChange={setSettings}
              onClear={() => setHistoryMessages(null)}
              onResetSession={() => { setView('chat'); setHistoryMessages(null); setHistorySessionUuid(null); }}
              historicalSessionUuid={historySessionUuid || undefined}
              onResumeSession={handleResumeSession}
            />
          ) : (
            <ChatHistory
              messages={messages}
              isSending={isSending}
              onClear={clearMessages}
              onResetSession={resetSession}
              onNewSession={resetSession}
              settings={settings}
              onSettingsChange={setSettings}
              onShowHistory={handleShowHistory}
              input={{
                inputText,
                onInputChange: handleInputChange,
                onInputKeyDown: handleKeyDown,
                onSend: handleSend,
                onToggleListening: handleToggleListening,
                onStopSpeaking: stopSpeaking,
                isListening,
                isSpeaking,
                isInputLocked,
                asrSupported: asrSupported ?? false,
              }}
            />
          )}
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
