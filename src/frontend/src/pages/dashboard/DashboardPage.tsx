import { useDashboardStore } from '@/stores/dashboard-store';
import { useGetKPI, useGetKPITrend, useGetMultiMetricTrend, useGetEventAnnotations } from '@/hooks/use-dashboard';
import { LoadingSpinner } from '@/components/common';
import { KPICards } from './KPICards';
import { KPITrendChart } from './KPITrendChart';
import { DashboardFilters } from './DashboardFilters';
import { TimeRangeSelector } from './TimeRangeSelector';
import { MultiMetricChart } from './MultiMetricChart';
import { EventAnnotations } from './EventAnnotations';
import type { DashboardFilters as DashboardFiltersType } from './types';
import styles from './DashboardPage.module.css';

export function DashboardPage() {
  const { granularity, shopId, channelId, warehouseId, startTime, endTime, visibleMetrics } = useDashboardStore();

  const filters: DashboardFiltersType = {
    granularity,
    shopId: shopId ?? undefined,
    channelId: channelId ?? undefined,
    warehouseId: warehouseId ?? undefined,
  };

  const {
    data: kpiMetrics,
    isLoading: kpiLoading,
    error: kpiError,
  } = useGetKPI(filters);

  const {
    data: trendData,
    isLoading: trendLoading,
  } = useGetKPITrend('orderCount', filters);

  const {
    data: multiMetricData,
    isLoading: multiMetricLoading,
  } = useGetMultiMetricTrend(visibleMetrics, {
    ...filters,
    startTime: startTime ?? undefined,
    endTime: endTime ?? undefined,
  });

  const {
    data: eventAnnotations,
  } = useGetEventAnnotations({
    startTime: startTime ?? undefined,
    endTime: endTime ?? undefined,
  });

  const isLoading = kpiLoading || trendLoading || multiMetricLoading;

  if (isLoading) {
    return (
      <div className={styles.container}>
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (kpiError) {
    return (
      <div className={styles.container}>
        <div className={styles.errorMessage} data-testid="dashboard-error">
          加载数据失败：{kpiError instanceof Error ? kpiError.message : '未知错误'}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="dashboard-page">
      <h1 className={styles.header}>数据看板</h1>

      <DashboardFilters />

      <TimeRangeSelector />

      {kpiMetrics && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>核心指标</h2>
          <KPICards metrics={kpiMetrics} trendData={trendData} />
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>趋势图</h2>
        <KPITrendChart data={trendData} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>多指标对比</h2>
        {eventAnnotations && eventAnnotations.length > 0 && (
          <EventAnnotations events={eventAnnotations} />
        )}
        <MultiMetricChart
          data={multiMetricData ?? []}
          events={eventAnnotations ?? []}
          granularity={granularity}
        />
      </section>
    </div>
  );
}
