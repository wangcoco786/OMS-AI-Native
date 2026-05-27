# Implementation Plan: OMS AI Native M2

## Overview

基于 M1 已有基础设施（PostgreSQL、Redis、RabbitMQ、LLM Gateway、Agent Platform、Auth/RBAC、WebSocket/SSE），实现 M2 里程碑的核心功能：Onboarding Agent、SKU Mapper、Dashboard、Data Sync Service。

技术栈：
- 后端：Node.js + Express + TypeScript（复用 M1）
- 前端：React + TypeScript + Vite（新增）
- 图表：Recharts
- 状态管理：Zustand
- HTTP 客户端：TanStack Query
- 数据同步队列：Bull Queue（基于 Redis）
- SKU 匹配：Claude API（通过 LLM Gateway）
- 测试：Vitest + fast-check + React Testing Library

## Tasks

- [x] 1. 数据库迁移 — 新增 M2 业务表
  - [x] 1.1 创建 M2 数据库迁移文件
    - 在 `migrations/` 目录下创建 `1700000002_m2-schema.sql`
    - 包含所有 M2 新增表：shops、onboarding_sessions、system_skus、channel_skus、sku_mappings、sku_mapping_corrections、inventory、warehouses、kpi_aggregations、sync_jobs、sync_job_runs、validation_reports
    - 创建所有索引（按设计文档定义）
    - 添加外键约束和 CHECK 约束
    - _Requirements: 9.7, 10.5, 1.2_

  - [x] 1.2 创建 M2 共享类型定义
    - 在 `src/shared/` 下新增 `m2-types.ts`
    - 定义所有 M2 核心接口：OnboardingSession、StepData、ChannelSKU、SystemSKU、SKUMatchResult、KPIMetrics、SyncJobConfig、SyncJobResult、ValidationReport 等
    - 定义枚举类型：OnboardingStep、SyncSource、SyncDataType、ValidationDimension 等
    - _Requirements: 1.1, 2.1, 5.1, 9.1_

