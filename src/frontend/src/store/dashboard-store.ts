import { create } from 'zustand';

type TimeGranularity = 'hour' | 'day' | 'week';

interface DimensionFilter {
  shopId?: string;
  channelId?: string;
  warehouseId?: string;
}

interface DashboardState {
  granularity: TimeGranularity;
  filter: DimensionFilter;
  setGranularity: (granularity: TimeGranularity) => void;
  setFilter: (filter: DimensionFilter) => void;
  resetFilter: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  granularity: 'day',
  filter: {},
  setGranularity: (granularity) => set({ granularity }),
  setFilter: (filter) => set({ filter }),
  resetFilter: () => set({ filter: {} }),
}));
