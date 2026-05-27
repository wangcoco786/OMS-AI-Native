# Implementation Plan: OMS AI Native M1

## Overview

本实现计划将 M1 里程碑的设计分解为可执行的编码任务，从基础设施层（Layer 4）开始逐步向上构建，最终交付一个端到端可运行的订单查询 Agent。实现语言为 TypeScript，运行时为 Node.js + Express。

## Tasks

- [x] 1. 项目初始化与基础设施搭建
  - [x] 1.1 初始化 Node.js + TypeScript 项目结构
    - 创建 monorepo 或模块化目录结构（src/infrastructure, src/agent-runtime, src/backend, src/domain-agents）
    - 配置 TypeScript（tsconfig.json）、ESLint、Prettier
    - 配置 package.json scripts（build, test, lint, migrate）
    - 安装核心依赖：express, pg, ioredis, amqplib, ws, fast-check, vitest
    - _Requirements: 5.1, 5.4_

  - [x] 1.2 创建 Docker Compose 开发环境
    - 编写 docker-compose.yml 包含 PostgreSQL、Redis、RabbitMQ 服务
    - 配置环境变量模板（.env.example）
    - 编写数据库初始化脚本
    - _Requirements: 5.1, 5.2, 6.1_

  - [x] 1.3 实现数据库迁移框架与初始 Schema
    - 选择并配置迁移工具（如 node-pg-migrate）
    - 创建初始迁移文件：tenants, users, agents, agent_sessions, tools, tool_calls, orders, llm_call_logs, audit_logs 表
    - 实现 migrate up/down 命令
    - _Requirements: 5.1, 5.4_

- [x] 2. 数据库服务层实现
  - [x] 2.1 实现 PostgreSQL 连接池与查询服务
    - 实现 DatabaseService 接口（query, transaction, migrate 方法）
    - 实现连接池管理（支持 100+ 并发连接）
    - 实现多租户数据隔离（所有查询自动注入 tenant_id 过滤）
    - 实现连接失败自动重试与告警机制
    - _Requirements: 5.1, 5.3, 5.5, 5.6_

  - [ ]* 2.2 编写租户数据隔离属性测试
    - **Property 9: 租户数据隔离**
    - 使用 fast-check 生成多租户数据，验证查询结果仅包含当前租户数据
    - **Validates: Requirements 5.3, 9.6**

  - [x] 2.3 实现 Redis 缓存服务
    - 实现 cacheGet, cacheSet, cacheDel 方法
    - 实现 TTL 管理和 key 命名规范
    - 实现会话上下文存储（session:{sessionId}:context）
    - 实现租户配额计数器（tenant:{tenantId}:llm_calls）
    - _Requirements: 5.2_

  - [ ]* 2.4 编写数据库服务单元测试
    - 测试连接池管理、事务处理、错误重试逻辑
    - 测试 Redis 缓存 TTL 过期行为
    - _Requirements: 5.5, 5.6_

- [x] 3. 消息队列服务实现
  - [x] 3.1 实现 RabbitMQ 消息代理服务
    - 实现 MessageBroker 接口（publish, subscribe, send 方法）
    - 配置 Exchange（agent.events topic, system.events fanout）
    - 配置 Queue 绑定（agent.status.changes, tool.call.logs, audit.logs）
    - 实现消息持久化配置
    - _Requirements: 6.1, 6.4, 6.5_

  - [x] 3.2 实现死信队列与重试机制
    - 配置死信交换机（DLX）和死信队列
    - 实现消费失败后的重试逻辑（指数退避，最多 5 次）
    - 实现失败消息转入死信队列并记录失败原因
    - _Requirements: 6.2, 6.3_

  - [x] 3.3 实现队列监控指标接口
    - 实现 getQueueStats 方法（队列深度、消费延迟）
    - 暴露监控指标供外部采集
    - _Requirements: 6.6_

  - [ ]* 3.4 编写消息队列属性测试
    - **Property 10: 消息至少投递一次**
    - **Property 11: 失败消息进入死信队列**
    - **Property 12: Topic 路由正确性**
    - 使用 fast-check 生成随机 routing key 和 binding pattern，验证路由正确性
    - **Validates: Requirements 6.2, 6.3, 6.4**

