import { type ReactNode, useState, useCallback } from 'react';
import { ConfidenceBadge } from './ConfidenceBadge';
import { SKUCorrectionPanel } from './SKUCorrectionPanel';
import styles from './SKUMappingTable.module.css';
import type { SKUMappingItem } from './types';

export interface SKUMappingTableProps {
  data: SKUMappingItem[];
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onConfirm?: (mappingId: string) => void;
  onReject?: (mappingId: string) => void;
  onCorrect?: (mappingId: string, systemSkuId: string) => void;
  onBatchConfirm?: (ids: string[]) => void;
  onBatchReject?: (ids: string[]) => void;
  loadingId?: string | null;
}

function DifferenceHighlight({ points }: { points?: string[] }): ReactNode {
  if (!points || points.length === 0) return <span>—</span>;

  return (
    <ul className={styles.differenceList}>
      {points.map((point, idx) => (
        <li key={idx} className={styles.differenceItem}>
          {point}
        </li>
      ))}
    </ul>
  );
}

export function SKUMappingTable({
  data,
  page,
  pageSize,
  total,
  onPageChange,
  onConfirm,
  onReject,
  onCorrect,
  onBatchConfirm,
  onBatchReject,
  loadingId,
}: SKUMappingTableProps): ReactNode {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [correctionMappingId, setCorrectionMappingId] = useState<string | null>(null);

  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
  const showPagination = totalPages > 1;

  const allSelected = data.length > 0 && data.every((item) => selectedIds.has(item.id));
  const someSelected = selectedIds.size > 0;

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.map((item) => item.id)));
    }
  }, [allSelected, data]);

  const handleSelectRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleBatchConfirm = useCallback(() => {
    if (onBatchConfirm && selectedIds.size > 0) {
      onBatchConfirm(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  }, [onBatchConfirm, selectedIds]);

  const handleBatchReject = useCallback(() => {
    if (onBatchReject && selectedIds.size > 0) {
      onBatchReject(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  }, [onBatchReject, selectedIds]);

  const handleCorrectionSelect = useCallback(
    (systemSkuId: string) => {
      if (correctionMappingId && onCorrect) {
        onCorrect(correctionMappingId, systemSkuId);
        setCorrectionMappingId(null);
      }
    },
    [correctionMappingId, onCorrect],
  );

  return (
    <div className={styles.tableContainer}>
      {someSelected && (
        <div className={styles.batchBar} role="toolbar" aria-label="批量操作">
          <span className={styles.batchInfo}>已选择 {selectedIds.size} 项</span>
          <button
            type="button"
            className={styles.batchConfirmBtn}
            onClick={handleBatchConfirm}
          >
            批量确认
          </button>
          <button
            type="button"
            className={styles.batchRejectBtn}
            onClick={handleBatchReject}
          >
            批量拒绝
          </button>
        </div>
      )}

      <div className={styles.tableWrapper}>
        <table className={styles.table} role="grid">
          <thead>
            <tr>
              <th className={styles.th}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={handleSelectAll}
                  aria-label="全选"
                />
              </th>
              <th className={styles.th}>渠道 SKU</th>
              <th className={styles.th}>系统 SKU</th>
              <th className={styles.th}>置信度</th>
              <th className={styles.th}>差异点</th>
              <th className={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td className={styles.empty} colSpan={6}>
                  暂无数据
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const isLoading = loadingId === row.id;
                return (
                  <tr
                    key={row.id}
                    className={`${styles.row} ${isLoading ? styles.loadingRow : ''}`}
                  >
                    <td className={styles.td}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => handleSelectRow(row.id)}
                        aria-label={`选择 ${row.channelSku.name}`}
                      />
                    </td>
                    <td className={styles.td}>
                      <div className={styles.skuCell}>
                        <span className={styles.skuName}>{row.channelSku.name}</span>
                        <span className={styles.skuCode}>{row.channelSku.externalId}</span>
                      </div>
                    </td>
                    <td className={styles.td}>
                      {row.systemSku ? (
                        <div className={styles.skuCell}>
                          <span className={styles.skuName}>{row.systemSku.name}</span>
                          <span className={styles.skuCode}>{row.systemSku.sku}</span>
                        </div>
                      ) : (
                        <span className={styles.noMatch}>—</span>
                      )}
                    </td>
                    <td className={styles.td}>
                      <ConfidenceBadge confidence={row.confidence} matchType={row.matchType} />
                    </td>
                    <td className={styles.td}>
                      <DifferenceHighlight points={row.differencePoints} />
                    </td>
                    <td className={styles.td}>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          disabled={isLoading || row.status !== 'pending'}
                          onClick={() => onConfirm?.(row.id)}
                        >
                          {isLoading ? '...' : '确认'}
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles.rejectBtn}`}
                          disabled={isLoading || row.status !== 'pending'}
                          onClick={() => onReject?.(row.id)}
                        >
                          拒绝
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles.correctBtn}`}
                          disabled={isLoading || row.status !== 'pending'}
                          onClick={() => setCorrectionMappingId(row.id)}
                        >
                          修正
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showPagination && (
        <nav className={styles.pagination} aria-label="Table pagination">
          <button
            type="button"
            className={styles.pageButton}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className={styles.pageInfo}>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className={styles.pageButton}
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            ›
          </button>
        </nav>
      )}

      {correctionMappingId && (
        <SKUCorrectionPanel
          onSelect={handleCorrectionSelect}
          onClose={() => setCorrectionMappingId(null)}
        />
      )}
    </div>
  );
}
