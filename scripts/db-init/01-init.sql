-- =============================================================================
-- OMS AI Native - Database Initialization Script
-- =============================================================================
-- This script runs automatically when the PostgreSQL container starts for the
-- first time. It creates the required extensions and initial schema.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- Tenants
-- =============================================================================
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  config JSONB DEFAULT '{}',
  api_key_encrypted TEXT,
  rate_limit INTEGER DEFAULT 60,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- =============================================================================
-- Users
-- =============================================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  roles TEXT[] DEFAULT '{}',
  permissions TEXT[] DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

CREATE INDEX idx_users_tenant_id ON users(tenant_id);

-- =============================================================================
-- Agents
-- =============================================================================
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  version VARCHAR(50) NOT NULL,
  description TEXT,
  system_prompt TEXT,
  tools TEXT[] DEFAULT '{}',
  config JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'registered',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_agents_tenant_id ON agents(tenant_id);
CREATE INDEX idx_agents_type ON agents(type);
CREATE INDEX idx_agents_status ON agents(status);

-- =============================================================================
-- Agent Sessions
-- =============================================================================
CREATE TABLE agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  user_id UUID NOT NULL REFERENCES users(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  status VARCHAR(50) DEFAULT 'active',
  context JSONB DEFAULT '{}',
  started_at TIMESTAMP DEFAULT NOW(),
  last_active_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP
);

CREATE INDEX idx_agent_sessions_agent_id ON agent_sessions(agent_id);
CREATE INDEX idx_agent_sessions_user_id ON agent_sessions(user_id);
CREATE INDEX idx_agent_sessions_tenant_id ON agent_sessions(tenant_id);
CREATE INDEX idx_agent_sessions_status ON agent_sessions(status);

-- =============================================================================
-- Tools (MCP Tool Registry)
-- =============================================================================
CREATE TABLE tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  version VARCHAR(50) NOT NULL,
  input_schema JSONB NOT NULL,
  output_schema JSONB NOT NULL,
  permissions TEXT[] DEFAULT '{}',
  timeout_ms INTEGER DEFAULT 30000,
  sandbox_type VARCHAR(50) DEFAULT 'v8-isolate',
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tools_name ON tools(name);
CREATE INDEX idx_tools_status ON tools(status);

-- =============================================================================
-- Tool Calls (Audit)
-- =============================================================================
CREATE TABLE tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name VARCHAR(255) NOT NULL,
  caller_id VARCHAR(255) NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  trace_id VARCHAR(255) NOT NULL,
  input JSONB,
  output JSONB,
  success BOOLEAN,
  error_message TEXT,
  execution_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tool_calls_tenant_id ON tool_calls(tenant_id);
CREATE INDEX idx_tool_calls_trace_id ON tool_calls(trace_id);
CREATE INDEX idx_tool_calls_tool_name ON tool_calls(tool_name);

-- =============================================================================
-- Orders (Business Data)
-- =============================================================================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  order_no VARCHAR(100) NOT NULL,
  external_order_no VARCHAR(255),
  shop_id VARCHAR(100),
  status VARCHAR(50) NOT NULL,
  customer_name VARCHAR(255),
  total_amount DECIMAL(12, 2),
  currency VARCHAR(10) DEFAULT 'CNY',
  items JSONB DEFAULT '[]',
  shipping_info JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, order_no)
);

CREATE INDEX idx_orders_tenant_id ON orders(tenant_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_shop_id ON orders(shop_id);
CREATE INDEX idx_orders_created_at ON orders(created_at);

-- =============================================================================
-- LLM Call Logs
-- =============================================================================
CREATE TABLE llm_call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  session_id UUID,
  model VARCHAR(100),
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  status VARCHAR(50),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_llm_call_logs_tenant_id ON llm_call_logs(tenant_id);
CREATE INDEX idx_llm_call_logs_session_id ON llm_call_logs(session_id);
CREATE INDEX idx_llm_call_logs_created_at ON llm_call_logs(created_at);

-- =============================================================================
-- Audit Logs
-- =============================================================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  trace_id VARCHAR(255),
  actor_id VARCHAR(255),
  actor_type VARCHAR(50),
  action VARCHAR(255) NOT NULL,
  resource_type VARCHAR(100),
  resource_id VARCHAR(255),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_trace_id ON audit_logs(trace_id);
CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
