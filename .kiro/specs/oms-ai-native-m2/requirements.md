# Requirements Document

## Introduction

本文档定义 OMS AI Native 系统 M2 里程碑的需求。M2 在 M1 基础设施之上构建面向用户的核心功能，包括：Onboarding Agent（新手引导 Agent）、SKU 映射、Dashboard 基础版以及支撑这些功能的数据同步能力。

M2 的核心目标是：让新店铺能够在 30 分钟内完成从接入到上线的全流程，通过 AI 自动匹配 SKU 降低人工配置成本，并提供实时数据看板帮助运营人员掌握业务全貌。

## Glossary

- **Onboarding_Agent**：新手引导 Agent，负责引导用户完成店铺接入、SKU 映射和上线验证的全流程
- **SKU_Mapper**：SKU 映射服务，利用 AI 自动匹配渠道 SKU 与系统内部 SKU
- **Dashboard_Service**：数据看板服务，负责聚合和展示业务 KPI 指标
- **Data_Sync_Service**：数据同步服务，负责从多渠道（Shopify/WMS/ERP）定时拉取和同步数据
- **Onboarding_Wizard**：引导向导 UI 组件，提供分步骤的可视化配置界面
- **Channel_SKU**：渠道 SKU，来自外部销售渠道（如 Shopify）的商品标识和属性
- **System_SKU**：系统 SKU，OMS 系统内部统一管理的商品标识和属性
- **KPI_Aggregator**：KPI 聚合器，负责按时间维度计算和缓存业务指标数据
- **Onboarding_Session**：引导会话，用户与 Onboarding Agent 交互的一次完整引导流程上下文
- **Configuration_Validator**：配置验证器，检测店铺配置完整性并模拟订单流转验证
- **MCP_Data_Tool**：基于 MCP 协议的数据访问工具，为 Agent 提供标准化数据查询接口
- **Sync_Job**：同步作业，一次数据同步任务的执行单元
- **Tenant**：租户，系统中的独立组织单元，数据和配置相互隔离

## Requirements

### Requirement 1: Onboarding Agent 向导引导

**User Story:** As a 运营人员, I want 通过 AI Agent 分步骤引导完成店铺配置, so that 无需专业技术知识即可快速完成新店铺接入。

#### Acceptance Criteria

1. THE Onboarding_Agent SHALL 提供分步骤的引导流程，包含：渠道连接、基础配置、SKU 映射、规则设置和上线验证五个阶段
2. WHEN 用户启动新店铺接入时, THE Onboarding_Agent SHALL 创建一个 Onboarding_Session 并展示当前步骤和整体进度
3. THE Onboarding_Agent SHALL 支持文本输入和结构化数据输入两种交互方式
4. WHEN 用户完成当前步骤时, THE Onboarding_Agent SHALL 验证该步骤的配置数据完整性后再允许进入下一步骤
5. THE Onboarding_Agent SHALL 在每个步骤提供上下文相关的帮助说明和示例
6. WHEN 用户请求回退到前一步骤时, THE Onboarding_Agent SHALL 保留已填写的数据并允许修改
7. THE Onboarding_Agent SHALL 记录每个步骤的完成时间和用户交互次数作为流程优化依据

### Requirement 2: SKU 映射配置

**User Story:** As a 运营人员, I want AI 自动匹配渠道 SKU 与系统 SKU, so that 无需逐一手动配置即可快速完成大量 SKU 的映射关系建立。

#### Acceptance Criteria

1. WHEN 用户提供渠道 SKU 数据时, THE SKU_Mapper SHALL 利用 LLM 分析 SKU 名称、属性和描述，自动生成与 System_SKU 的匹配建议
2. THE SKU_Mapper SHALL 对每条匹配建议提供置信度评分（0-100）
3. WHEN 匹配置信度 ≥ 85 时, THE SKU_Mapper SHALL 将该匹配标记为"高置信度"并推荐自动确认
4. WHEN 匹配置信度 < 85 时, THE SKU_Mapper SHALL 将该匹配标记为"需人工确认"并高亮显示差异点
5. THE SKU_Mapper SHALL 支持用户手动修正匹配结果，并将修正记录作为后续匹配的学习样本
6. THE SKU_Mapper SHALL 支持批量导入 Channel_SKU 数据（CSV/API 格式）
7. WHEN 系统中不存在匹配的 System_SKU 时, THE SKU_Mapper SHALL 建议创建新的 System_SKU 并预填属性信息
8. THE SKU_Mapper SHALL 在处理 1000 条 SKU 映射时总耗时不超过 5 分钟