- [x] 2. Data Sync Service — 多渠道数据同步
  - [x] 2.1 实现 Bull Queue 作业调度基础
    - 创建 `src/backend/data-sync/` 目录结构
    - 实现 `queue-manager.ts`：初始化 Bull Queue、注册 Cron 作业、管理作业生命周期
    - 实现 `sync-job-repository.ts`：sync_jobs 和 sync_job_runs 表的 CRUD 操作
    - 实现 Cron 表达式验证（间隔 ≥ 5 分钟且 ≤ 24 小时）
    - _Requirements: 9.1, 9.2_

  - [ ]* 2.2 编写 Property Test — 同步频率验证
    - **Property 16: 同步频率验证**
    - 验证 Cron 表达式间隔 < 5 分钟或 > 24 小时时被拒绝，[5min, 24h] 范围内被接受
    - **Validates: Requirements 9.2**

  - [x] 2.3 实现增量同步 Worker
    - 创建 `sync-worker.ts`：处理 Bull Queue 中的同步作业
    - 实现增量同步逻辑：基于 lastSyncCursor 过滤数据，仅拉取变更记录
    - 实现同步完成后更新 lastSyncCursor
    - 实现同步运行记录写入（records_processed、records_created、records_updated、duration_ms）
    - _Requirements: 9.3, 9.5_

  - [ ]* 2.4 编写 Property Test — 增量同步游标与运行记录
    - **Property 17: 增量同步游标正确性**
    - 验证处理的数据仅包含时间戳晚于 lastSyncCursor 的记录，执行后游标更新为最新时间戳
    - **Property 20: 同步运行记录完整性**
    - 验证运行记录包含所有必要字段且 records_created + records_updated ≤ records_processed
    - **Validates: Requirements 9.3, 9.5**

  - [x] 2.5 实现重试与冲突解决策略
    - 创建 `retry-strategy.ts`：指数退避重试（baseDelay × 2^(N-1)，最多 3 次）
    - 创建 `conflict-resolver.ts`：渠道数据优先策略，记录冲突详情
    - 集成到 sync-worker 中
    - _Requirements: 9.4, 9.6_

  - [ ]* 2.6 编写 Property Test — 重试退避与冲突解决
    - **Property 18: 同步重试指数退避**
    - 验证第 N 次重试延迟 = baseDelay × 2^(N-1)，超过 3 次标记为最终失败
    - **Property 19: 同步冲突解决（渠道优先）**
    - 验证冲突解决后最终值等于远程数据值，冲突记录包含完整信息
    - **Validates: Requirements 9.4, 9.6**

  - [x] 2.7 实现渠道适配器（Shopify/WMS/ERP）
    - 创建 `adapters/` 目录，定义 `SyncAdapter` 接口
    - 实现 `shopify-adapter.ts`：Shopify API 数据拉取（订单、商品、库存）
    - 实现 `wms-adapter.ts`：WMS API 数据拉取（库存、出入库记录）
    - 实现 `erp-adapter.ts`：ERP API 数据拉取（商品主数据、供应商信息）
    - _Requirements: 9.1_

  - [x] 2.8 实现 Data Sync REST API
    - 创建 `src/backend/routes/sync.ts`：同步作业管理路由
    - 实现 CRUD 端点：POST/GET/PUT/DELETE /api/sync-jobs
    - 实现手动触发端点：POST /api/sync-jobs/:id/trigger
    - 实现同步历史查询：GET /api/sync-jobs/:id/history
    - 实现同步统计：GET /api/sync/stats
    - 集成 Auth 中间件，按 Tenant 隔离
    - _Requirements: 9.1, 9.5, 9.7_

  - [ ]* 2.9 编写 Data Sync 单元测试
    - 测试 queue-manager 作业调度逻辑
    - 测试 sync-worker 增量同步流程
    - 测试各渠道适配器数据转换
    - 测试错误处理和降级逻辑
    - _Requirements: 9.1, 9.3, 9.4_

- [x] 3. Checkpoint — 确保 Data Sync 模块测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. SKU Mapper Service — AI 驱动的 SKU 匹配
  - [x] 4.1 实现 SKU Mapper 核心匹配逻辑
    - 创建 `src/backend/sku-mapper/` 目录结构
    - 实现 `sku-mapper-service.ts`：batchMatch、matchSingle、confirmMatch 方法
    - 实现 LLM Prompt 构造：将 Channel SKU 属性和 System SKU 列表格式化为 Claude 可理解的 prompt
    - 实现 LLM 响应解析：提取置信度、匹配理由、差异点
    - 通过 LLM Gateway 调用 Claude API
    - _Requirements: 2.1, 2.2_

  - [x] 4.2 实现置信度分类与结果处理
    - 实现置信度分类逻辑：≥85 → high_confidence，0<c<85 → needs_review（附差异点），0/无匹配 → no_match
    - 实现无匹配时 suggestNewSku 逻辑：预填 Channel SKU 的 name 和 attributes
    - 实现 SKU 匹配结果持久化（sku_mappings 表）
    - _Requirements: 2.3, 2.4, 2.7_

  - [ ]* 4.3 编写 Property Test — SKU 置信度分类与无匹配建议
    - **Property 4: SKU 置信度分类正确性**
    - 验证置信度分数与 matchType 的映射关系正确
    - **Property 6: 无匹配时建议创建新 SKU**
    - 验证无匹配时 suggestNewSku=true 且预填属性包含原始信息
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.7**

  - [x] 4.4 实现降级策略与学习机制
    - 实现 `fallback-matcher.ts`：规则匹配（精确名称、标准化名称、属性相似度、历史修正）
    - 实现降级链：LLM 匹配 → 规则匹配 → 标记人工处理
    - 实现 `learning-service.ts`：保存用户修正到 sku_mapping_corrections 表，后续匹配时参考历史修正
    - _Requirements: 2.5_

  - [x] 4.5 实现批量导入与准确率统计
    - 实现 `import-service.ts`：支持 CSV/API 格式批量导入 Channel SKU
    - 实现 `accuracy-service.ts`：计算准确率（confirmed / (confirmed + corrected) × 100%）
    - 实现低准确率预警（< 85% 时附带数据质量警告）
    - _Requirements: 2.6, 2.8, 12.1, 12.2, 12.5_

  - [ ]* 4.6 编写 Property Test — 批量导入与准确率
    - **Property 5: 批量导入记录数保持**
    - 验证导入后数据库新增记录数等于输入有效记录数
    - **Property 23: SKU 匹配准确率计算**
    - 验证准确率公式 = confirmed / (confirmed + corrected) × 100%
    - **Property 24: 低准确率预警**
    - 验证准确率 < 85% 时包含警告，≥ 85% 时不包含
    - **Validates: Requirements 2.6, 12.1, 12.5**

  - [x] 4.7 实现 SKU Mapper REST API
    - 创建 `src/backend/routes/sku-mapper.ts`
    - 实现批量匹配端点：POST /api/sku-mapper/batch-match
    - 实现单条匹配端点：POST /api/sku-mapper/match
    - 实现确认/修正端点：PUT /api/sku-mapper/mappings/:id/confirm
    - 实现批量导入端点：POST /api/sku-mapper/import
    - 实现准确率统计端点：GET /api/sku-mapper/stats
    - _Requirements: 2.1, 2.5, 2.6, 12.1_

  - [ ]* 4.8 编写 SKU Mapper 单元测试
    - 测试 LLM prompt 构造和响应解析
    - 测试降级策略链路
    - 测试批量导入数据转换
    - 测试准确率计算边界情况
    - _Requirements: 2.1, 2.2, 2.5, 12.1_

