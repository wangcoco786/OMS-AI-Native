/**
 * Onboarding Agent
 *
 * AI-driven onboarding agent registered on the Agent Platform.
 * Provides:
 * - Agent definition and registration
 * - Help content generation for each step
 * - Interaction tracking and step completion timing
 *
 * Based on M1 Agent SDK Wrapper for session management.
 */

import pino from 'pino';

import type { AgentDefinition, AgentPlatform } from '../../agent-runtime/platform/types.js';
import type { OnboardingStep, HelpContent } from '../../shared/m2-types.js';

const logger = pino({ name: 'onboarding-agent' });

/** Onboarding Agent definition for registration */
export const ONBOARDING_AGENT_DEFINITION: AgentDefinition = {
  id: 'onboarding-agent',
  name: 'Onboarding Agent',
  type: 'onboarding',
  version: '1.0.0',
  description: 'AI-driven agent that guides users through the shop onboarding process, including channel connection, configuration, SKU mapping, and rule setup.',
  tools: [
    'validate_channel_connection',
    'validate_basic_config',
    'validate_sku_mapping',
    'validate_rule_setup',
    'get_step_help',
  ],
  systemPrompt: `You are an onboarding assistant for the OMS (Order Management System). 
Your role is to guide users through setting up their shop, including:
1. Connecting their sales channel (Shopify, WMS, ERP)
2. Configuring basic shop settings
3. Mapping SKUs between their channel and the system
4. Setting up logistics rules
5. Running final validation

Be helpful, concise, and proactive in suggesting next steps. 
If validation fails, explain what went wrong and how to fix it.`,
  config: {
    maxSessionDuration: 2 * 60 * 60 * 1000, // 2 hours
    maxInteractions: 100,
  },
};

/** Help content for each onboarding step */
const STEP_HELP_CONTENT: Record<OnboardingStep, HelpContent> = {
  channel_connection: {
    step: 'channel_connection',
    title: '连接销售渠道',
    description: '将您的销售渠道（如 Shopify 店铺、WMS 系统或 ERP 系统）连接到 OMS。您需要提供 API 凭证以建立安全连接。',
    tips: [
      '确保您有管理员权限来获取 API 凭证',
      'Shopify 店铺需要提供 API Key、API Secret 和店铺域名',
      'WMS/ERP 系统需要提供 API 端点 URL 和认证密钥',
      '连接建立后系统会自动验证凭证有效性',
    ],
    examples: [
      'Shopify 域名格式：your-store.myshopify.com',
      'API 端点格式：https://api.your-wms.com/v1',
    ],
  },
  basic_config: {
    step: 'basic_config',
    title: '基础配置',
    description: '设置店铺的基本信息，包括名称、时区、货币和联系方式。这些信息将用于订单处理和通知。',
    tips: [
      '时区设置会影响订单时间显示和报表统计',
      '货币设置决定了价格显示和财务报表的币种',
      '联系邮箱将用于接收系统通知和异常告警',
    ],
    examples: [
      '时区：Asia/Shanghai、America/New_York',
      '货币：CNY、USD、EUR',
    ],
  },
  sku_mapping: {
    step: 'sku_mapping',
    title: 'SKU 映射',
    description: '将渠道商品 SKU 与系统 SKU 建立映射关系。系统会使用 AI 自动匹配，您只需确认或修正匹配结果。',
    tips: [
      '系统会自动分析商品名称和属性进行智能匹配',
      '高置信度匹配（≥85%）可以直接确认',
      '低置信度匹配需要人工审核和确认',
      '未匹配的 SKU 可以选择创建新的系统 SKU',
      '映射覆盖率需达到 80% 以上才能进入下一步',
    ],
    examples: [
      '渠道 SKU "蓝色T恤-XL" → 系统 SKU "TS-BLUE-XL"',
      '批量导入支持 CSV 格式',
    ],
  },
  rule_setup: {
    step: 'rule_setup',
    title: '物流规则配置',
    description: '配置订单处理的物流规则，包括发货规则、仓库分配规则和优先级规则。至少需要配置一条发货规则。',
    tips: [
      '发货规则决定了订单使用哪个物流渠道',
      '仓库分配规则决定了从哪个仓库发货',
      '优先级规则可以让紧急订单优先处理',
      '规则按顺序匹配，第一条匹配的规则生效',
    ],
    examples: [
      '发货规则：订单金额 > 100 → 使用顺丰快递',
      '仓库规则：收货地址在华东 → 从上海仓发货',
    ],
  },
  validation: {
    step: 'validation',
    title: '上线验证',
    description: '系统将自动验证所有配置的完整性和正确性，包括渠道连接状态、SKU 映射覆盖率、物流规则和库存关联。验证通过后即可上线。',
    tips: [
      '验证会检查 4 个维度：渠道连接、SKU 映射、物流规则、库存关联',
      '系统会模拟一笔订单的完整流转来验证配置',
      '所有维度通过后才能上线',
      '未通过的项目会给出具体的修复建议',
    ],
    examples: [
      '验证通过：所有检查项为绿色，可以点击"上线"',
      '验证失败：查看红色项目的修复建议并返回修改',
    ],
  },
};

/** Dependencies for the onboarding agent */
export interface OnboardingAgentDeps {
  agentPlatform: AgentPlatform;
}

/**
 * OnboardingAgent manages the AI agent registration and help content.
 */
export class OnboardingAgent {
  private readonly agentPlatform: AgentPlatform;
  private registered = false;

  constructor(deps: OnboardingAgentDeps) {
    this.agentPlatform = deps.agentPlatform;
  }

  /**
   * Register the onboarding agent on the Agent Platform.
   */
  async register(tenantId: string): Promise<void> {
    if (this.registered) {
      logger.debug('Onboarding agent already registered');
      return;
    }

    try {
      await this.agentPlatform.registerAgent(ONBOARDING_AGENT_DEFINITION, tenantId);
      this.registered = true;
      logger.info({ tenantId }, 'Onboarding agent registered on platform');
    } catch (error) {
      logger.error({ error, tenantId }, 'Failed to register onboarding agent');
      throw error;
    }
  }

  /**
   * Get help content for a specific onboarding step.
   */
  getStepHelp(step: OnboardingStep): HelpContent {
    const help = STEP_HELP_CONTENT[step];
    if (!help) {
      return {
        step,
        title: 'Help',
        description: 'No help content available for this step.',
      };
    }
    return help;
  }

  /**
   * Record an interaction for metrics tracking.
   * Returns the updated interaction count.
   */
  recordInteraction(currentCount: number): number {
    return currentCount + 1;
  }

  /**
   * Calculate step completion time in milliseconds.
   */
  calculateStepDuration(startedAt: Date, completedAt: Date): number {
    return completedAt.getTime() - startedAt.getTime();
  }

  /**
   * Check if the agent is registered.
   */
  isRegistered(): boolean {
    return this.registered;
  }
}
