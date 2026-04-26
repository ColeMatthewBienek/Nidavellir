export type ScreenId =
  | 'chat' | 'plan' | 'schedule' | 'agents'
  | 'tasks' | 'skills' | 'memory' | 'settings';

export type BackendStatus = 'unknown' | 'ok' | 'error';

export type BadgeStatus =
  | 'idle' | 'busy' | 'active' | 'error' | 'pending'
  | 'running' | 'complete' | 'failed' | 'scheduled' | 'changes_requested';