- [x] 5. Checkpoint — 确保 SKU Mapper 模块测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Onboarding Agent Service — AI 引导流程
  - [x] 6.1 实现 Onboarding 会话管理
    - 创建 `src/backend/onboarding/` 目录结构
    - 实现 `session-service.ts`：createSession、getSession、resumeSession
    - 实现会话初始状态：currentStep='channel_connection'、completedSteps=[]、interactionCount=0、status='in_progress'
    - 实现 Redis 缓存（TTL: 2h）+ PostgreSQL 持久化双写
    - _Requirements: 1.2_

  - [ ]* 6.2 编写 Property Test — 会话初始状态与持久化
    - **Property 1: Onboarding 会话初始状态**
    - 验证创建会话后所有初始字段正确
    - **Property 10: 会话状态持久化 Round-Trip**
    - 验证序列化存储后反序列化恢复的状态与原始完全一致
    - **Validates: Requirements 1.2, 4.6**

  - [x] 6.3 实现步骤流转与验证门控
    - 实现 `step-engine.ts`：submitStep、goBack、validateStep
    - 实现步骤验证逻辑：验证失败时 currentStep 不变、completedSteps 不增长；验证通过时前进并更新 completedSteps
    - 实现回退逻辑：保留已填写数据
    - 实现级联重验证：修改步骤 K 后，步骤 K+1 到 N 的 status 重置
    - _Requirements: 1.4, 1.6, 4.4, 4.5_

  - [ ]* 6.4 编写 Property Test — 步骤门控与回退
    - **Property 2: 步骤验证门控**
    - 验证验证失败时步骤不前进，验证通过时步骤前进
    - **Property 3: 步骤数据回退保留（Round-Trip）**
    - 验证回退后已填写数据与回退前完全一致
    - **Property 9: Onboarding 导航与级联重验证**
    - 验证跳转到已完成步骤成功，修改后后续步骤 status 被重置
    - **Validates: Requirements 1.4, 1.6, 4.4, 4.5**

  - [x] 6.5 实现步骤数据验证器
    - 创建 `validators/` 目录
    - 实现 `channel-connection-validator.ts`：验证渠道凭证格式和连接性
    - 实现 `basic-config-validator.ts`：验证基础配置字段完整性
    - 实现 `sku-mapping-validator.ts`：验证 SKU 映射覆盖率
    - 实现 `rule-setup-validator.ts`：验证物流规则配置
    - 每个验证器返回具体字段名和错误原因
    - _Requirements: 1.4, 4.2, 4.3_

  - [ ]* 6.6 编写 Property Test — 表单输入验证
    - **Property 8: 表单输入验证正确性**
    - 验证符合规则的输入被接受，不符合规则的输入被拒绝并返回具体字段名和原因
    - **Validates: Requirements 4.2, 4.3**

  - [x] 6.7 注册 Onboarding Agent 到 Agent Platform
    - 基于 M1 Agent SDK Wrapper 实现 Onboarding Agent 注册
    - 实现 Agent 会话管理（复用 Agent Platform 生命周期）
    - 实现帮助内容生成（每个步骤的上下文相关帮助）
    - 记录交互次数和步骤完成时间
    - _Requirements: 1.3, 1.5, 1.7_

  - [x] 6.8 实现 Onboarding REST API
    - 创建 `src/backend/routes/onboarding.ts`
    - 实现会话管理端点：POST/GET /api/onboarding/sessions
    - 实现步骤提交端点：POST /api/onboarding/sessions/:id/steps/:step
    - 实现回退端点：POST /api/onboarding/sessions/:id/back
    - 实现帮助端点：GET /api/onboarding/sessions/:id/help/:step
    - 集成 WebSocket 实时交互
    - _Requirements: 1.1, 1.3, 1.6_

  - [ ]* 6.9 编写 Onboarding Agent 单元测试
    - 测试会话 CRUD 操作
    - 测试步骤流转状态机
    - 测试各步骤验证器
    - 测试帮助内容生成
    - _Requirements: 1.2, 1.4, 1.5_

