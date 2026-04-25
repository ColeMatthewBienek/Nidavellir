import { create } from 'zustand';
import type { ScreenId, BackendStatus } from '../types';

interface AppState {
  activeScreen: ScreenId;
  backendStatus: BackendStatus;
  setActiveScreen: (screen: ScreenId) => void;
  setBackendStatus: (status: BackendStatus) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeScreen: 'chat',
  backendStatus: 'unknown',
  setActiveScreen: (screen) => set({ activeScreen: screen }),
  setBackendStatus: (status) => set({ backendStatus: status }),
}));
