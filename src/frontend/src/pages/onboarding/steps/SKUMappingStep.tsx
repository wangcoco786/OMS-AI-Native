import { useState, useCallback, type ReactNode } from 'react';
import { StatusBadge } from '@/components/common';
import { useOnboardingStore } from '@/stores/onboarding-store';
import styles from './Steps.module.css';

type MatchType = 'high_confidence' | 'needs_review' | 'no_match';
type MappingAction = 'confirmed' | 'rejected' | 'pending';

interface SKUMappingRow {
  id: string;
  channelSkuName: string;
  channelSkuId: string;
  systemSkuName: string | null;
  systemSkuId: string | null;
  confidence: number;
  matchType: MatchType;
  action: MappingAction;
}

interface MappingStats {
  total: number;
  matched: number;
  needsReview: number;
  unmatched: number;
}

function getConfidenceVariant(matchType: MatchType): 'success' | 'warning' | 'error' {
  switch (matchType) {
    case 'high_confidence':
      return 'success';
    case 'needs_review':
      return 'warning';
    case 'no_match':
      return 'error';
  }
}

function getMatchTypeLabel(matchType: MatchType): string {
  switch (matchType) {
    case 'high_confidence':
      return '高置信度';
    case 'needs_review':
      return '需确认';
    case 'no_match':
      return '无匹配';
  }
}

// Sample data for demonstration - in production this comes from the API
const SAMPLE_MAPPINGS: SKUMappingRow[] = [
  {
    id: '1',
    channelSkuName: 'Blue T-Shirt XL',
    channelSkuId: 'CH-001',
    systemSkuName: '蓝色T恤-XL',
    systemSkuId: 'SYS-001',
    confidence: 92,
    matchType: 'high_confidence',
    action: 'pending',
  },
  {
    id: '2',
    channelSkuName: 'Red Hoodie M',
    channelSkuId: 'CH-002',
    systemSkuName: '红色卫衣-M码',
    systemSkuId: 'SYS-015',
    confidence: 72,
    matchType: 'needs_review',
    action: 'pending',
  },
  {
    id: '3',
    channelSkuName: 'Premium Leather Wallet',
    channelSkuId: 'CH-003',
    systemSkuName: null,
    systemSkuId: null,
    confidence: 0,
    matchType: 'no_match',
    action: 'pending',
  },
];