- [x] 7. Configuration Validator — 上线验证
  - [x] 7.1 实现配置验证器
    - 创建 `src/backend/onboarding/config-validator.ts`
    - 实现 4 个维度验证：渠道连接状态、SKU 映射覆盖率、物流规则配置、库存关联配置
    - 每个维度返回通过/未通过状态 + 修复建议
    - 实现 canGoLive 判断：所有维度通过时为 true
    - _Requirements: 3.1, 3.2, 3.5, 3.6_

  - [ ]* 7.2 编写 Property Test — 配置验证完整性
    - **Property 7: 配置验证完整性**
    - 验证结果包含所有 4 个维度，所有通过时 canGoLive=true，未通过项附带修复建议
    - **Validates: Requirements 3.1, 3.2, 3.5, 3.6**

  - [x] 7.3 实现订单流转模拟
    - 创建 `order-flow-simulator.ts`：模拟从订单创建到发货的完整链路
    - 实现各环节检查：订单接收 → SKU 解析 → 库存扣减 → 物流分配 → 发货确认
    - 失败时定位具体环节并返回错误原因
    - 生成验证报告并持久化到 validation_reports 表
    - _Requirements: 3.3, 3.4, 3.7_

  - [ ]* 7.4 编写 Configuration Validator 单元测试
    - 测试各维度验证逻辑
    - 测试订单流转模拟各环节
    - 测试验证报告生成
    - _Requirements: 3.1, 3.3_