- [x] 4. Checkpoint - 基础设施层验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. LLM Gateway 实现
  - [x] 5.1 实现 LLM Gateway 核心服务
    - 实现 LLMGateway 接口（complete, stream, getUsage 方法）
    - 实现 Claude API 请求转发与响应解析
    - 实现流式响应处理（AsyncIterable<StreamEvent>）
    - 实现多租户 API Key 配置隔离
    - _Requirements: 1.1, 1.2, 1.4, 1.6_

  - [x] 5.2 实现 LLM 调用配额与速率限制
    - 基于 Redis 实现租户级别的速率限制（requests per minute）
    - 实现配额超限时的拒绝策略
    - _Requirements: 1.6_

  - [x] 5.3 实现 LLM 错误处理与重试策略
    - 实现指数退避重试（超时、速率限制、服务不可用）
    - 实现结构化错误响应（error code, message, traceId, timestamp）
    - 实现降级策略（API 不可用时返回友好提示）
    - _Requirements: 1.3_

  - [x] 5.4 实现 LLM 调用日志记录
    - 记录每次调用的 tenant_id, session_id, model, input_tokens, output_tokens, latency_ms, status
    - 写入 llm_call_logs 表
    - _Requirements: 1.5_

  - [ ]* 5.5 编写 LLM Gateway 属性测试
    - **Property 1: 错误处理结构化响应**
    - **Property 2: LLM 调用日志完整性**
    - **Property 3: 租户配置隔离**
    - 使用 fast-check 生成各种错误类型，验证响应结构完整性
    - **Validates: Requirements 1.3, 1.5, 1.6**

  - [ ]* 5.6 编写 LLM Gateway 单元测试
    - 测试请求转发、流式响应处理、配额检查、重试逻辑
    - Mock Claude API 响应
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 6. Agent SDK Wrapper 实现
  - [x] 6.1 实现 Agent SDK Wrapper 核心功能
    - 封装 Claude Agent SDK 的 Tool Use 协议
    - 实现 createSession, chat, closeSession 方法
    - 实现 AgentEvent 流式事件（text_delta, tool_use, tool_result, end, error）
    - _Requirements: 2.1, 2.3_

  - [x] 6.2 实现上下文窗口管理与压缩
    - 实现 token 计数和上下文窗口监控
    - 实现 compressContext 方法（保留 system prompt + 最近 N 条消息）
    - 当上下文超过阈值时自动触发压缩
    - _Requirements: 2.2, 2.4_

  - [x] 6.3 实现 MCP 协议格式转换
    - 实现 Tool 定义到 MCP 格式的转换
    - 实现 MCP 请求构造和响应解析
    - 实现工具调用失败时的错误传递
    - _Requirements: 2.3, 2.5_

  - [ ]* 6.4 编写 Agent SDK 属性测试
    - **Property 4: 上下文压缩保持限制**
    - **Property 5: MCP 协议格式一致性**
    - 使用 fast-check 生成超长消息序列，验证压缩后满足约束
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [ ]* 6.5 编写 Agent SDK 单元测试
    - 测试会话创建/关闭、消息格式化、错误处理
    - _Requirements: 2.1, 2.5_

- [x] 7. MCP Tool Registry 实现
  - [x] 7.1 实现 Tool 注册与发现服务
    - 实现 MCPToolRegistry 接口（register, unregister, discover 方法）
    - 实现 Tool 定义存储（PostgreSQL tools 表 + Redis 缓存）
    - 实现热插拔注册（注册后立即可用，无需重启）
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 7.2 实现 Tool 参数校验
    - 实现 JSON Schema 校验（validate 方法）
    - 校验失败时返回具体违规字段和原因
    - _Requirements: 3.4, 3.6_

  - [x] 7.3 实现 Tool 调用分发与日志记录
    - 实现 invoke 方法，将调用分发到 Tool Sandbox
    - 记录每次调用的 tool_name, caller_id, tenant_id, trace_id, input, output, execution_time_ms, success
    - 写入 tool_calls 表
    - _Requirements: 3.5_

  - [ ]* 7.4 编写 MCP Tool Registry 属性测试
    - **Property 6: Tool 注册与发现不变量**
    - **Property 7: Schema 校验正确性**
    - **Property 8: Tool 调用日志完整性**
    - 使用 fast-check 生成随机 Tool 定义和输入数据，验证注册/发现/校验的正确性
    - **Validates: Requirements 3.1, 3.2, 3.4, 3.5, 3.6**

