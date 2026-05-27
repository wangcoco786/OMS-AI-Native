import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  DashboardFilters,
  KPIMetrics,
  KPIMetricName,
  KPITrendData,
  MultiMetricTrendPoint,
  EventAnnotation,
} from '@/pages/dashboard/types';

const QUERY_KEYS = {
  kpi: (filters: DashboardFilters) => ['dashboard', 'kpi', filters] as const,
  kpiTrend: (metric: KPIMetricName, filters: DashboardFilters) =>
    ['dashboard', 'kpi', 'trend', metric, filters] as const,
  multiMetricTrend: (metrics: KPIMetricName[], filters: DashboardFilters & { startTime?: string; endTime?: string }) =>
    ['dashboard', 'kpi', 'multi-trend', metrics, filters] as const,
  eventAnnotations: (filters: { startTime?: string; endTime?: string }) =>
    ['dashboard', 'events', filters] as const,
};

function filtersToParams(filters: DashboardFilters): Record<string, string> {
  const params: Record<string, string> = {
    granularity: filters.granularity,
  };
  if (filters.shopId) params.shopId = filters.shopId;
  if (filters.channelId) params.channelId = filters.channelId;
  if (filters.warehouseId) params.warehouseId = filters.warehouseId;
  return params;
}

export function useGetKPI(filters: DashboardFilters) {
  return useQuery({
    queryKey: QUERY_KEYS.kpi(filters),
    queryFn: () =>
      apiClient.get<KPIMetrics>('/dashboard/kpi', filtersToParams(filters)),
  });
}

export function useGetKPITrend(metric: KPIMetricName, filters: DashboardFilters) {
  return useQuery({
    queryKey: QUERY_KEYS.kpiTrend(metric, filters),
    queryFn: () =>
      apiClient.get<KPITrendData>(
        '/dashboard/kpi/trend',
        { ...filtersToParams(filters), metric },
      ),
  });
}

export function useGetMultiMetricTrend(
  metrics: KPIMetricName[],
  filters: DashboardFilters & { startTime?: string; endTime?: string },
) {
  return useQuery({
    queryKey: QUERY_KEYS.multiMetricTrend(metrics, filters),
    queryFn: () => {
      const params: Record<string, string> = {
        ...filtersToParams(filters),
        metrics: metrics.join(','),
      };
      if (filters.startTime) params.startTime = filters.startTime;
      if (filters.endTime) params.endTime = filters.endTime;
      return apiClient.get<MultiMetricTrendPoint[]>(
        '/dashboard/kpi/multi-trend',
        params,
      );
    },
    enabled: metrics.length > 0,
  });
}

export function useGetEventAnnotations(filters: {
  startTime?: string;
  endTime?: string;
}) {
  return useQuery({
    queryKey: QUERY_KEYS.eventAnnotations(filters),
    queryFn: () => {
      const params: Record<string, string> = {};
      if (filters.startTime) params.startTime = filters.startTime;
      if (filters.endTime) params.endTime = filters.endTime;
      return apiClient.get<EventAnnotation[]>('/dashboard/events', params);
    },
  });
}
