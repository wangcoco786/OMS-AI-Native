export type MatchType = 'high_confidence' | 'needs_review' | 'no_match';

export type MappingStatus = 'pending' | 'confirmed' | 'rejected' | 'corrected';

export interface SKUMappingItem {
  id: string;
  channelSku: {
    id: string;
    name: string;
    externalId: string;
    attributes: Record<string, string>;
  };
  systemSku: {
    id: string;
    name: string;
    sku: string;
  } | null;
  confidence: number;
  matchType: MatchType;
  reasoning: string;
  differencePoints?: string[];
  status: MappingStatus;
  suggestNewSku?: boolean;
}

export interface MappingStatsData {
  total: number;
  highConfidence: number;
  needsReview: number;
  noMatch: number;
  accuracy?: number;
}

export interface MappingsResponse {
  items: SKUMappingItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MappingsParams {
  page?: number;
  pageSize?: number;
  matchType?: MatchType;
  status?: MappingStatus;
  search?: string;
}

export interface ConfirmMappingPayload {
  action: 'confirm' | 'reject' | 'correct';
  systemSkuId?: string;
}

export interface BatchConfirmPayload {
  ids: string[];
  action: 'confirm' | 'reject';
}

export interface BatchConfirmResponse {
  processed: number;
  failed: number;
  errors?: Array<{ id: string; error: string }>;
}

export interface SystemSKUSearchResult {
  id: string;
  sku: string;
  name: string;
  description?: string;
  attributes: Record<string, string>;
  category?: string;
}

export interface SystemSKUSearchResponse {
  items: SystemSKUSearchResult[];
  total: number;
}

export interface ImportResult {
  totalRecords: number;
  successCount: number;
  errorCount: number;
  errors?: Array<{ row: number; message: string }>;
}
