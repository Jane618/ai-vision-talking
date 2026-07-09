import { useEffect, useState } from 'react';
import type { SessionSummary } from '../api/client';
import { listSessions, API_BASE } from '../api/client';

interface SessionListProps {
  onSelectSession: (sessionUuid: string) => void;
  onBack: () => void;
}

function formatDate(isoStr: string): string {
  const d = new Date(isoStr);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SessionList({ onSelectSession, onBack }: SessionListProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listSessions()
      .then((data) => {
        if (!cancelled) setSessions(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="card session-list">
      <div className="session-list__header">
        <span className="session-list__title">历史会话</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
          返回对话
        </button>
      </div>

      {loading && (
        <div className="session-list__empty">加载中...</div>
      )}

      {error && (
        <div className="session-list__empty">
          <span className="session-list__empty-icon" aria-hidden="true">⚠️</span>
          <span>{error}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            PostgreSQL 未配置或表结构未初始化
          </span>
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div className="session-list__empty">
          <span className="session-list__empty-icon" aria-hidden="true">📋</span>
          暂无历史会话
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            完成一轮对话后自动生成
          </span>
        </div>
      )}

      <div className="session-list__items">
        {sessions.map((s) => (
          <button
            key={s.session_uuid}
            type="button"
            className="session-list__item"
            onClick={() => onSelectSession(s.session_uuid)}
          >
            <div className="session-list__item-main">
              <span className="session-list__item-title">
                {s.title || s.summary
                  ? (s.title || s.summary || '').slice(0, 40)
                  : `对话 ${s.session_uuid.slice(0, 8)}`}
              </span>
              <span className="session-list__item-meta">
                {s.message_count} 条 · ¥{parseFloat(s.total_cost_cny || '0').toFixed(4)}
              </span>
            </div>
            <span className="session-list__item-date">{formatDate(s.updated_at)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
