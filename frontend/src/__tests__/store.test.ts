import { describe, it, expect, beforeEach } from 'vitest';
// This import fails (red) until store/index.ts exists
import { useAppStore } from '../store';

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({ activeScreen: 'chat', backendStatus: 'unknown' });
  });

  it('defaults activeScreen to chat', () => {
    expect(useAppStore.getState().activeScreen).toBe('chat');
  });

  it('defaults backendStatus to unknown', () => {
    expect(useAppStore.getState().backendStatus).toBe('unknown');
  });

  it('setActiveScreen updates activeScreen', () => {
    useAppStore.getState().setActiveScreen('agents');
    expect(useAppStore.getState().activeScreen).toBe('agents');
  });

  it('setActiveScreen accepts all valid ScreenIds', () => {
    const screens = ['chat', 'plan', 'schedule', 'agents', 'tasks', 'skills', 'settings'] as const;
    for (const screen of screens) {
      useAppStore.getState().setActiveScreen(screen);
      expect(useAppStore.getState().activeScreen).toBe(screen);
    }
  });

  it('setBackendStatus updates backendStatus', () => {
    useAppStore.getState().setBackendStatus('ok');
    expect(useAppStore.getState().backendStatus).toBe('ok');
  });

  it('setBackendStatus accepts ok, error, unknown', () => {
    useAppStore.getState().setBackendStatus('ok');
    expect(useAppStore.getState().backendStatus).toBe('ok');
    useAppStore.getState().setBackendStatus('error');
    expect(useAppStore.getState().backendStatus).toBe('error');
    useAppStore.getState().setBackendStatus('unknown');
    expect(useAppStore.getState().backendStatus).toBe('unknown');
  });
});