export function SKUMappingStep(): ReactNode {
  const { stepData, setStepData } = useOnboardingStore();
  const savedMappings = stepData.sku_mapping.data?.mappings as SKUMappingRow[] | undefined;

  const [mappings, setMappings] = useState<SKUMappingRow[]>(savedMappings || SAMPLE_MAPPINGS);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchingRowId, setSearchingRowId] = useState<string | null>(null);

  const stats: MappingStats = {
    total: mappings.length,
    matched: mappings.filter((m) => m.matchType === 'high_confidence').length,
    needsReview: mappings.filter((m) => m.matchType === 'needs_review').length,
    unmatched: mappings.filter((m) => m.matchType === 'no_match').length,
  };

  const handleConfirm = useCallback(
    (id: string) => {
      setMappings((prev) => {
        const next = prev.map((m) => (m.id === id ? { ...m, action: 'confirmed' as MappingAction } : m));
        setStepData('sku_mapping', { mappings: next } as unknown as Record<string, unknown>);
        return next;
      });
    },
    [setStepData],
  );

  const handleReject = useCallback(
    (id: string) => {
      setMappings((prev) => {
        const next = prev.map((m) => (m.id === id ? { ...m, action: 'rejected' as MappingAction } : m));
        setStepData('sku_mapping', { mappings: next } as unknown as Record<string, unknown>);
        return next;
      });
    },
    [setStepData],
  );

  const handleManualSearch = useCallback((rowId: string) => {
    setSearchingRowId(rowId);
    setSearchQuery('');
  }, []);

  const handleSearchSubmit = useCallback(
    (rowId: string, systemSkuName: string) => {
      setMappings((prev) => {
        const next = prev.map((m) =>
          m.id === rowId
            ? {
                ...m,
                systemSkuName,
                systemSkuId: `SYS-MANUAL-${Date.now()}`,
                matchType: 'needs_review' as MatchType,
                confidence: 100,
                action: 'confirmed' as MappingAction,
              }
            : m,
        );
        setStepData('sku_mapping', { mappings: next } as unknown as Record<string, unknown>);
        return next;
      });
      setSearchingRowId(null);
      setSearchQuery('');
    },
    [setStepData],
  );

  return (
    <div className={styles.stepContainer}>
      <h2 className={styles.stepTitle}>SKU 映射</h2>
      <p className={styles.stepDescription}>
        查看 AI 自动匹配结果，确认或修正 SKU 映射关系。
      </p>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{stats.total}</span>
          <span className={styles.statLabel}>总计</span>
        </div>
        <div className={styles.statCard}>
          <span className={`${styles.statValue} ${styles.statSuccess}`}>{stats.matched}</span>
          <span className={styles.statLabel}>已匹配</span>
        </div>
        <div className={styles.statCard}>
          <span className={`${styles.statValue} ${styles.statWarning}`}>{stats.needsReview}</span>
          <span className={styles.statLabel}>需确认</span>
        </div>
        <div className={styles.statCard}>
          <span className={`${styles.statValue} ${styles.statError}`}>{stats.unmatched}</span>
          <span className={styles.statLabel}>无匹配</span>
        </div>
      </div>

      <div className={styles.tableContainer}>
        <table className={styles.mappingTable} role="grid">
          <thead>
            <tr>
              <th>渠道 SKU</th>
              <th>系统 SKU</th>
              <th>置信度</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((row) => (
              <tr key={row.id} className={styles.mappingRow}>
                <td>
                  <div className={styles.skuCell}>
                    <span className={styles.skuName}>{row.channelSkuName}</span>
                    <span className={styles.skuId}>{row.channelSkuId}</span>
                  </div>
                </td>
                <td>
                  {row.systemSkuName ? (
                    <div className={styles.skuCell}>
                      <span className={styles.skuName}>{row.systemSkuName}</span>
                      <span className={styles.skuId}>{row.systemSkuId}</span>
                    </div>
                  ) : (
                    <span className={styles.noMatch}>—</span>
                  )}
                </td>
                <td>
                  <StatusBadge
                    status={`${getMatchTypeLabel(row.matchType)} (${row.confidence}%)`}
                    variant={getConfidenceVariant(row.matchType)}
                  />
                </td>
                <td>
                  {row.action === 'confirmed' ? (
                    <span className={styles.actionDone}>✓ 已确认</span>
                  ) : row.action === 'rejected' ? (
                    <span className={styles.actionRejected}>✗ 已拒绝</span>
                  ) : (
                    <div className={styles.actionButtons}>
                      <button
                        type="button"
                        className={styles.confirmBtn}
                        onClick={() => handleConfirm(row.id)}
                        disabled={row.matchType === 'no_match'}
                      >
                        确认
                      </button>
                      <button
                        type="button"
                        className={styles.rejectBtn}
                        onClick={() => handleReject(row.id)}
                      >
                        拒绝
                      </button>
                      <button
                        type="button"
                        className={styles.searchBtn}
                        onClick={() => handleManualSearch(row.id)}
                      >
                        搜索
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {searchingRowId && (
        <div className={styles.searchPanel} role="dialog" aria-label="手动搜索 SKU">
          <h3 className={styles.searchTitle}>手动搜索系统 SKU</h3>
          <div className={styles.searchInputRow}>
            <input
              type="text"
              className={styles.input}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="输入系统 SKU 名称搜索..."
              aria-label="搜索系统 SKU"
            />
            <button
              type="button"
              className={styles.confirmBtn}
              onClick={() => handleSearchSubmit(searchingRowId, searchQuery)}
              disabled={!searchQuery.trim()}
            >
              确认选择
            </button>
            <button
              type="button"
              className={styles.rejectBtn}
              onClick={() => setSearchingRowId(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
