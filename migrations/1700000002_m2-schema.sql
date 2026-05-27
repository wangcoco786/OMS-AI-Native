-- Up Migration

-- =============================================================================
-- Shops（店铺）
-- =============================================================================
CREATE TABLE shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  channel_type VARCHAR(50) NOT NULL,
  channel_config JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'pending',
  onboarding_session_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_shops_channel_type CHECK (channel_type IN ('shopify', 'wms', 'erp', 'custom')),
  CONSTRAINT chk_shops_status CHECK (status IN ('pending', 'configuring', 'active', 'inactive'))
);

CREATE INDEX idx_shops_tenant_id ON shops(tenant_id);
CREATE INDEX idx_shops_status ON shops(status);

-- =============================================================================
-- Onboarding Sessions
-- =============================================================================
CREATE TABLE onboarding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  shop_id UUID NOT NULL REFERENCES shops(id),
  current_step VARCHAR(50) NOT NULL DEFAULT 'channel_connection',
  completed_steps TEXT[] DEFAULT '{}',
  step_data JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'in_progress',
  interaction_count INTEGER DEFAULT 0,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  total_duration_ms INTEGER,
  CONSTRAINT chk_onboarding_sessions_status CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  CONSTRAINT chk_onboarding_sessions_step CHECK (current_step IN ('channel_connection', 'basic_config', 'sku_mapping', 'rule_setup', 'validation'))
);

CREATE INDEX idx_onboarding_sessions_tenant_id ON onboarding_sessions(tenant_id);
CREATE INDEX idx_onboarding_sessions_shop_id ON onboarding_sessions(shop_id);
CREATE INDEX idx_onboarding_sessions_status ON onboarding_sessions(status);

-- =============================================================================
-- System SKUs
-- =============================================================================
CREATE TABLE system_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  sku VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  attributes JSONB DEFAULT '{}',
  category VARCHAR(100),
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, sku)
);

CREATE INDEX idx_system_skus_tenant_id ON system_skus(tenant_id);
CREATE INDEX idx_system_skus_category ON system_skus(category);

-- =============================================================================
-- Channel SKUs
-- =============================================================================
CREATE TABLE channel_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  shop_id UUID NOT NULL REFERENCES shops(id),
  external_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  attributes JSONB DEFAULT '{}',
  price DECIMAL(12, 2),
  image_url TEXT,
  imported_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, shop_id, external_id)
);

CREATE INDEX idx_channel_skus_tenant_id ON channel_skus(tenant_id);
CREATE INDEX idx_channel_skus_shop_id ON channel_skus(shop_id);

-- =============================================================================
-- SKU Mappings
-- =============================================================================
CREATE TABLE sku_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  channel_sku_id UUID NOT NULL REFERENCES channel_skus(id),
  system_sku_id UUID REFERENCES system_skus(id),
  confidence SMALLINT NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  match_type VARCHAR(50) NOT NULL,
  reasoning TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, channel_sku_id),
  CONSTRAINT chk_sku_mappings_match_type CHECK (match_type IN ('high_confidence', 'needs_review', 'no_match')),
  CONSTRAINT chk_sku_mappings_status CHECK (status IN ('pending', 'confirmed', 'rejected', 'corrected'))
);

CREATE INDEX idx_sku_mappings_tenant_id ON sku_mappings(tenant_id);
CREATE INDEX idx_sku_mappings_status ON sku_mappings(status);
CREATE INDEX idx_sku_mappings_match_type ON sku_mappings(match_type);

-- =============================================================================
-- SKU Mapping Corrections（学习样本）
-- =============================================================================
CREATE TABLE sku_mapping_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  mapping_id UUID NOT NULL REFERENCES sku_mappings(id),
  original_system_sku_id UUID REFERENCES system_skus(id),
  corrected_system_sku_id UUID NOT NULL REFERENCES system_skus(id),
  channel_sku_attributes JSONB NOT NULL,
  corrected_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sku_mapping_corrections_tenant_id ON sku_mapping_corrections(tenant_id);

-- =============================================================================
-- Warehouses
-- =============================================================================
CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  code VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  max_capacity INTEGER,
  status VARCHAR(50) DEFAULT 'active',
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);

CREATE INDEX idx_warehouses_tenant_id ON warehouses(tenant_id);