- [x] 8. Tool Sandbox 实现
  - [x] 8.1 实现 V8 Isolate 轻量沙箱
    - 实现 ToolSandbox 接口（execute, terminate, getStatus 方法）
    - 使用 isolated-vm 或类似库实现 V8 隔离执行
    - 实现 CPU 时间、内存用量限制
    - 实现执行超时终止机制
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 8.2 实现 Docker 容器沙箱
    - 实现 Docker 容器创建和执行逻辑
    - 实现网络策略限制和文件系统路径白名单
    - 实现执行完成后的环境清理
    - _Requirements: 4.1, 4.4, 4.5_

  - [ ]* 8.3 编写 Tool Sandbox 单元测试
    - 测试资源限制、超时终止、安全隔离
    - 测试恶意代码防护场景
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 9. Checkpoint - Agent 基础设施验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. 认证与权限服务实现
  - [x] 10.1 实现 Auth Service 认证模块
    - 实现 AuthService 接口（authenticate, generateToken, refreshToken 方法）
    - 实现 JWT Token 生成与验证
    - 实现 IAM SSO 认证集成（预留接口）
    - _Requirements: 11.1, 11.3_

  - [x] 10.2 实现 RBAC 权限控制
    - 实现 authorize 方法（基于角色和权限的访问控制）
    - 实现权限中间件（Express middleware）
    - 实现未认证（401）和未授权（403）的错误响应
    - _Requirements: 11.2, 11.4_

  - [x] 10.3 实现安全审计日志
    - 记录所有认证失败和权限拒绝事件
    - 写入 audit_logs 表（actor_id, action, resource, reason, timestamp）
    - _Requirements: 11.5_

  - [ ]* 10.4 编写 RBAC 属性测试
    - **Property 21: RBAC 授权正确性**
    - **Property 22: 安全审计日志**
    - 使用 fast-check 生成角色/权限组合，验证授权逻辑正确性
    - **Validates: Requirements 11.2, 11.5**

  - [ ]* 10.5 编写认证服务单元测试
    - 测试 Token 生成/验证、角色匹配、中间件拦截
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 11. 可观测性与链路追踪实现
  - [x] 11.1 实现 Trace ID 生成与传播
    - 实现全局唯一 trace ID 生成器
    - 实现请求级别的 trace ID 注入（Express middleware）
    - 确保 trace ID 贯穿 LLM 调用、Tool 调用、消息队列全链路
    - _Requirements: 12.1_

  - [x] 11.2 实现决策步骤日志记录
    - 记录 Agent 交互的完整决策链路（意图识别 → Tool 选择 → Tool 调用 → 响应生成）
    - 每个步骤关联同一 trace_id
    - 写入 audit_logs 表
    - _Requirements: 12.2_

  - [x] 11.3 实现性能指标采集与告警
    - 采集关键指标（响应时间、错误率、并发会话数）
    - 实现响应时间超过 3 秒的性能告警
    - 暴露 /metrics 端点供 Prometheus 采集
    - _Requirements: 12.3, 12.4_

  - [ ]* 11.4 编写可观测性属性测试
    - **Property 23: Trace ID 唯一性**
    - **Property 24: 决策步骤日志**
    - 使用 fast-check 批量生成 trace ID，验证全局唯一性
    - **Validates: Requirements 12.1, 12.2**

- [x] 12. Agent Platform 实现
  - [x] 12.1 实现 Agent 注册与管理服务
    - 实现 AgentPlatform 接口（registerAgent, updateAgent, getAgent, listAgents 方法）
    - 实现 Agent 唯一标识符分配
    - 实现 Agent 版本管理（多版本共存）
    - 实现 Agent 查询过滤（按 type, status, tenant_id）
    - _Requirements: 7.1, 7.3, 7.4, 7.6_

  - [x] 12.2 实现 Agent 生命周期状态机
    - 实现状态转换逻辑（registered → ready → running → paused → stopped）
    - 拒绝非法状态转换并返回错误
    - 状态变更时发布事件到消息队列
    - _Requirements: 7.2, 7.5_

  - [x] 12.3 实现 Agent 请求路由与负载均衡
    - 实现 route 方法（根据意图类型路由到对应 Agent）
    - 实现负载均衡策略（同类型多实例间均匀分配）
    - 实现上下文传播（tenant_id, user_id, roles, permissions）
    - 实现不可用时的错误处理与告警
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 12.4 编写 Agent Platform 属性测试
    - **Property 13: Agent 生命周期状态机**
    - **Property 14: 状态变更事件发布**
    - **Property 15: Agent 查询过滤正确性**
    - **Property 16: 意图路由正确性**
    - **Property 17: 负载均衡分布**
    - **Property 18: 上下文传播完整性**
    - 使用 fast-check 生成状态转换序列和路由请求，验证状态机和路由逻辑
    - **Validates: Requirements 7.1, 7.2, 7.5, 7.6, 8.1, 8.2, 8.5**

  - [ ]* 12.5 编写 Agent Platform 单元测试
    - 测试注册、状态转换、路由选择、负载均衡
    - _Requirements: 7.1, 7.2, 8.1, 8.2_