### Requirement 3: 上线验证

**User Story:** As a 运营人员, I want 系统自动验证配置完整性并模拟订单流转, so that 确保店铺上线后能正常处理订单。

#### Acceptance Criteria

1. THE Configuration_Validator SHALL 检测店铺配置的完整性，覆盖以下维度：渠道连接状态、SKU 映射覆盖率、物流规则配置、库存关联配置
2. WHEN 配置存在缺失项时, THE Configuration_Validator SHALL 列出所有缺失项并提供修复建议
3. THE Configuration_Validator SHALL 模拟订单流转，验证从订单创建到发货的完整链路
4. WHEN 模拟订单流转失败时, THE Configuration_Validator SHALL 定位失败环节并提供具体错误原因
5. WHEN 所有验证项通过时, THE Configuration_Validator SHALL 将店铺状态标记为"可上线"并生成验证报告
6. THE Configuration_Validator SHALL 对每个验证维度给出通过/未通过的明确状态
7. IF 验证过程中发现渠道连接异常, THEN THE Configuration_Validator SHALL 提示用户重新授权渠道连接

### Requirement 4: 配置向导可视化界面

**User Story:** As a 运营人员, I want 通过可视化界面查看和修改配置, so that 能够直观地了解配置状态并快速调整。

#### Acceptance Criteria

1. THE Onboarding_Wizard SHALL 以可视化步骤条展示引导流程的整体进度和当前位置
2. THE Onboarding_Wizard SHALL 对每个配置项提供表单化的输入界面，包含字段说明和输入校验
3. WHEN 用户修改配置项时, THE Onboarding_Wizard SHALL 实时校验输入合法性并给出即时反馈
4. THE Onboarding_Wizard SHALL 支持在任意已完成步骤之间自由跳转和修改
5. WHEN 用户修改已完成步骤的配置时, THE Onboarding_Wizard SHALL 重新验证受影响的后续步骤
6. THE Onboarding_Wizard SHALL 在页面刷新或意外关闭后恢复到最近的配置状态

### Requirement 5: Dashboard KPI 可视化

**User Story:** As a 系统管理员, I want 在数据看板上查看核心业务指标, so that 能够实时掌握业务运行状况并及时发现异常。

#### Acceptance Criteria

1. THE Dashboard_Service SHALL 展示以下核心 KPI 指标：订单量、履约率、退货率、平均处理时长
2. THE Dashboard_Service SHALL 按小时、天、周三种时间粒度展示 KPI 趋势变化图
3. WHEN 用户切换时间粒度时, THE Dashboard_Service SHALL 在 2 秒内完成数据重新加载和图表渲染
4. THE Dashboard_Service SHALL 支持按店铺、渠道、仓库维度筛选 KPI 数据
5. WHEN KPI 指标出现异常波动时, THE Dashboard_Service SHALL 以视觉标记（颜色变化或图标）提示异常
6. THE Dashboard_Service SHALL 仅展示当前用户所属 Tenant 的数据

### Requirement 6: Dashboard 分时图

**User Story:** As a 运营人员, I want 查看按时间维度的趋势变化图, so that 能够识别业务规律和异常时段。

#### Acceptance Criteria

1. THE Dashboard_Service SHALL 提供折线图展示订单量、履约率等指标的时间趋势
2. THE Dashboard_Service SHALL 支持用户选择自定义时间范围进行趋势查看
3. WHEN 用户悬停在图表数据点上时, THE Dashboard_Service SHALL 显示该时间点的详细数值
4. THE Dashboard_Service SHALL 支持多指标叠加对比展示
5. THE Dashboard_Service SHALL 在图表中标注重要事件节点（如促销活动、系统变更）

### Requirement 7: Dashboard 库存可视化

**User Story:** As a 仓库管理员, I want 查看各仓库的库存水位和周转率, so that 能够及时发现库存异常并做出补货决策。

#### Acceptance Criteria

1. THE Dashboard_Service SHALL 展示各仓库的当前库存水位（当前库存量/最大容量百分比）
2. THE Dashboard_Service SHALL 展示各仓库的库存周转率（按天/周/月计算）
3. WHEN 库存水位低于安全阈值时, THE Dashboard_Service SHALL 以红色标记该仓库并触发预警提示
4. THE Dashboard_Service SHALL 支持按 SKU 维度查看单品库存分布
5. THE Dashboard_Service SHALL 展示库存变化趋势图，帮助预判补货时机

### Requirement 8: Dashboard 班次工作台

