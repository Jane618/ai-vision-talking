from app.models.schemas import ConversationCost, ArkUsage

PROMPT_COST_CNY_PER_1K = 0.003
COMPLETION_COST_CNY_PER_1K = 0.006


def accumulate_cost(cost: ConversationCost, usage: ArkUsage) -> None:
    cost.callCount += 1
    cost.promptTokens += usage.prompt_tokens
    cost.completionTokens += usage.completion_tokens
    cost.totalTokens += usage.total_tokens
    cost.estimatedCostCNY = (
        (cost.promptTokens / 1000) * PROMPT_COST_CNY_PER_1K
        + (cost.completionTokens / 1000) * COMPLETION_COST_CNY_PER_1K
    )


def snapshot_cost(cost: ConversationCost) -> dict:
    return cost.model_dump()