-- =============================================================================
-- Inventory
-- =============================================================================
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  system_sku_id UUID NOT NULL REFERENCES system_skus(id),
  warehouse_id VARCHAR(100) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  safety_threshold INTEGER DEFAULT 10,
  max_capacity INTEGER,
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, system_sku_id, warehouse_id)
);

CREATE INDEX idx_inventory_tenant_id ON inventory(tenant_id);
CREATE INDEX idx_inventory_warehouse_id ON inventory(warehouse_id);
CREATE INDEX idx_inventory_system_sku_id ON inventory(system_sku_id);

-- =============================================================================
-- KPI Aggregations（预聚合 KPI 数据）
-- =============================================================================
CREATE TABLE kpi_aggregations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  metric_name VARCHAR(100) NOT NULL,
  granularity VARCHAR(20) NOT NULL,
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  value DECIMAL(12, 4) NOT NULL,
  dimensions JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, metric_name, granularity, period_start, dimensions),
  CONSTRAINT chk_kpi_aggregations_metric CHECK (metric_name IN ('order_count', 'fulfillment_rate', 'return_rate', 'avg_processing_time')),
  CONSTRAINT chk_kpi_aggregations_granularity CHECK (granularity IN ('hour', 'day', 'week'))
);

CREATE INDEX idx_kpi_aggregations_tenant_id ON kpi_aggregations(tenant_id);
CREATE INDEX idx_kpi_aggregations_metric ON kpi_aggregations(metric_name);
CREATE INDEX idx_kpi_aggregations_period ON kpi_aggregations(period_start, period_end);

-- =============================================================================
-- Sync Jobs
-- =============================================================================
CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  source VARCHAR(50) NOT NULL,
  data_type VARCHAR(50) NOT NULL,
  cron_expression VARCHAR(100) NOT NULL,
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  last_sync_at TIMESTAMP,
  last_sync_cursor VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_sync_jobs_source CHECK (source IN ('shopify', 'wms', 'erp')),
  CONSTRAINT chk_sync_jobs_data_type CHECK (data_type IN ('orders', 'inventory', 'products'))
);

CREATE INDEX idx_sync_jobs_tenant_id ON sync_jobs(tenant_id);
CREATE INDEX idx_sync_jobs_enabled ON sync_jobs(enabled);

-- =============================================================================
-- Sync Job Runs
-- =============================================================================
CREATE TABLE sync_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES sync_jobs(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  status VARCHAR(50) NOT NULL,
  records_processed INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  conflicts JSONB DEFAULT '[]',
  duration_ms INTEGER,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  CONSTRAINT chk_sync_job_runs_status CHECK (status IN ('running', 'success', 'partial', 'failed'))
);

CREATE INDEX idx_sync_job_runs_job_id ON sync_job_runs(job_id);
CREATE INDEX idx_sync_job_runs_tenant_id ON sync_job_runs(tenant_id);
CREATE INDEX idx_sync_job_runs_status ON sync_job_runs(status);
CREATE INDEX idx_sync_job_runs_started_at ON sync_job_runs(started_at);

-- =============================================================================
-- Validation Reports
-- =============================================================================
CREATE TABLE validation_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  shop_id UUID NOT NULL REFERENCES shops(id),
  session_id UUID REFERENCES onboarding_sessions(id),
  overall_status VARCHAR(20) NOT NULL,
  checks JSONB NOT NULL,
  simulation JSONB NOT NULL,
  can_go_live BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_validation_reports_status CHECK (overall_status IN ('pass', 'fail'))
);

CREATE INDEX idx_validation_reports_tenant_id ON validation_reports(tenant_id);
CREATE INDEX idx_validation_reports_shop_id ON validation_reports(shop_id);

-- Down Migration

DROP TABLE IF EXISTS validation_reports;
DROP TABLE IF EXISTS sync_job_runs;
DROP TABLE IF EXISTS sync_jobs;
DROP TABLE IF EXISTS kpi_aggregations;
DROP TABLE IF EXISTS inventory;
DROP TABLE IF EXISTS warehouses;
DROP TABLE IF EXISTS sku_mapping_corrections;
DROP TABLE IF EXISTS sku_mappings;
DROP TABLE IF EXISTS channel_skus;
DROP TABLE IF EXISTS system_skus;
DROP TABLE IF EXISTS onboarding_sessions;
DROP TABLE IF EXISTS shops;
