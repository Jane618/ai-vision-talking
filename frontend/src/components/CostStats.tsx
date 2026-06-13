import type { CostInfo } from '../api/client';

interface CostStatsProps {
  cost: CostInfo;
  sessionId: string;
}

/**
 * 显示调用次数、token 数与估算费用等统计。
 * 字段名与 backend/src/types.ts 的 ConversationCost 保持一致。
 */
export function CostStats({ cost, sessionId }: CostStatsProps) {
  const { callCount, promptTokens, completionTokens, totalTokens, estimatedCostCNY } = cost;

  return (
    <div className="card cost-stats">
      <div className="cost-stats__header">
        <span className="cost-stats__title">会话统计</span>
        <span className="hint">{sessionId}</span>
      </div>
      <div className="cost-stats__grid">
        <div className="stat">
          <div className="stat__label">调用次数</div>
          <div className="stat__value">{callCount}</div>
        </div>
        <div className="stat">
          <div className="stat__label">输入 tokens</div>
          <div className="stat__value">{promptTokens}</div>
        </div>
        <div className="stat">
          <div className="stat__label">输出 tokens</div>
          <div className="stat__value">{completionTokens}</div>
        </div>
        <div className="stat">
          <div className="stat__label">总 tokens</div>
          <div className="stat__value">{totalTokens}</div>
        </div>
        <div className="stat stat--highlight">
          <div className="stat__label">估算费用 (¥)</div>
          <div className="stat__value">¥{estimatedCostCNY.toFixed(4)}</div>
        </div>
      </div>
    </div>
  );
}
