import { create } from 'zustand';

interface AppState {
  sidebarOpen: boolean;
  currentTenant: string | null;
  toggleSidebar: () => void;
  setCurrentTenant: (tenantId: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  currentTenant: null,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setCurrentTenant: (tenantId) => set({ currentTenant: tenantId }),
}));
