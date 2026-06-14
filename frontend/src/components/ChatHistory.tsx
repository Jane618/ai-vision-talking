import { useEffect, useRef, useState } from 'react';
import type { ConversationMessage, MultimodalSettings } from '../api/client';

interface ChatHistoryInputProps {
  inputText: string;
  onInputChange: (text: string) => void;
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSend: () => void;
  onToggleListening: () => void;
  onStopSpeaking: () => void;
  isListening: boolean;
  isSpeaking: boolean;
  isInputLocked: boolean;
  asrSupported: boolean;
}

interface ChatHistoryProps {
  messages: ConversationMessage[];
  isSending?: boolean;
  onClear: () => void;
  onResetSession: () => void;
  settings: MultimodalSettings;
  onSettingsChange: (next: MultimodalSettings) => void;
  input?: ChatHistoryInputProps;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 对话模块：
 * - 顶部：标题、消息条数、清空对话、重置会话 + 「对话摘要」展开按钮
 * - 可展开区：对话摘要开关 + 触发阈值设置
 * - 中部：消息气泡列表（AI/用户/系统状态）
 * - 底部：输入框、语音输入按钮、停止播报按钮、发送按钮
 */
export function ChatHistory({
  messages,
  isSending,
  onClear,
  onResetSession,
  settings,
  onSettingsChange,
  input,
}: ChatHistoryProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const summaryPanelRef = useRef<HTMLDivElement>(null);
  const summaryToggleRef = useRef<HTMLButtonElement>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

  const update = (patch: Partial<MultimodalSettings>) => onSettingsChange({ ...settings, ...patch });
  const enableSummary = settings.enableSummary !== false;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isSending]);

  useEffect(() => {
    if (!summaryOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (summaryPanelRef.current?.contains(target)) return;
      if (summaryToggleRef.current?.contains(target)) return;
      setSummaryOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [summaryOpen]);

  useEffect(() => {
    if (!fullscreenImage) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFullscreenImage(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [fullscreenImage]);

  return (
    <div className="card chat-history chat-history--with-input">
      <div className="chat-history__header">
        <div className="chat-history__title-left">
          <span className="chat-history__title">对话</span>
          <span className="chat-history__count">{messages.length} 条</span>
          <button
            ref={summaryToggleRef}
            type="button"
            className={`btn btn--ghost btn--sm expand-toggle ${summaryOpen ? 'expand-toggle--on' : ''}`}
            onClick={() => setSummaryOpen((v) => !v)}
            aria-expanded={summaryOpen}
            aria-controls="summary-panel"
          >
            {summaryOpen ? '收起摘要' : '对话摘要'}
          </button>
        </div>
        <div className="chat-history__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClear}>
            清空对话
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onResetSession}>
            重置会话
          </button>
        </div>
      </div>

      <div
        ref={summaryPanelRef}
        id="summary-panel"
        className={`expand-panel expand-panel--compact ${summaryOpen ? 'expand-panel--open' : ''}`}
        hidden={!summaryOpen}
      >
        <div className="expand-panel__section">
          <label className="field field--switch">
            <input
              type="checkbox"
              checked={enableSummary}
              onChange={(e) => update({ enableSummary: e.target.checked })}
            />
            <span>启用对话摘要 — 历史对话达到阈值时自动压缩，降低 token 消耗。</span>
          </label>

          {enableSummary && (
            <div className="field">
              <label>
                摘要触发阈值：
                <strong>{(settings.summaryThresholdTokens || 8192).toLocaleString()} tokens</strong>
              </label>
              <input
                type="range"
                min={2048}
                max={16384}
                step={1024}
                value={settings.summaryThresholdTokens || 8192}
                onChange={(e) => update({ summaryThresholdTokens: Number(e.target.value) })}
              />
              <span className="field__hint">
                2K ~ 16K tokens。阈值越小越频繁，更省 tokens；阈值越大越保留完整上下文。
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="chat-history__list" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-history__empty">
            <span className="chat-history__empty-icon" aria-hidden="true">
              💬
            </span>
            对摄像头说点什么，开始对话吧。
            <br />
            也可以直接在下方输入框输入文字。
          </div>
        )}
        {messages.map((m) => {
          if (m.role === 'system') {
            return (
              <div key={m.id} className="bubble bubble--system">
                <span className="bubble__text">{m.content}</span>
              </div>
            );
          }
          const isUser = m.role === 'user';
          return (
            <div key={m.id} className={`bubble-row ${isUser ? 'bubble-row--right' : 'bubble-row--left'}`}>
              {isUser && m.image && (
                <button
                  type="button"
                  className="bubble__thumbnail-btn"
                  onClick={() => setFullscreenImage(m.image as string)}
                  title="点击查看大图"
                  aria-label="查看这条消息发送给 AI 的画面"
                >
                  <img
                    src={m.image}
                    alt="AI 看到的画面"
                    className="bubble__thumbnail"
                  />
                </button>
              )}
              <div className={`bubble ${isUser ? 'bubble--user' : 'bubble--assistant'}`}>
                <div className="bubble__meta">
                  <span>{isUser ? '你' : 'AI'}</span>
                  <span className="bubble__time">{formatTime(m.ts)}</span>
                  {m.tokens && m.tokens > 0 && (
                    <span className="bubble__tag bubble__tag--tokens">
                      {isUser ? '≈ ' : ''}
                      {m.tokens} tokens
                    </span>
                  )}
                </div>
                <span className="bubble__text">{m.content}</span>
              </div>
            </div>
          );
        })}
        {isSending && (
          <div className="bubble-row bubble-row--left">
            <div className="bubble bubble--thinking">
              <span className="bubble__text">正在思考</span>
            </div>
          </div>
        )}
      </div>

      {input && (
        <div className="chat-history__input-bar">
          <input
            type="text"
            className="input chat-history__input"
            placeholder="输入消息后按 Enter 发送，或点击右侧「语音输入」"
            value={input.inputText}
            onChange={(e) => input.onInputChange(e.target.value)}
            onKeyDown={input.onInputKeyDown}
            disabled={input.isInputLocked}
          />
          <button
            type="button"
            className={`btn btn--with-icon ${input.isListening ? 'btn--danger' : 'btn--primary'}`}
            onClick={input.onToggleListening}
            disabled={!input.asrSupported || input.isInputLocked}
            title={input.asrSupported ? '开启/关闭语音识别' : '当前浏览器不支持语音识别'}
          >
            <span className="btn__icon">🎙</span>
            <span>{input.isListening ? '停止语音' : '语音输入'}</span>
          </button>
          {input.isSpeaking && (
            <button
              type="button"
              className="btn btn--warning btn--with-icon"
              onClick={input.onStopSpeaking}
              title="停止当前 AI 语音播报（也可以在语音输入时说「停止」「别讲了」等关键词）"
            >
              <span>⏹</span>
              <span>停止播报</span>
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={input.onSend} disabled={input.isInputLocked}>
            发送
          </button>
        </div>
      )}

      {fullscreenImage && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="全屏查看发送画面"
          onClick={() => setFullscreenImage(null)}
        >
          <img
            src={fullscreenImage}
            alt="全屏查看发送给 AI 的画面"
            className="image-lightbox__image"
          />
        </div>
      )}
    </div>
  );
}