- [x] 8. Checkpoint — 确保 Onboarding 和 Validator 模块测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Dashboard Service — 后端数据聚合
  - [x] 9.1 实现 KPI 聚合与查询
    - 创建 `src/backend/dashboard/` 目录结构
    - 实现 `kpi-aggregator.ts`：按 hour/day/week 粒度聚合 KPI 数据（orderCount、fulfillmentRate、returnRate、avgProcessingTime）
    - 实现 `kpi-query-service.ts`：查询 kpi_aggregations 表，支持维度筛选（shopId/channelId/warehouseId）
    - 实现 Redis 缓存策略（realtime: 60s, hourly: 5min, daily: 1h, weekly: 6h）
    - _Requirements: 5.1, 5.2, 5.4_

  - [ ]* 9.2 编写 Property Test — KPI 粒度与数据过滤
    - **Property 11: KPI 指标响应完整性与粒度正确性**
    - 验证返回包含所有 4 个核心指标，趋势数据点间隔与粒度一致
    - **Property 12: Dashboard 数据过滤与租户隔离**
    - 验证返回数据仅属于指定 tenantId，维度筛选正确
    - **Validates: Requirements 5.1, 5.2, 5.4, 5.6**

  - [x] 9.3 实现异常波动检测
    - 创建 `anomaly-detector.ts`：基于移动平均值和标准差检测异常
    - 当数据点偏离移动平均值超过 2 个标准差时标记 anomaly=true
    - 集成到 KPI 趋势查询中
    - _Requirements: 5.5_

  - [ ]* 9.4 编写 Property Test — 异常波动检测
    - **Property 13: 异常波动检测**
    - 验证偏离 > 2σ 时 anomaly=true，≤ 2σ 时 anomaly=false
    - **Validates: Requirements 5.5**

  - [x] 9.5 实现库存水位查询
    - 创建 `inventory-service.ts`：查询各仓库库存水位
    - 实现 utilizationRate 计算：currentStock/maxCapacity × 100
    - 实现 belowSafetyThreshold 判断：currentStock < safetyThreshold
    - 实现库存趋势查询
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

  - [ ]* 9.6 编写 Property Test — 库存水位计算
    - **Property 14: 库存水位计算与预警**
    - 验证 utilizationRate 计算精度 ≤ 0.01，belowSafetyThreshold 判断正确
    - **Validates: Requirements 7.1, 7.3**

  - [x] 9.7 实现班次工作台查询
    - 创建 `shift-service.ts`：按班次查询任务列表
    - 实现优先级排序（high < medium < low）
    - 实现进度计算：completedCount/totalCount
    - 实现交接任务统计：上一班次中 status ≠ 'completed' 的任务数
    - _Requirements: 8.1, 8.2, 8.4, 8.5_

  - [ ]* 9.8 编写 Property Test — 班次任务过滤与排序
    - **Property 15: 班次任务过滤、排序与进度计算**
    - 验证任务仅属于指定班次，优先级排序正确，进度计算正确，交接任务数正确
    - **Validates: Requirements 8.1, 8.2, 8.4, 8.5**

  - [x] 9.9 实现 Dashboard SSE 实时推送
    - 创建 `dashboard-sse.ts`：复用 M1 SSE Manager
    - 实现指标订阅：客户端订阅特定指标的实时更新
    - 实现变更通知：KPI 聚合完成后通过 SSE 推送最新数据
    - _Requirements: 5.3, 8.3_

  - [x] 9.10 实现 Dashboard REST API
    - 创建 `src/backend/routes/dashboard.ts`
    - 实现 KPI 端点：GET /api/dashboard/kpi、GET /api/dashboard/kpi/trend
    - 实现库存端点：GET /api/dashboard/inventory、GET /api/dashboard/inventory/trend
    - 实现班次端点：GET /api/dashboard/shift/tasks、GET /api/dashboard/shift/progress
    - 实现 SSE 订阅端点：GET /api/dashboard/subscribe
    - 集成 Auth 中间件，按 Tenant 隔离
    - _Requirements: 5.1, 5.6, 7.1, 8.1_

  - [ ]* 9.11 编写 Dashboard Service 单元测试
    - 测试 KPI 聚合逻辑
    - 测试缓存策略和降级
    - 测试 SSE 推送机制
    - 测试库存和班次查询
    - _Requirements: 5.1, 5.3, 7.1, 8.1_

