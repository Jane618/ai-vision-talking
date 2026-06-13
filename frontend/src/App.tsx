import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatHistory } from './components/ChatHistory';
import { CostStats } from './components/CostStats';
import { ThemeToggle } from './components/ThemeToggle';
import { VideoPreview } from './components/VideoPreview';
import { useASR } from './hooks/useASR';
import { useCamera } from './hooks/useCamera';
import { useConversation } from './hooks/useConversation';
import type { MultimodalSettings } from './api/client';
import { captureFrame, type CaptureResult } from './video/frameSampler';
import { getScenePreset, DEFAULT_SCENE_PRESET_ID } from './presets/scenePresets';

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
  const [settings, setSettings] = useState<MultimodalSettings>({
    ...defaultPreset.settings,
    adaptiveImageQuality: true,
    imageQualityMin: Math.max(0.3, defaultPreset.settings.imageQuality - 0.35),
    scenePresetId: defaultPreset.id,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [inputText, setInputText] = useState('');
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [lastCapture, setLastCapture] = useState<CaptureResult | null>(null);

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
    isInputLocked,
    isSpeaking,
    error: convError,
    cost,
    sessionId,
    sendMessage,
    clearMessages,
    resetSession,
    stopSpeaking,
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
      if (containsStopKeyword(text)) {
        stopSpeaking();
        return;
      }
      const frameForSend = currentFrameRef.current || undefined;
      sendMessage(text, frameForSend);
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

  // 运行中：按 frameIntervalMs 周期抽帧，并在有变化时更新 currentFrame
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(async () => {
      const video = videoRef.current;
      if (!video || !cameraReady) return;
      try {
        const result = await captureFrame(
          video,
          {
            imageSize: settings.imageSize,
            imageQuality: settings.imageQuality,
            adaptiveImageQuality: settings.adaptiveImageQuality,
            imageQualityMin: settings.imageQualityMin,
          },
          prevImageDataRef.current,
        );
        const { base64, changed, imageData } = result;
        if (changed) {
          prevImageDataRef.current = imageData;
          setCurrentFrame(base64);
        }
        setLastCapture(result);
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
            currentFrame={currentFrame}
            cameraDisabled={!cameraReady}
            onToggleCamera={handleToggleCamera}
            settings={settings}
            onSettingsChange={setSettings}
            isRunning={isRunning}
            onToggleRunning={handleToggleRunning}
            lastCapture={lastCapture}
          />
        </section>

        <section className="app__column app__column--right">
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
