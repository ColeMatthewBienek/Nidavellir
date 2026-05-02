import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanScreen } from '../../screens/PlanScreen';

const task = {
  id: 'task-1',
  title: 'Build orchestration',
  description: 'Create board and DAG foundations.',
  status: 'backlog',
  priority: 1,
  labels: ['orchestration'],
  conversation_id: null,
  base_repo_path: '/repo',
  base_branch: 'main',
  task_branch: null,
  worktree_path: null,
  updated_at: '2026-05-02T00:00:00Z',
};

const detail = {
  ...task,
  nodes: [{
    id: 'node-1',
    task_id: 'task-1',
    title: 'Data Model',
    description: '',
    status: 'ready',
    provider: 'codex',
    model: 'gpt-5.5',
    skill_ids: [],
    position_x: 40,
    position_y: 40,
  }],
  edges: [],
  steps: [{
    id: 'step-1',
    node_id: 'node-1',
    order_index: 0,
    type: 'manual',
    title: 'Create schema',
    description: '',
    status: 'pending',
    output_summary: '',
  }],
  readiness: {
    runnable: [{ node_id: 'node-1', step_id: 'step-1', step_type: 'manual' }],
    blocked: [],
  },
};

describe('PlanScreen orchestration board', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (String(url).endsWith('/api/orchestration/tasks') && !options) {
        return Promise.resolve({ ok: true, json: async () => [task] });
      }
      if (String(url).endsWith('/api/orchestration/tasks') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...detail, id: 'task-new', title: 'New task', nodes: [], steps: [], edges: [] }),
        });
      }
      if (String(url).includes('/api/orchestration/tasks/task-1/events')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 'event-1', type: 'task_created', payload: {}, created_at: '2026-05-02T00:00:00Z' }],
        });
      }
      if (String(url).includes('/api/orchestration/tasks/task-1') && options?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ ...detail, status: 'ready' }) });
      }
      if (String(url).includes('/api/orchestration/tasks/task-1')) {
        return Promise.resolve({ ok: true, json: async () => detail });
      }
      if (String(url).includes('/api/orchestration/steps/step-1/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ ...detail.steps[0], status: 'complete' }) });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));
  });

  it('loads orchestration tasks into a board and opens task detail', async () => {
    render(<PlanScreen />);

    expect((await screen.findAllByText('Build orchestration')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Data Model').length).toBeGreaterThan(0);
    expect(screen.getByText('Create schema')).toBeTruthy();
    expect(screen.getByText('Runnable now')).toBeTruthy();
  });

  it('creates a task from the Plan page', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    render(<PlanScreen />);

    fireEvent.click(screen.getByRole('button', { name: '+ New Task' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), { target: { value: 'New task' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Task description' }), { target: { value: 'Plan it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).endsWith('/api/orchestration/tasks') && options?.method === 'POST'
      );
      expect(calls.length).toBe(1);
    });
  });

  it('moves tasks and completes manual steps through the orchestration API', async () => {
    render(<PlanScreen />);

    expect((await screen.findAllByText('Build orchestration')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('combobox', { name: 'Move Build orchestration' }), { target: { value: 'ready' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));

    await waitFor(() => {
      const moveCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/tasks/task-1') && options?.method === 'PATCH'
      );
      const completeCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/steps/step-1/status') && options?.method === 'PATCH'
      );
      expect(moveCalls.length).toBe(1);
      expect(completeCalls.length).toBe(1);
    });
  });
});
