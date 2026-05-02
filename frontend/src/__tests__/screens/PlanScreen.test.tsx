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
  nodes: [
    {
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
    },
    {
      id: 'node-2',
      task_id: 'task-1',
      title: 'Board UI',
      description: '',
      status: 'not_started',
      provider: null,
      model: null,
      skill_ids: [],
      position_x: 240,
      position_y: 40,
    },
  ],
  edges: [{
    id: 'edge-1',
    task_id: 'task-1',
    from_node_id: 'node-1',
    to_node_id: 'node-2',
  }],
  worktrees: [],
  steps: [{
    id: 'step-1',
    node_id: 'node-1',
    order_index: 0,
    type: 'manual',
    title: 'Create schema',
    description: '',
    status: 'pending',
    config: {},
    output_summary: '',
  }],
  readiness: {
    runnable: [{ node_id: 'node-1', step_id: 'step-1', step_type: 'manual' }],
    blocked: [],
  },
};

const detailWithWorktree = {
  ...detail,
  steps: [{
    ...detail.steps[0],
    type: 'command',
    title: 'Write marker',
    config: { command: 'printf marker > marker.txt' },
  }],
  worktrees: [{
    id: 'worktree-1',
    task_id: 'task-1',
    node_id: 'node-1',
    repo_path: '/repo',
    worktree_path: '/repo-worktrees/node-1',
    base_branch: 'main',
    branch_name: 'orchestration/build-orchestration/data-model',
    base_commit: 'abc',
    head_commit: 'abc',
    status: 'clean',
    dirty_count: 0,
    dirty_summary: [],
  }],
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
      if (String(url).includes('/api/orchestration/tasks/task-1/nodes') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'node-new',
            task_id: 'task-1',
            title: 'Review',
            description: '',
            status: 'not_started',
            provider: null,
            model: null,
            skill_ids: [],
            position_x: 0,
            position_y: 0,
          }),
        });
      }
      if (String(url).includes('/api/orchestration/tasks/task-1/edges') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'edge-1',
            task_id: 'task-1',
            from_node_id: 'node-1',
            to_node_id: 'node-2',
          }),
        });
      }
      if (String(url).includes('/api/orchestration/tasks/task-1/worktrees') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'worktree-1',
            task_id: 'task-1',
            node_id: 'node-1',
            repo_path: '/repo',
            worktree_path: '/repo-worktrees/node-1',
            base_branch: 'main',
            branch_name: 'orchestration/build-orchestration/data-model',
            base_commit: 'abc',
            head_commit: 'abc',
            status: 'clean',
            dirty_count: 0,
            dirty_summary: [],
          }),
        });
      }
      if (String(url).includes('/api/orchestration/worktrees/worktree-1/refresh') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'worktree-1',
            task_id: 'task-1',
            node_id: 'node-1',
            repo_path: '/repo',
            worktree_path: '/repo-worktrees/node-1',
            base_branch: 'main',
            branch_name: 'orchestration/build-orchestration/data-model',
            status: 'dirty',
            dirty_count: 1,
            dirty_summary: [{ path: 'README.md', status: 'M' }],
          }),
        });
      }
      if (String(url).includes('/api/orchestration/worktrees/worktree-1') && options?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'worktree-1', status: 'removed' }) });
      }
      if (String(url).includes('/api/orchestration/tasks/task-1')) {
        return Promise.resolve({ ok: true, json: async () => detail });
      }
      if (String(url).includes('/api/orchestration/nodes/node-1') && options?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ ...detail.nodes[0], title: 'Data Layer' }) });
      }
      if (String(url).includes('/api/orchestration/steps/step-1/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ ...detail.steps[0], status: 'complete' }) });
      }
      if (String(url).includes('/api/orchestration/nodes/node-1/steps') && options?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ ...detail.steps[0], id: 'step-new', title: 'Review output', config: {} }) });
      }
      if (String(url).includes('/api/orchestration/edges/edge-1') && options?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
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

  it('creates and edits DAG nodes from the Plan page', async () => {
    render(<PlanScreen />);

    expect((await screen.findAllByText('Build orchestration')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '+ Node' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Node title' }), { target: { value: 'Review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Node' }));

    await waitFor(() => {
      const createCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/tasks/task-1/nodes') && options?.method === 'POST'
      );
      expect(createCalls.length).toBe(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Node' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Node title' }), { target: { value: 'Data Layer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Node' }));

    await waitFor(() => {
      const updateCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/nodes/node-1') && options?.method === 'PATCH'
      );
      expect(updateCalls.length).toBe(1);
    });
  });

  it('creates and removes DAG dependencies from the Plan page', async () => {
    render(<PlanScreen />);

    expect((await screen.findAllByText('Build orchestration')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('combobox', { name: 'Dependency source' }), { target: { value: 'node-1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Dependency target' }), { target: { value: 'node-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      const edgeCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/tasks/task-1/edges') && options?.method === 'POST'
      );
      expect(edgeCalls.length).toBe(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove dependency Data Model to Board UI' }));

    await waitFor(() => {
      const deleteCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/edges/edge-1') && options?.method === 'DELETE'
      );
      expect(deleteCalls.length).toBe(1);
    });
  });

  it('creates linear node steps through the step modal', async () => {
    render(<PlanScreen />);

    expect((await screen.findAllByText('Build orchestration')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '+ Step' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Step title' }), { target: { value: 'Review output' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Step type' }), { target: { value: 'review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Step' }));

    await waitFor(() => {
      const stepCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/nodes/node-1/steps') && options?.method === 'POST'
      );
      expect(stepCalls.length).toBe(1);
    });
  });

  it('creates command steps with command config', async () => {
    render(<PlanScreen />);

    expect((await screen.findAllByText('Build orchestration')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '+ Step' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Step title' }), { target: { value: 'Write marker' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Step type' }), { target: { value: 'command' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Step command' }), { target: { value: 'printf marker > marker.txt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Step' }));

    await waitFor(() => {
      const stepCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/nodes/node-1/steps') && options?.method === 'POST'
      );
      expect(stepCalls.length).toBe(1);
      expect(JSON.parse(String(stepCalls[0][1]?.body)).config.command).toBe('printf marker > marker.txt');
    });
  });

  it('creates node worktrees through the Plan page', async () => {
    render(<PlanScreen />);

    expect((await screen.findAllByText('Build orchestration')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '+ Create worktree for Data Model' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Repository path' }), { target: { value: '/repo' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Base branch' }), { target: { value: 'main' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Worktree' }));

    await waitFor(() => {
      const worktreeCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/tasks/task-1/worktrees') && options?.method === 'POST'
      );
      expect(worktreeCalls.length).toBe(1);
    });
  });

  it('refreshes and removes worktrees from the Plan page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (String(url).endsWith('/api/orchestration/tasks') && !options) {
        return Promise.resolve({ ok: true, json: async () => [task] });
      }
      if (String(url).includes('/api/orchestration/tasks/task-1/events')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (String(url).includes('/api/orchestration/worktrees/worktree-1/refresh') && options?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ ...detailWithWorktree.worktrees[0], status: 'dirty', dirty_count: 1 }) });
      }
      if (String(url).includes('/api/orchestration/worktrees/worktree-1') && options?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ ...detailWithWorktree.worktrees[0], status: 'removed' }) });
      }
      if (String(url).includes('/api/orchestration/steps/step-1/run-command') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            step: { ...detailWithWorktree.steps[0], status: 'complete', output_summary: 'marker' },
            run: { id: 'run-1' },
            worktree: { ...detailWithWorktree.worktrees[0], status: 'dirty', dirty_count: 1 },
          }),
        });
      }
      if (String(url).includes('/api/orchestration/tasks/task-1')) {
        return Promise.resolve({ ok: true, json: async () => detailWithWorktree });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));
    render(<PlanScreen />);

    expect(await screen.findByText('orchestration/build-orchestration/data-model')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      const refreshCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/worktrees/worktree-1/refresh') && options?.method === 'POST'
      );
      const removeCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/worktrees/worktree-1') && options?.method === 'DELETE'
      );
      expect(refreshCalls.length).toBe(1);
      expect(removeCalls.length).toBe(1);
    });
  });

  it('runs command steps from the node worktree', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (String(url).endsWith('/api/orchestration/tasks') && !options) {
        return Promise.resolve({ ok: true, json: async () => [task] });
      }
      if (String(url).includes('/api/orchestration/tasks/task-1/events')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (String(url).includes('/api/orchestration/steps/step-1/run-command') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            step: { ...detailWithWorktree.steps[0], status: 'complete', output_summary: 'marker' },
            run: { id: 'run-1' },
            worktree: { ...detailWithWorktree.worktrees[0], status: 'dirty', dirty_count: 1 },
          }),
        });
      }
      if (String(url).includes('/api/orchestration/tasks/task-1')) {
        return Promise.resolve({ ok: true, json: async () => detailWithWorktree });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));
    render(<PlanScreen />);

    expect(await screen.findByText('printf marker > marker.txt')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      const runCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/steps/step-1/run-command') && options?.method === 'POST'
      );
      expect(runCalls.length).toBe(1);
    });
  });
});