- [x] 10. Checkpoint — 确保 Dashboard 模块测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. MCP Data Tools — Agent 数据查询工具
  - [x] 11.1 实现 MCP 订单查询工具
    - 创建 `src/backend/mcp-tools/` 目录结构
    - 实现 `order-query-tool.ts`：支持按订单号、状态、时间范围、渠道、店铺等条件查询
    - 定义 JSON Schema（输入/输出）
    - 实现参数校验：不合法参数返回结构化错误（违规字段名、期望类型、实际值）
    - 实现 Tenant 数据隔离
    - 注册到 MCP Tool Registry
    - _Requirements: 10.1, 10.4, 10.5, 10.6_

  - [x] 11.2 实现 MCP 库存查询工具
    - 实现 `inventory-query-tool.ts`：支持按 SKU、仓库、库存水位等条件查询
    - 定义 JSON Schema（输入/输出）
    - 实现参数校验和 Tenant 隔离
    - 注册到 MCP Tool Registry
    - _Requirements: 10.2, 10.4, 10.5, 10.6_

  - [x] 11.3 实现 MCP 商品/SKU 查询工具
    - 实现 `product-query-tool.ts`：支持按名称、属性、渠道、分类等条件查询
    - 定义 JSON Schema（输入/输出）
    - 实现参数校验和 Tenant 隔离
    - 注册到 MCP Tool Registry
    - _Requirements: 10.3, 10.4, 10.5, 10.6_

  - [x] 11.4 实现 MCP 查询缓存
    - 创建 `query-cache.ts`：对高频查询结果进行 Redis 缓存（TTL ≤ 60s）
    - 集成到所有 MCP Data Tools 中
    - _Requirements: 10.7_

  - [ ]* 11.5 编写 Property Test — MCP 查询过滤与错误结构
    - **Property 21: MCP 查询过滤正确性**
    - 验证返回结果恰好包含满足所有条件的记录
    - **Property 22: MCP 无效输入错误结构**
    - 验证无效参数返回包含违规字段名、期望类型和实际值的结构化错误
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.6**

  - [ ]* 11.6 编写 MCP Data Tools 单元测试
    - 测试各工具的查询构造逻辑
    - 测试参数校验和错误格式
    - 测试缓存命中和失效
    - 测试 Tenant 隔离
    - _Requirements: 10.1, 10.5, 10.6, 10.7_

- [x] 12. Checkpoint — 确保 MCP Data Tools 测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. 前端应用初始化与基础架构
  - [x] 13.1 初始化 React + Vite 前端项目
    - 在 `src/frontend/` 目录下初始化 Vite + React + TypeScript 项目
    - 配置 Zustand 状态管理
    - 配置 TanStack Query（HTTP 客户端 + 缓存）
    - 配置路由（React Router）
    - 配置 Recharts 图表库
    - 创建基础布局组件（Header、Sidebar、Main Content）
    - _Requirements: 4.1, 5.1_

  - [x] 13.2 实现通用 UI 组件
    - 创建 `src/frontend/components/common/` 目录
    - 实现 StepProgress 步骤条组件（展示进度和当前位置）
    - 实现 FormField 表单字段组件（含校验反馈）
    - 实现 DataTable 数据表格组件（排序、分页）
    - 实现 StatusBadge 状态标签组件
    - 实现 LoadingSpinner、ErrorBoundary 等基础组件
    - _Requirements: 4.1, 4.2_