- [x] 13. Checkpoint - Agent Platform 验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. WebSocket / SSE 实时通信实现
  - [x] 14.1 实现 WebSocket 连接管理
    - 实现 WebSocketManager（handleConnection, handleDisconnect, sendToUser 方法）
    - 实现用户活跃连接追踪（Redis Set）
    - 实现连接断开后 5 秒内自动重连机制
    - 支持同一用户多会话并发
    - _Requirements: 10.1, 10.3, 10.4_

  - [x] 14.2 实现 SSE 流式推送服务
    - 实现 SSEManager（createStream, pushEvent, closeStream 方法）
    - 实现 Agent 流式响应的实时推送
    - 实现会话空闲 30 分钟自动关闭
    - _Requirements: 10.2, 10.5_

  - [ ]* 14.3 编写实时通信单元测试
    - 测试连接管理、消息路由、断线重连、会话超时
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 15. 订单查询 Domain Agent 实现
  - [x] 15.1 实现订单查询 Tool
    - 实现 query_orders Tool（按 MCP 协议定义输入/输出 schema）
    - 支持按订单号、时间范围、状态、店铺等条件查询
    - 实现分页查询逻辑
    - 注册 Tool 到 MCP Tool Registry
    - _Requirements: 9.1, 9.2_

  - [x] 15.2 实现 Order Query Agent 定义与注册
    - 定义 Agent 的 system prompt（订单查询领域专家角色）
    - 配置 Agent 可用的 Tool 列表（query_orders）
    - 注册 Agent 到 Agent Platform
    - _Requirements: 9.1_

  - [x] 15.3 实现订单查询结果格式化
    - 实现查询结果的结构化格式化（订单号、状态、金额、时间）
    - 实现查询条件不明确时的追问逻辑
    - 确保仅返回当前租户的订单数据
    - _Requirements: 9.3, 9.4, 9.6_

  - [x] 15.4 实现订单查询审计日志
    - 记录每次查询的 user_id, query_conditions, result_count, timestamp
    - 写入 audit_logs 表
    - _Requirements: 9.7_

  - [ ]* 15.5 编写订单查询属性测试
    - **Property 19: 订单查询响应格式**
    - **Property 20: 审计日志完整性**
    - 使用 fast-check 生成订单查询结果，验证响应格式完整性
    - **Validates: Requirements 9.3, 9.7**

  - [ ]* 15.6 编写订单查询 Agent 单元测试
    - 测试意图解析、Tool 调用、结果格式化、追问逻辑
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 16. API Gateway 与端到端集成
  - [x] 16.1 实现 Express API Gateway
    - 创建 Express 应用入口
    - 实现路由注册（/api/v1/agents, /api/v1/tools, /api/v1/sessions）
    - 集成认证中间件、trace ID 中间件、错误处理中间件
    - 实现 CORS 和请求体解析配置
    - _Requirements: 11.1, 11.2, 12.1_

  - [x] 16.2 端到端集成：用户查询 → Agent 响应
    - 将所有组件串联：WebSocket → Agent Platform → Agent SDK → LLM Gateway → Tool → 响应
    - 实现完整的请求处理流程
    - 验证流式响应从 LLM 到用户的完整链路
    - _Requirements: 9.1, 9.5, 10.1, 10.2_

  - [ ]* 16.3 编写端到端集成测试
    - 测试完整查询链路（Mock Claude API）
    - 测试多租户并发查询隔离
    - 测试错误场景（LLM 超时、Tool 失败）
    - _Requirements: 9.1, 9.5, 9.6_

- [x] 17. Final Checkpoint - 全系统验证
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选任务，可跳过以加速 MVP 交付
- 每个任务引用了具体的需求条款以确保可追溯性
- Checkpoint 任务确保增量验证，及时发现问题
- Property 测试验证系统的通用正确性属性（使用 fast-check）
- 单元测试验证具体的示例和边界情况
- 所有代码使用 TypeScript 实现，运行在 Node.js 环境
