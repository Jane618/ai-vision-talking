import { useEffect, useRef } from 'react';

interface ChatHistoryProps {
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    ts: number;
    hasImage?: boolean;
  }>;
  isSending?: boolean;
  onClear: () => void;
  onResetSession: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 气泡式对话历史：用户靠右、AI 靠左、system 灰底居中。
 * 实时识别的 interim 文本不再展示在此；改由输入框展示。
 */
export function ChatHistory({ messages, isSending, onClear, onResetSession }: ChatHistoryProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isSending]);

  return (
    <div className="card chat-history">
      <div className="chat-history__header">
        <div className="chat-history__title-wrap">
          <span className="chat-history__title">对话</span>
          <span className="chat-history__count">{messages.length} 条</span>
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
      <div className="chat-history__list" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-history__empty">
            说点什么开始对话吧。文字输入或点击麦克风语音输入都可以。
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
            <div
              key={m.id}
              className={`bubble-row ${isUser ? 'bubble-row--right' : 'bubble-row--left'}`}
            >
              <div className={`bubble ${isUser ? 'bubble--user' : 'bubble--assistant'}`}>
                <div className="bubble__meta">
                  <span>{isUser ? '你' : 'AI'}</span>
                  <span className="bubble__time">{formatTime(m.ts)}</span>
                  {m.hasImage && <span className="bubble__tag">含画面</span>}
                </div>
                <span className="bubble__text">{m.content}</span>
              </div>
            </div>
          );
        })}
        {isSending && (
          <div className="bubble-row bubble-row--left">
            <div className="bubble bubble--assistant bubble--thinking">
              <span className="bubble__text">正在思考…</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
