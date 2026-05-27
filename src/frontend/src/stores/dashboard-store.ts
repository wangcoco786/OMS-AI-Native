import { create } from 'zustand';
import type { TimeGranularity, KPIMetricName } from '@/pages/dashboard/types';

export interface DashboardFilterState {
  granularity: TimeGranularity;
  shopId: string | null;
  channelId: string | null;
  warehouseId: string | null;
  startTime: string | null;
  endTime: string | null;
  visibleMetrics: KPIMetricName[];
}

export interface DashboardFilterActions {
  setGranularity: (granularity: TimeGranularity) => void;
  setShopId: (shopId: string | null) => void;
  setChannelId: (channelId: string | null) => void;
  setWarehouseId: (warehouseId: string | null) => void;
  setTimeRange: (startTime: string | null, endTime: string | null) => void;
  setVisibleMetrics: (metrics: KPIMetricName[]) => void;
  toggleMetric: (metric: KPIMetricName) => void;
  resetFilters: () => void;
}

const initialState: DashboardFilterState = {
  granularity: 'day',
  shopId: null,
  channelId: null,
  warehouseId: null,
  startTime: null,
  endTime: null,
  visibleMetrics: ['orderCount', 'fulfillmentRate', 'returnRate', 'avgProcessingTime'],
};

export const useDashboardStore = create<DashboardFilterState & DashboardFilterActions>(
  (set) => ({
    ...initialState,

    setGranularity: (granularity) => set({ granularity }),
    setShopId: (shopId) => set({ shopId }),
    setChannelId: (channelId) => set({ channelId }),
    setWarehouseId: (warehouseId) => set({ warehouseId }),
    setTimeRange: (startTime, endTime) => set({ startTime, endTime }),
    setVisibleMetrics: (visibleMetrics) => set({ visibleMetrics }),
    toggleMetric: (metric) =>
      set((state) => {
        const metrics = state.visibleMetrics.includes(metric)
          ? state.visibleMetrics.filter((m) => m !== metric)
          : [...state.visibleMetrics, metric];
        return { visibleMetrics: metrics };
      }),
    resetFilters: () => set(initialState),
  }),
);
