import { create } from 'zustand';
import type { MatchType, MappingStatus } from '@/pages/sku-mapping/types';

export interface SKUMappingFilterState {
  page: number;
  pageSize: number;
  matchType: MatchType | null;
  status: MappingStatus | null;
  search: string;
}

export interface SKUMappingFilterActions {
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setMatchType: (matchType: MatchType | null) => void;
  setStatus: (status: MappingStatus | null) => void;
  setSearch: (search: string) => void;
  resetFilters: () => void;
}

const initialState: SKUMappingFilterState = {
  page: 1,
  pageSize: 10,
  matchType: null,
  status: null,
  search: '',
};

export const useSKUMappingStore = create<SKUMappingFilterState & SKUMappingFilterActions>(
  (set) => ({
    ...initialState,

    setPage: (page) => set({ page }),
    setPageSize: (pageSize) => set({ pageSize, page: 1 }),
    setMatchType: (matchType) => set({ matchType, page: 1 }),
    setStatus: (status) => set({ status, page: 1 }),
    setSearch: (search) => set({ search, page: 1 }),
    resetFilters: () => set(initialState),
  }),
);
