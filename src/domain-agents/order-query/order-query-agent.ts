/**
 * Order Query Agent Definition and Registration
 *
 * Defines the Order Query Agent with its system prompt and tool configuration.
 * Provides a helper to register the agent with the Agent Platform.
 *
 * Requirements: 9.1
 */

import type { AgentDefinition, AgentInstance, AgentPlatform } from '../../agent-runtime/platform/types.js';

/** System prompt for the Order Query Agent (Chinese, domain expert role) */
export const ORDER_QUERY_SYSTEM_PROMPT = `你是一个专业的订单查询助手，专门负责帮助用户查询和了解订单信息。

你的职责：
1. 理解用户的订单查询意图，提取查询条件（订单号、状态、时间范围、店铺等）
2. 使用 query_orders 工具执行查询
3. 将查询结果以清晰、结构化的方式呈现给用户
4. 当用户的查询条件不明确时，主动追问以获取更精确的查询条件

注意事项：
- 你只能查询当前租户的订单数据，系统会自动进行数据隔离
- 如果用户没有指定时间范围，默认查询最近 30 天的订单
- 如果查询结果为空，友好地告知用户并建议调整查询条件
- 金额显示时注意货币单位（默认 CNY）
- 订单状态包括：pending（待处理）、confirmed（已确认）、processing（处理中）、shipped（已发货）、delivered（已送达）、cancelled（已取消）、refunded（已退款）

回复风格：
- 使用简洁、专业的中文
- 数据展示使用结构化格式
- 主动提供有用的汇总信息（如订单总数、金额合计等）`;

/** Agent definition for the Order Query Agent */
export const ORDER_QUERY_AGENT_DEFINITION: AgentDefinition = {
  id: 'order-query-agent',
  name: '订单查询 Agent',
  type: 'order-query',
  version: '1.0.0',
  description: '解析用户自然语言查询意图，调用订单查询工具返回结构化结果',
  tools: ['query_orders'],
  systemPrompt: ORDER_QUERY_SYSTEM_PROMPT,
  config: {
    maxConcurrentSessions: 10,
    sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
    defaultQueryDays: 30,
  },
};

/**
 * Register the Order Query Agent with the Agent Platform.
 *
 * @param platform - The Agent Platform service instance
 * @param tenantId - The tenant to register the agent for
 * @returns The created AgentInstance
 */
export async function registerOrderQueryAgent(
  platform: AgentPlatform,
  tenantId: string,
): Promise<AgentInstance> {
  return platform.registerAgent(ORDER_QUERY_AGENT_DEFINITION, tenantId);
}
