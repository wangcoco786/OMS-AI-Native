import { type ReactNode, useState, useCallback } from 'react';
import { useSearchSystemSkus } from '@/hooks/use-sku-mapping';
import styles from './SKUCorrectionPanel.module.css';

export interface SKUCorrectionPanelProps {
  onSelect: (systemSkuId: string) => void;
  onClose: () => void;
}

export function SKUCorrectionPanel({ onSelect, onClose }: SKUCorrectionPanelProps): ReactNode {
  const [searchTerm, setSearchTerm] = useState('');
  const { data, isLoading } = useSearchSystemSkus(searchTerm);

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
    },
    [onSelect],
  );

  return (
    <div className={styles.overlay} role="dialog" aria-label="修正 SKU 映射">
      <div className={styles.panel}>
        <div className={styles.header}>
          <h3 className={styles.title}>选择正确的系统 SKU</h3>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className={styles.searchBox}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="搜索系统 SKU（名称或编码）..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles.results}>
          {isLoading && <div className={styles.loading}>搜索中...</div>}

          {!isLoading && searchTerm.length === 0 && (
            <div className={styles.hint}>请输入关键词搜索系统 SKU</div>
          )}

          {!isLoading && searchTerm.length > 0 && data?.items.length === 0 && (
            <div className={styles.empty}>未找到匹配的系统 SKU</div>
          )}

          {!isLoading &&
            data?.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.resultItem}
                onClick={() => handleSelect(item.id)}
              >
                <div className={styles.resultName}>{item.name}</div>
                <div className={styles.resultSku}>{item.sku}</div>
                {item.category && (
                  <span className={styles.resultCategory}>{item.category}</span>
                )}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
