# Requirements Document

## Introduction

本文档定义 OMS AI Native 系统 M1 里程碑的需求。M1 聚焦于搭建系统基础设施层（Layer 4）、Agent Platform（Layer 3 核心）以及首个 Domain Agent（订单查询），为后续里程碑提供坚实的技术底座。

M1 的核心目标是：建立 LLM 接入能力、标准化 MCP Tool 层、消息队列与数据库基础设施，实现 Agent 的注册管理与分发机制，并交付一个可运行的订单查询 Agent 作为端到端验证。

## Glossary

- **LLM_Gateway**：大语言模型网关服务，负责统一接入和管理 Claude API 调用
- **Agent_SDK**：基于 Claude Agent SDK 封装的 Agent 运行时组件，提供工具调用和上下文管理能力
- **MCP_Tool_Registry**：MCP 协议标准化工具注册中心，管理所有 Tool 的注册、发现和调用
- **Message_Broker**：消息队列中间件（RabbitMQ），负责异步消息传递和事件驱动通信
- **Database_Service**：数据库服务层，包含 PostgreSQL（业务数据）、Redis（缓存/会话）
- **Agent_Platform**：Agent 平台服务，负责 Agent 的注册、生命周期管理和任务分发
- **Order_Query_Agent**：订单查询领域 Agent，处理用户的订单查询请求
- **Tool_Sandbox**：工具沙箱执行环境，隔离 Tool 的运行以保障系统安全
- **Tenant**：租户，系统中的独立组织单元，数据和配置相互隔离
- **Agent_Session**：Agent 会话，用户与 Agent 交互的一次完整对话上下文
- **MCP_Protocol**：Model Context Protocol，标准化 AI 工具调用的协议规范

## Requirements

### Requirement 1: LLM 网关接入

**User Story:** As a 开发人员, I want 通过统一网关调用 Claude API, so that 系统具备 LLM 推理能力且便于后续扩展多模型支持。

#### Acceptance Criteria

1. THE LLM_Gateway SHALL 提供标准化的 HTTP API 接口用于发送 prompt 并接收 LLM 响应
2. WHEN 收到推理请求时, THE LLM_Gateway SHALL 将请求转发至 Claude API 并在 3 秒内返回响应
3. IF Claude API 返回错误或超时, THEN THE LLM_Gateway SHALL 返回结构化错误信息并记录错误日志
4. THE LLM_Gateway SHALL 支持流式响应（streaming），将 LLM 输出实时推送给调用方
5. WHILE 系统运行期间, THE LLM_Gateway SHALL 记录每次调用的 token 用量、延迟和状态
6. THE LLM_Gateway SHALL 按 Tenant 维度隔离 API Key 配置和调用配额

### Requirement 2: Claude Agent SDK 集成

**User Story:** As a 开发人员, I want 集成 Claude Agent SDK 作为 Agent 运行时, so that Agent 能够使用标准化的工具调用和上下文管理能力。

#### Acceptance Criteria

1. THE Agent_SDK SHALL 封装 Claude Agent SDK 的 Tool Use 协议，提供标准化的工具注册和调用接口
2. THE Agent_SDK SHALL 管理 Agent 会话的上下文窗口，支持上下文压缩以适应 token 限制
3. WHEN Agent 需要调用工具时, THE Agent_SDK SHALL 按照 MCP 协议格式构造工具调用请求并解析响应
4. WHEN 会话上下文超过 token 限制时, THE Agent_SDK SHALL 自动压缩历史上下文并保留关键信息
5. IF 工具调用执行失败, THEN THE Agent_SDK SHALL 向 Agent 返回错误信息以便 Agent 决定后续动作

### Requirement 3: MCP Tool 标准层

**User Story:** As a 开发人员, I want 按 MCP 协议标准化所有 Tool 的注册和调用, so that 新 Tool 可以热插拔接入且 Agent 能自动发现可用工具。

#### Acceptance Criteria