**User Story:** As a 仓库管理员, I want 按班次查看待处理任务, so that 能够合理分配工作量并跟踪任务完成进度。

#### Acceptance Criteria

1. THE Dashboard_Service SHALL 按当前班次展示待处理任务列表（待拣货、待打包、待发货）
2. THE Dashboard_Service SHALL 展示当前班次的任务完成进度（已完成/总数）
3. WHEN 新任务分配到当前班次时, THE Dashboard_Service SHALL 实时更新任务列表
4. THE Dashboard_Service SHALL 支持按优先级、截止时间排序任务列表
5. THE Dashboard_Service SHALL 展示班次间的任务交接情况（上一班次遗留任务数量）

### Requirement 9: 多渠道数据同步

**User Story:** As a 系统管理员, I want 系统定时从多个渠道同步数据, so that OMS 系统中的订单、库存和商品数据保持最新状态。

#### Acceptance Criteria

1. THE Data_Sync_Service SHALL 支持从 Shopify、WMS、ERP 三类数据源定时同步数据
2. THE Data_Sync_Service SHALL 支持配置同步频率（最小间隔 5 分钟，最大间隔 24 小时）
3. WHEN 同步作业执行时, THE Data_Sync_Service SHALL 采用增量同步策略，仅拉取上次同步后的变更数据
4. IF 同步作业执行失败, THEN THE Data_Sync_Service SHALL 记录失败原因并按指数退避策略自动重试（最多 3 次）
5. THE Data_Sync_Service SHALL 记录每次同步的数据量、耗时和状态作为监控指标
6. WHEN 同步数据存在冲突时, THE Data_Sync_Service SHALL 按"渠道数据优先"策略解决冲突并记录冲突详情
7. THE Data_Sync_Service SHALL 按 Tenant 维度隔离同步配置和同步数据

### Requirement 10: MCP Tool 数据源

**User Story:** As a 开发人员, I want 为 Agent 提供标准化的数据访问工具, so that Agent 能够通过 MCP 协议查询订单、库存和商品数据。

#### Acceptance Criteria

1. THE MCP_Data_Tool SHALL 提供订单查询工具，支持按订单号、状态、时间范围、渠道等条件查询
2. THE MCP_Data_Tool SHALL 提供库存查询工具，支持按 SKU、仓库、库存水位等条件查询
3. THE MCP_Data_Tool SHALL 提供商品/SKU 查询工具，支持按名称、属性、渠道等条件查询
4. THE MCP_Data_Tool SHALL 按 MCP 协议定义每个工具的输入 schema 和输出 schema
5. THE MCP_Data_Tool SHALL 对所有查询结果按 Tenant 维度进行数据隔离
6. WHEN 查询参数不合法时, THE MCP_Data_Tool SHALL 返回结构化错误信息，包含具体的参数校验失败原因
7. THE MCP_Data_Tool SHALL 对高频查询结果进行缓存（TTL 不超过 60 秒），减少数据库压力

### Requirement 11: Onboarding 流程端到端时效

**User Story:** As a 运营人员, I want 新店铺从接入到上线的全流程在 30 分钟内完成, so that 能够快速响应业务扩展需求。

#### Acceptance Criteria

1. THE Onboarding_Agent SHALL 确保标准流程（渠道连接 + 基础配置 + SKU 映射 + 规则设置 + 上线验证）的总耗时不超过 30 分钟
2. WHEN SKU 数量不超过 500 条时, THE SKU_Mapper SHALL 在 3 分钟内完成自动匹配
3. THE Configuration_Validator SHALL 在 2 分钟内完成全部验证项检测
4. THE Onboarding_Agent SHALL 在流程结束时记录总耗时并生成流程效率报告

### Requirement 12: SKU 映射准确率

**User Story:** As a 运营人员, I want SKU 自动匹配的准确率达到 85% 以上, so that 减少人工修正的工作量。

#### Acceptance Criteria

1. THE SKU_Mapper SHALL 对自动匹配结果进行准确率统计，计算公式为：正确匹配数 / 总匹配数 × 100%
2. WHEN 用户确认或修正匹配结果后, THE SKU_Mapper SHALL 更新准确率统计数据
3. THE SKU_Mapper SHALL 将用户修正的匹配对作为训练样本，持续优化匹配算法
4. THE SKU_Mapper SHALL 在 Onboarding 流程结束时展示本次映射的准确率报告
5. IF 整体匹配准确率低于 85%, THEN THE SKU_Mapper SHALL 在报告中标注并建议检查数据质量

