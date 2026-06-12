import { useEffect, useRef } from 'react';

interface ChatHistoryProps {
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    ts: number;
    hasImage?: boolean;
  }>;
  interimText?: string;
  isSending?: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 气泡式对话历史：用户靠右、AI 靠左，system 灰底居中提示。
 * 追加新消息时自动滚动到底部。
 */
export function ChatHistory({ messages, interimText, isSending }: ChatHistoryProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, interimText, isSending]);

  return (
    <div className="card chat-history">
      <div className="chat-history__header">
        <span className="chat-history__title">对话</span>
        <span className="chat-history__count">{messages.length} 条</span>
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
        {interimText && (
          <div className="bubble-row bubble-row--right">
            <div className="bubble bubble--interim">
              <span className="bubble__text">{interimText}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
