import { useDashboardStore } from '@/stores/dashboard-store';
import type { TimeGranularity } from './types';
import styles from './DashboardFilters.module.css';

const GRANULARITY_OPTIONS: { value: TimeGranularity; label: string }[] = [
  { value: 'hour', label: '小时' },
  { value: 'day', label: '天' },
  { value: 'week', label: '周' },
];

export function DashboardFilters() {
  const {
    granularity,
    shopId,
    channelId,
    warehouseId,
    setGranularity,
    setShopId,
    setChannelId,
    setWarehouseId,
  } = useDashboardStore();

  return (
    <div className={styles.filtersContainer} data-testid="dashboard-filters">
      <div className={styles.granularityGroup} role="group" aria-label="时间粒度">
        {GRANULARITY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`${styles.granularityBtn} ${
              granularity === option.value ? styles.granularityBtnActive : ''
            }`}
            onClick={() => setGranularity(option.value)}
            aria-pressed={granularity === option.value}
            data-testid={`granularity-${option.value}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className={styles.selectGroup}>
        <label className={styles.selectLabel} htmlFor="shop-filter">
          店铺
        </label>
        <select
          id="shop-filter"
          className={styles.select}
          value={shopId ?? ''}
          onChange={(e) => setShopId(e.target.value || null)}
          data-testid="filter-shop"
        >
          <option value="">全部店铺</option>
          <option value="shop-1">店铺 A</option>
          <option value="shop-2">店铺 B</option>
        </select>
      </div>

      <div className={styles.selectGroup}>
        <label className={styles.selectLabel} htmlFor="channel-filter">
          渠道
        </label>
        <select
          id="channel-filter"
          className={styles.select}
          value={channelId ?? ''}
          onChange={(e) => setChannelId(e.target.value || null)}
          data-testid="filter-channel"
        >
          <option value="">全部渠道</option>
          <option value="shopify">Shopify</option>
          <option value="wms">WMS</option>
          <option value="erp">ERP</option>
        </select>
      </div>

      <div className={styles.selectGroup}>
        <label className={styles.selectLabel} htmlFor="warehouse-filter">
          仓库
        </label>
        <select
          id="warehouse-filter"
          className={styles.select}
          value={warehouseId ?? ''}
          onChange={(e) => setWarehouseId(e.target.value || null)}
          data-testid="filter-warehouse"
        >
          <option value="">全部仓库</option>
          <option value="wh-1">仓库 1</option>
          <option value="wh-2">仓库 2</option>
        </select>
      </div>
    </div>
  );
}