- [x] 14. 前端 — Onboarding Wizard 模块
  - [x] 14.1 实现 Onboarding Wizard 页面框架
    - 创建 `src/frontend/pages/onboarding/` 目录
    - 实现 OnboardingWizard 主页面：步骤条 + 内容区 + 操作按钮
    - 实现 Zustand store：管理会话状态、当前步骤、步骤数据
    - 实现 TanStack Query hooks：会话 CRUD、步骤提交
    - _Requirements: 4.1, 4.6_

  - [x] 14.2 实现各步骤表单组件
    - 实现 ChannelConnectionStep：渠道类型选择、凭证输入、连接测试
    - 实现 BasicConfigStep：店铺基础信息表单
    - 实现 SKUMappingStep：SKU 匹配结果展示、确认/修正交互
    - 实现 RuleSetupStep：物流规则配置表单
    - 实现 ValidationStep：验证结果展示、上线确认
    - 每个步骤实现实时输入校验和即时反馈
    - _Requirements: 1.1, 1.3, 4.2, 4.3_

  - [x] 14.3 实现步骤导航与状态恢复
    - 实现步骤间自由跳转（已完成步骤）
    - 实现回退时数据保留
    - 实现页面刷新后状态恢复（从 API 重新加载会话）
    - 实现 WebSocket 连接：接收 Agent 实时反馈
    - _Requirements: 1.6, 4.4, 4.5, 4.6_

  - [ ]* 14.4 编写 Onboarding Wizard 前端组件测试
    - 使用 React Testing Library 测试步骤条渲染
    - 测试表单校验交互
    - 测试步骤导航逻辑
    - 测试状态恢复流程
    - _Requirements: 4.1, 4.2, 4.4_

- [x] 15. 前端 — SKU Mapping UI 模块
  - [x] 15.1 实现 SKU 映射结果展示
    - 创建 `src/frontend/pages/sku-mapping/` 目录
    - 实现 SKUMappingTable：展示匹配结果列表（Channel SKU、System SKU、置信度、状态）
    - 实现置信度颜色编码：高置信度（绿色）、需确认（黄色）、无匹配（红色）
    - 实现差异点高亮展示
    - _Requirements: 2.3, 2.4_

  - [x] 15.2 实现 SKU 匹配交互功能
    - 实现批量确认/拒绝操作
    - 实现手动修正：搜索并选择正确的 System SKU
    - 实现批量导入 UI：文件上传（CSV）+ 进度展示
    - 实现准确率统计展示
    - _Requirements: 2.5, 2.6, 12.1, 12.4_

  - [ ]* 15.3 编写 SKU Mapping UI 组件测试
    - 测试匹配结果表格渲染
    - 测试确认/修正交互
    - 测试批量导入流程
    - _Requirements: 2.3, 2.5, 2.6_

- [x] 16. 前端 — Dashboard 模块
  - [x] 16.1 实现 Dashboard KPI 面板
    - 创建 `src/frontend/pages/dashboard/` 目录
    - 实现 KPICards：展示 4 个核心指标卡片（订单量、履约率、退货率、平均处理时长）
    - 实现 KPITrendChart：使用 Recharts 折线图展示趋势
    - 实现时间粒度切换（小时/天/周）
    - 实现维度筛选器（店铺/渠道/仓库）
    - 实现异常标记视觉提示（颜色变化 + 图标）
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 16.2 实现 Dashboard 分时图
    - 实现自定义时间范围选择器
    - 实现数据点悬停 Tooltip（显示详细数值）
    - 实现多指标叠加对比
    - 实现事件节点标注
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 16.3 实现库存可视化面板
    - 实现 InventoryLevelChart：各仓库库存水位柱状图
    - 实现安全阈值预警标记（红色）
    - 实现库存周转率展示
    - 实现按 SKU 维度查看库存分布
    - 实现库存变化趋势图
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 16.4 实现班次工作台面板
    - 实现 ShiftTaskList：按班次展示任务列表
    - 实现任务进度条（已完成/总数）
    - 实现优先级/截止时间排序
    - 实现班次交接信息展示
    - _Requirements: 8.1, 8.2, 8.4, 8.5_

  - [x] 16.5 实现 Dashboard SSE 实时更新
    - 实现 SSE 连接管理（自动重连）
    - 实现实时数据更新（KPI 变化、新任务分配）
    - 实现 Zustand store 实时状态同步
    - _Requirements: 5.3, 8.3_

  - [ ]* 16.6 编写 Dashboard 前端组件测试
    - 测试 KPI 卡片和图表渲染
    - 测试时间粒度切换
    - 测试维度筛选
    - 测试库存和班次面板
    - 使用 MSW mock API 响应
    - _Requirements: 5.1, 5.2, 7.1, 8.1_