1. THE MCP_Tool_Registry SHALL 提供 Tool 注册接口，接受符合 MCP 协议的 Tool 定义（名称、描述、输入 schema、输出 schema）
2. THE MCP_Tool_Registry SHALL 提供 Tool 发现接口，返回当前可用的 Tool 列表及其元数据
3. WHEN 新 Tool 注册成功后, THE MCP_Tool_Registry SHALL 立即使该 Tool 对已授权的 Agent 可用，无需重启系统
4. WHEN Agent 发起 Tool 调用时, THE MCP_Tool_Registry SHALL 验证调用参数是否符合 Tool 的输入 schema
5. THE MCP_Tool_Registry SHALL 记录每次 Tool 调用的请求参数、响应结果、执行耗时和调用方信息
6. IF Tool 调用参数不符合 schema, THEN THE MCP_Tool_Registry SHALL 返回参数校验错误详情

### Requirement 4: Tool 沙箱执行

**User Story:** As a 系统管理员, I want Tool 在隔离的沙箱环境中执行, so that 恶意或异常的 Tool 不会影响主系统的稳定性和安全性。

#### Acceptance Criteria

1. THE Tool_Sandbox SHALL 在独立的隔离环境中执行每个 Tool 调用
2. THE Tool_Sandbox SHALL 限制 Tool 执行的 CPU 时间、内存用量和网络访问范围
3. IF Tool 执行超过资源限制, THEN THE Tool_Sandbox SHALL 终止该 Tool 执行并返回超时错误
4. THE Tool_Sandbox SHALL 阻止 Tool 访问未授权的文件系统路径和网络地址
5. WHEN Tool 执行完成后, THE Tool_Sandbox SHALL 清理执行环境释放资源

### Requirement 5: 数据库服务

**User Story:** As a 开发人员, I want 建立标准化的数据库服务层, so that 业务数据、Agent 数据和缓存数据有统一的访问方式和隔离策略。

#### Acceptance Criteria

1. THE Database_Service SHALL 使用 PostgreSQL 存储业务数据（订单、Agent 配置、租户信息）
2. THE Database_Service SHALL 使用 Redis 存储会话缓存和 Agent 短期记忆数据
3. THE Database_Service SHALL 按 Tenant 维度隔离数据，确保租户之间无法访问彼此的数据
4. THE Database_Service SHALL 提供数据库迁移机制，支持 schema 版本管理和回滚
5. WHEN 数据库连接失败时, THE Database_Service SHALL 自动重试连接并在重试耗尽后触发告警
6. THE Database_Service SHALL 支持连接池管理，维持 100+ 并发连接的稳定性

### Requirement 6: 消息队列服务

**User Story:** As a 开发人员, I want 建立消息队列基础设施, so that 系统模块之间通过异步消息通信实现松耦合和削峰填谷。

#### Acceptance Criteria

1. THE Message_Broker SHALL 提供消息发布和订阅接口，支持点对点和发布/订阅两种模式
2. THE Message_Broker SHALL 保证消息至少投递一次（at-least-once delivery）
3. WHEN 消费者处理消息失败时, THE Message_Broker SHALL 将消息放入死信队列并记录失败原因
4. THE Message_Broker SHALL 支持按 Topic 路由消息到对应的消费者组
5. THE Message_Broker SHALL 支持消息持久化，确保系统重启后未消费的消息不丢失
6. WHILE 系统运行期间, THE Message_Broker SHALL 提供队列深度、消费延迟等监控指标

### Requirement 7: Agent 注册与生命周期管理

**User Story:** As a 开发人员, I want 通过 Agent Platform 注册和管理 Agent, so that 系统能够统一管理所有 Agent 的生命周期和配置。

#### Acceptance Criteria

1. THE Agent_Platform SHALL 提供 Agent 注册接口，接受 Agent 定义（名称、类型、能力描述、可用 Tool 列表）
2. THE Agent_Platform SHALL 管理 Agent 的生命周期状态（注册、就绪、运行中、暂停、停止）
3. WHEN Agent 注册成功后, THE Agent_Platform SHALL 为该 Agent 分配唯一标识符并初始化其运行配置
4. THE Agent_Platform SHALL 提供 Agent 版本管理能力，支持同一 Agent 的多版本共存
5. WHEN Agent 状态发生变更时, THE Agent_Platform SHALL 发布状态变更事件到消息队列
6. THE Agent_Platform SHALL 提供 Agent 查询接口，支持按类型、状态、租户筛选 Agent 列表

### Requirement 8: 多类型 Agent 分发

