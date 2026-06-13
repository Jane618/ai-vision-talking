import { useEffect, useRef } from 'react';
import type { ConversationMessage } from '../api/client';

interface ChatHistoryProps {
  messages: ConversationMessage[];
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
 * 气泡式对话历史：
 * - 用户消息靠右，紫色渐变
 * - AI 消息靠左，机器人头像
 * - 系统消息居中
 * - 新消息滑入动画，支持"正在思考"状态
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
            <div
              key={m.id}
              className={`bubble-row ${isUser ? 'bubble-row--right' : 'bubble-row--left'}`}
            >
              <div className={`bubble ${isUser ? 'bubble--user' : 'bubble--assistant'}`}>
                <div className="bubble__meta">
                  <span>{isUser ? '你' : 'AI'}</span>
                  <span className="bubble__time">{formatTime(m.ts)}</span>
                  {m.hasImage && <span className="bubble__tag">含画面</span>}
                  {m.tokens && m.tokens > 0 && (
                    <span className="bubble__tag bubble__tag--tokens">
                      {isUser ? '≈ ' : ''}{m.tokens} tokens
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
    </div>
  );
}