- [x] 17. Checkpoint — 确保前端模块测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. 端到端集成与路由注册
  - [x] 18.1 注册所有 M2 路由到 Express Gateway
    - 在 `src/backend/routes/` 或 `src/backend/api/` 中注册所有 M2 路由
    - 配置路由前缀：/api/onboarding、/api/sku-mapper、/api/dashboard、/api/sync-jobs
    - 集成 Auth 中间件到所有路由
    - 配置 CORS 允许前端访问
    - _Requirements: 1.1, 2.1, 5.1, 9.1_

  - [x] 18.2 集成 Onboarding 全流程
    - 连接 Onboarding Agent → SKU Mapper → Configuration Validator 完整链路
    - 确保 Onboarding 步骤 3（SKU 映射）正确调用 SKU Mapper Service
    - 确保 Onboarding 步骤 5（验证）正确调用 Configuration Validator
    - 确保完成后更新店铺状态为 'active'
    - _Requirements: 1.1, 2.1, 3.5, 11.1_

  - [x] 18.3 集成 Data Sync 与 Dashboard 数据链路
    - 确保 Data Sync 写入的数据能被 KPI Aggregator 正确聚合
    - 确保聚合结果通过 SSE 推送到 Dashboard 前端
    - 确保 MCP Data Tools 能查询到同步后的最新数据
    - _Requirements: 5.1, 9.1, 10.1_

  - [ ]* 18.4 编写端到端集成测试
    - 测试 Onboarding 全流程：创建会话 → 各步骤提交 → SKU 映射 → 验证 → 上线
    - 测试 Data Sync 链路：作业创建 → 触发同步 → 数据写入 → KPI 更新
    - 测试 Dashboard 数据链路：数据写入 → 聚合 → 缓存 → API 查询
    - 测试租户隔离：多租户并发操作验证数据隔离
    - _Requirements: 1.1, 5.1, 9.1, 9.7_

- [x] 19. Final Checkpoint — 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Task Dependency Graph

16.2 实现 Dashboard 分时图 -> 16.1 实现 Dashboard KPI 面板
16.3 实现库存可视化面板 -> 16.1 实现 Dashboard KPI 面板
16.4 实现班次工作台面板 -> 16.1 实现 Dashboard KPI 面板
16.5 实现 Dashboard SSE 实时更新 -> 16.1 实现 Dashboard KPI 面板
16.6 编写 Dashboard 前端组件测试 -> 16.2 实现 Dashboard 分时图, 16.3 实现库存可视化面板, 16.4 实现班次工作台面板, 16.5 实现 Dashboard SSE 实时更新
17. Checkpoint — 确保前端模块测试通过 -> 16.6 编写 Dashboard 前端组件测试
18.1 注册所有 M2 路由到 Express Gateway -> 17. Checkpoint — 确保前端模块测试通过
18.2 集成 Onboarding 全流程 -> 17. Checkpoint — 确保前端模块测试通过
18.3 集成 Data Sync 与 Dashboard 数据链路 -> 17. Checkpoint — 确保前端模块测试通过
18.4 编写端到端集成测试 -> 18.1 注册所有 M2 路由到 Express Gateway, 18.2 集成 Onboarding 全流程, 18.3 集成 Data Sync 与 Dashboard 数据链路
19. Final Checkpoint — 确保所有测试通过 -> 18.4 编写端到端集成测试

## Notes

- 标记 `*` 的子任务为可选任务，可跳过以加速 MVP 交付
- 每个任务引用了具体的需求条款以确保可追溯性
- Property Test 验证设计文档中定义的正确性属性
- Checkpoint 任务确保增量验证，避免问题累积
- 前端模块依赖后端 API 完成，建议按顺序实现
- M1 已有组件（Auth、LLM Gateway、Agent Platform、MCP Registry 等）直接复用，不重复实现
