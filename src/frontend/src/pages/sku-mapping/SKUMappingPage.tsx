import { type ReactNode, useCallback, useState } from 'react';
import { LoadingSpinner, ErrorBoundary } from '@/components/common';
import {
  useGetMappings,
  useGetMappingStats,
  useConfirmMapping,
  useBatchConfirm,
} from '@/hooks/use-sku-mapping';
import { useSKUMappingStore } from '@/stores/sku-mapping-store';
import { MappingStats } from './MappingStats';
import { SKUMappingTable } from './SKUMappingTable';
import { BulkImport } from './BulkImport';
import styles from './SKUMappingPage.module.css';

function SKUMappingContent(): ReactNode {
  const { page, pageSize, matchType, status, search, setPage } = useSKUMappingStore();
  const [showImport, setShowImport] = useState(false);

  const mappingsQuery = useGetMappings({
    page,
    pageSize,
    matchType: matchType ?? undefined,
    status: status ?? undefined,
    search: search || undefined,
  });

  const statsQuery = useGetMappingStats();
  const confirmMutation = useConfirmMapping();
  const batchConfirmMutation = useBatchConfirm();

  const handleConfirm = useCallback(
    (mappingId: string) => {
      confirmMutation.mutate({ id: mappingId, payload: { action: 'confirm' } });
    },
    [confirmMutation],
  );

  const handleReject = useCallback(
    (mappingId: string) => {
      confirmMutation.mutate({ id: mappingId, payload: { action: 'reject' } });
    },
    [confirmMutation],
  );

  const handleCorrect = useCallback(
    (mappingId: string, systemSkuId: string) => {
      confirmMutation.mutate({
        id: mappingId,
        payload: { action: 'correct', systemSkuId },
      });
    },
    [confirmMutation],
  );

  const handleBatchConfirm = useCallback(
    (ids: string[]) => {
      batchConfirmMutation.mutate({ ids, action: 'confirm' });
    },
    [batchConfirmMutation],
  );

  const handleBatchReject = useCallback(
    (ids: string[]) => {
      batchConfirmMutation.mutate({ ids, action: 'reject' });
    },
    [batchConfirmMutation],
  );

  if (mappingsQuery.isLoading || statsQuery.isLoading) {
    return <LoadingSpinner size="lg" />;
  }

  if (mappingsQuery.error) {
    return (
      <div className={styles.errorMessage} role="alert">
        加载映射数据失败：{mappingsQuery.error.message}
      </div>
    );
  }

  if (statsQuery.error) {
    return (
      <div className={styles.errorMessage} role="alert">
        加载统计数据失败：{statsQuery.error.message}
      </div>
    );
  }

  const mappingsData = mappingsQuery.data;
  const statsData = statsQuery.data;

  return (
    <>
      {statsData && <MappingStats stats={statsData} />}

      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.importBtn}
          onClick={() => setShowImport(!showImport)}
        >
          {showImport ? '返回列表' : '批量导入'}
        </button>
      </div>

      {showImport ? (
        <BulkImport />
      ) : (
        mappingsData && (
          <SKUMappingTable
            data={mappingsData.items}
            page={mappingsData.page}
            pageSize={mappingsData.pageSize}
            total={mappingsData.total}
            onPageChange={setPage}
            onConfirm={handleConfirm}
            onReject={handleReject}
            onCorrect={handleCorrect}
            onBatchConfirm={handleBatchConfirm}
            onBatchReject={handleBatchReject}
            loadingId={confirmMutation.isPending ? confirmMutation.variables?.id : null}
          />
        )
      )}
    </>
  );
}

export function SKUMappingPage(): ReactNode {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>SKU 映射</h1>
        <p className={styles.subtitle}>渠道 SKU 与系统 SKU 匹配管理</p>
      </header>
      <ErrorBoundary>
        <SKUMappingContent />
      </ErrorBoundary>
    </div>
  );
}
