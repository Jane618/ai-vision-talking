import type { CostInfo } from '../api/client';

interface CostStatsProps {
  cost: CostInfo;
  sessionId: string;
}

/**
 * 会话统计 — 状态栏形式：
 * 展示调用次数、输入/输出 tokens、估算费用（¥）、已节省 tokens（若有）。
 * 作为顶部状态栏的一部分放在页面右上角，不再以独立卡片呈现。
 */
export function CostStats({ cost, sessionId }: CostStatsProps) {
  const { callCount, promptTokens, completionTokens, totalTokens, estimatedCostCNY, savedTokens } = cost;

  return (
    <div className="status-bar" aria-label="会话统计">
      <span className="status-bar__label">会话 token 统计</span>
      <span className="status-bar__sep" aria-hidden="true">·</span>
      <span className="status-bar__badge" title={`会话 ${sessionId}`}>
        <span className="status-bar__dot status-bar__dot--ok" aria-hidden="true" />
        #{callCount}
      </span>
      <span className="status-bar__item">
        输入 <strong>{promptTokens}</strong>
      </span>
      <span className="status-bar__sep" aria-hidden="true">·</span>
      <span className="status-bar__item">
        输出 <strong>{completionTokens}</strong>
      </span>
      <span className="status-bar__sep" aria-hidden="true">·</span>
      <span className="status-bar__item">
        总计 <strong>{totalTokens}</strong>
      </span>
      {savedTokens && savedTokens > 0 ? (
        <>
          <span className="status-bar__sep" aria-hidden="true">·</span>
          <span className="status-bar__item status-bar__item--saved">
            已省 <strong>−{savedTokens}</strong>
          </span>
        </>
      ) : null}
      <span className="status-bar__sep" aria-hidden="true">·</span>
      <span className="status-bar__item status-bar__item--cost">
        估算 <strong>¥{estimatedCostCNY.toFixed(4)}</strong>
      </span>
    </div>
  );
}