**User Story:** As a 系统管理员, I want 按业务场景将用户请求分发到对应类型的 Agent, so that 不同领域的请求由专业的 Agent 处理。

#### Acceptance Criteria

1. THE Agent_Platform SHALL 根据用户请求的意图将请求路由到对应类型的 Agent 实例
2. WHEN 目标 Agent 类型有多个实例时, THE Agent_Platform SHALL 按负载均衡策略选择实例
3. IF 目标 Agent 实例不可用, THEN THE Agent_Platform SHALL 返回服务不可用错误并记录告警
4. THE Agent_Platform SHALL 支持 100+ 并发 Agent 会话的同时分发
5. WHEN 分发请求时, THE Agent_Platform SHALL 将租户上下文和用户权限信息传递给目标 Agent

### Requirement 9: 订单查询 Domain Agent

**User Story:** As a 运营人员, I want 通过自然语言查询订单信息, so that 无需记忆复杂的查询条件即可快速获取所需订单数据。

#### Acceptance Criteria

1. WHEN 用户发送订单查询的自然语言请求时, THE Order_Query_Agent SHALL 解析用户意图并调用对应的查询 Tool
2. THE Order_Query_Agent SHALL 支持按订单号、时间范围、订单状态、店铺来源等条件查询订单
3. WHEN 查询到结果时, THE Order_Query_Agent SHALL 以结构化格式返回订单列表及关键字段（订单号、状态、金额、时间）
4. IF 查询条件不明确, THEN THE Order_Query_Agent SHALL 向用户追问以澄清查询意图
5. WHEN 用户发送简单查询请求时, THE Order_Query_Agent SHALL 在 1 秒内返回响应
6. THE Order_Query_Agent SHALL 仅返回当前用户所属 Tenant 的订单数据
7. THE Order_Query_Agent SHALL 记录每次查询的用户、查询条件和结果摘要作为审计日志

### Requirement 10: Agent 通信与实时推送

**User Story:** As a 运营人员, I want 与 Agent 进行实时对话交互, so that 能够即时获得 Agent 的响应和状态更新。

#### Acceptance Criteria

1. THE Agent_SDK SHALL 通过 WebSocket 建立用户与 Agent 之间的实时双向通信通道
2. WHEN Agent 生成流式响应时, THE Agent_SDK SHALL 通过 SSE 将响应片段实时推送给用户
3. IF WebSocket 连接断开, THEN THE Agent_SDK SHALL 在 5 秒内自动重连并恢复会话上下文
4. THE Agent_SDK SHALL 支持同一用户同时维持多个 Agent 会话
5. WHEN Agent 会话空闲超过 30 分钟时, THE Agent_SDK SHALL 自动关闭会话并释放资源

### Requirement 11: 安全与认证

**User Story:** As a 系统管理员, I want 系统具备完整的认证和权限控制, so that 只有授权用户和 Agent 能够访问对应的资源。

#### Acceptance Criteria

1. THE Agent_Platform SHALL 通过 IAM SSO 认证用户身份
2. THE Agent_Platform SHALL 基于 RBAC 模型控制用户对 Agent 和 Tool 的访问权限
3. WHEN 用户未通过认证时, THE Agent_Platform SHALL 拒绝请求并返回 401 状态码
4. WHEN 用户无权限访问目标资源时, THE Agent_Platform SHALL 拒绝请求并返回 403 状态码
5. THE Agent_Platform SHALL 记录所有认证失败和权限拒绝事件到安全审计日志

### Requirement 12: 可观测性与监控

**User Story:** As a 系统管理员, I want 系统具备完整的调用链路追踪和监控能力, so that 能够快速定位问题并审计 Agent 的决策过程。

#### Acceptance Criteria

1. THE Agent_Platform SHALL 为每次 Agent 调用生成唯一的 trace ID，贯穿整个调用链路
2. THE Agent_Platform SHALL 记录 Agent 的每个决策步骤（意图识别、Tool 选择、Tool 调用、响应生成）
3. WHILE 系统运行期间, THE Agent_Platform SHALL 采集并暴露关键指标（响应时间、错误率、并发会话数）
4. WHEN Agent 响应时间超过 3 秒时, THE Agent_Platform SHALL 触发性能告警
5. THE Agent_Platform SHALL 保留决策审计日志至少 90 天
