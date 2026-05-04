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

const cancelledTask = {
  ...task,
  id: 'task-cancelled',
  title: 'Cancelled clutter',
  description: 'Hide this from the board',
  status: 'cancelled',
  updated_at: '2026-05-02T00:01:00Z',
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
    kind: 'execution',
    base_branch: 'main',
    branch_name: 'orchestration/build-orchestration/data-model',
    base_commit: 'abc',
    head_commit: 'abc',
    status: 'clean',
    dirty_count: 0,
    dirty_summary: [],
  }],
};

const detailWithDirtyWorktree = {
  ...detailWithWorktree,
  worktrees: [{
    ...detailWithWorktree.worktrees[0],
    status: 'dirty',
    dirty_count: 1,
    dirty_summary: [{ path: 'README.md', status: 'M' }],
  }],
};

const detailWithAgentStep = {
  ...detailWithWorktree,
  steps: [{
    ...detail.steps[0],
    type: 'agent',
    title: 'Ask agent',
    config: { prompt: 'Update the docs' },
  }],
};

const planningCheckpoints = [
  {
    id: 'checkpoint-1',
    plan_inbox_item_id: 'plan-1',
    key: 'intake',
    title: 'Intake captured',
    status: 'agreed',
    summary: 'Automate orchestration',
    source_message_ids: [],
    blocking_question: null,
    created_at: '2026-05-03T00:00:00Z',
    updated_at: '2026-05-03T00:00:00Z',
  },
  {
    id: 'checkpoint-2',
    plan_inbox_item_id: 'plan-1',
    key: 'repo_target',
    title: 'Repo target clarified',
    status: 'missing',
    summary: '',
    source_message_ids: [],
    blocking_question: null,
    created_at: '2026-05-03T00:00:01Z',
    updated_at: '2026-05-03T00:00:01Z',
  },
  {
    id: 'checkpoint-3',
    plan_inbox_item_id: 'plan-1',
    key: 'verification',
    title: 'Verification strategy agreed',
    status: 'missing',
    summary: '',
    source_message_ids: [],
    blocking_question: null,
    created_at: '2026-05-03T00:00:02Z',
    updated_at: '2026-05-03T00:00:02Z',
  },
];

describe('PlanScreen orchestration board', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.nidavellir;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (String(url).endsWith('/api/agents/models')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              {
                id: 'claude:claude-sonnet-4-6',
                provider_id: 'claude',
                model_id: 'claude-sonnet-4-6',
                display_name: 'Claude Sonnet 4.6',
                description: 'Planner model',
                cost_tier: 'subscription',
                available: true,
              },
              {
                id: 'codex:gpt-5.5',
                provider_id: 'codex',
                model_id: 'gpt-5.5',
                display_name: 'GPT-5.5',
                description: 'Codex model',
                cost_tier: 'subscription',
                available: true,
              },
            ],
          }),
        });
      }
      if (String(url).endsWith('/api/orchestration/plan-inbox') && !options) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (String(url).endsWith('/api/orchestration/task-inbox') && !options) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (String(url).endsWith('/api/orchestration/plan-inbox') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'plan-1',
            raw_plan: 'Automate orchestration',
            repo_path: '/repo',
            base_branch: 'main',
            provider: null,
            model: null,
            automation_mode: 'supervised',
            max_concurrency: 1,
            priority: null,
            source: 'plan_tab',
            constraints: [],
            acceptance_criteria: ['Vague specs are blocked'],
            status: 'new',
            locked_by: null,
            locked_at: null,
            final_spec_id: null,
            created_at: '2026-05-03T00:00:00Z',
            updated_at: '2026-05-03T00:00:00Z',
            planning_checkpoints: planningCheckpoints,
          }),
        });
      }
      if (String(url).endsWith('/api/orchestration/plan-inbox/plan-1') && !options) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'plan-1',
            raw_plan: 'Automate orchestration',
            repo_path: '/repo',
            base_branch: 'main',
            provider: null,
            model: null,
            automation_mode: 'supervised',
            max_concurrency: 1,
            priority: null,
            source: 'plan_tab',
            constraints: [],
            acceptance_criteria: ['Vague specs are blocked'],
            status: 'new',
            locked_by: null,
            locked_at: null,
            final_spec_id: null,
            created_at: '2026-05-03T00:00:00Z',
            updated_at: '2026-05-03T00:00:00Z',
            discussion_messages: [{
              id: 'discussion-1',
              plan_inbox_item_id: 'plan-1',
              role: 'user',
              kind: 'message',
              content: 'Automate orchestration',
              linked_artifact_id: null,
              metadata: { source: 'raw_plan' },
              created_at: '2026-05-03T00:00:00Z',
            }],
            planning_checkpoints: planningCheckpoints,
          }),
        });
      }
      if (String(url).endsWith('/api/orchestration/plan-inbox/plan-1/pm-turn/stream') && options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'start' })}\n`));
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'activity', event: { type: 'progress', content: 'Reviewing planning gates', provider: 'claude' } })}\n`));
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'chunk', content: 'As Nidavellir PM, what verification should we lock before I draft the spec?' })}\n`));
            controller.enqueue(encoder.encode(`${JSON.stringify({
              type: 'result',
              result: {
                messages: [
                  {
                    id: 'discussion-2',
                    plan_inbox_item_id: 'plan-1',
                    role: 'user',
                    kind: 'message',
                    content: body.content,
                    linked_artifact_id: null,
                    metadata: {},
                    created_at: '2026-05-03T00:01:00Z',
                  },
                  {
                    id: 'discussion-3',
                    plan_inbox_item_id: 'plan-1',
                    role: 'planner',
                    kind: 'question',
                    content: 'As Nidavellir PM, what verification should we lock before I draft the spec?',
                    linked_artifact_id: null,
                    metadata: {},
                    created_at: '2026-05-03T00:02:00Z',
                  },
                ],
                plan: {
                  id: 'plan-1',
                  raw_plan: 'Automate orchestration',
                  repo_path: '/repo',
                  base_branch: 'main',
                  provider: null,
                  model: null,
                  automation_mode: 'supervised',
                  max_concurrency: 1,
                  priority: null,
                  source: 'plan_tab',
                  constraints: [],
                  acceptance_criteria: ['Vague specs are blocked'],
                  status: 'planning',
                  locked_by: null,
                  locked_at: null,
                  final_spec_id: null,
                  created_at: '2026-05-03T00:00:00Z',
                  updated_at: '2026-05-03T00:02:00Z',
                  discussion_messages: [
                    {
                      id: 'discussion-1',
                      plan_inbox_item_id: 'plan-1',
                      role: 'user',
                      kind: 'message',
                      content: 'Automate orchestration',
                      linked_artifact_id: null,
                      metadata: { source: 'raw_plan' },
                      created_at: '2026-05-03T00:00:00Z',
                    },
                    {
                      id: 'discussion-2',
                      plan_inbox_item_id: 'plan-1',
                      role: 'user',
                      kind: 'message',
                      content: body.content,
                      linked_artifact_id: null,
                      metadata: {},
                      created_at: '2026-05-03T00:01:00Z',
                    },
                    {
                      id: 'discussion-3',
                      plan_inbox_item_id: 'plan-1',
                      role: 'planner',
                      kind: 'question',
                      content: 'As Nidavellir PM, what verification should we lock before I draft the spec?',
                      linked_artifact_id: null,
                      metadata: {},
                      created_at: '2026-05-03T00:02:00Z',
                    },
                  ],
                  planning_checkpoints: planningCheckpoints,
                },
              },
            })}\n`));
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'done' })}\n`));
            controller.close();
          },
        });
        return Promise.resolve({
          ok: true,
          body: stream,
          json: async () => {
            const messages = [
              {
                id: 'discussion-2',
                plan_inbox_item_id: 'plan-1',
                role: 'user',
                kind: 'message',
                content: body.content,
                linked_artifact_id: null,
                metadata: {},
                created_at: '2026-05-03T00:01:00Z',
              },
              {
                id: 'discussion-3',
                plan_inbox_item_id: 'plan-1',
                role: 'planner',
                kind: 'question',
                content: 'As Nidavellir PM, what verification should we lock before I draft the spec?',
                linked_artifact_id: null,
                metadata: {},
                created_at: '2026-05-03T00:02:00Z',
              },
            ];
            return {
              messages,
              plan: {
                id: 'plan-1',
                raw_plan: 'Automate orchestration',
                repo_path: '/repo',
                base_branch: 'main',
                provider: null,
                model: null,
                automation_mode: 'supervised',
                max_concurrency: 1,
                priority: null,
                source: 'plan_tab',
                constraints: [],
                acceptance_criteria: ['Vague specs are blocked'],
                status: 'planning',
                locked_by: null,
                locked_at: null,
                final_spec_id: null,
                created_at: '2026-05-03T00:00:00Z',
                updated_at: '2026-05-03T00:02:00Z',
                discussion_messages: [
                  {
                    id: 'discussion-1',
                    plan_inbox_item_id: 'plan-1',
                    role: 'user',
                    kind: 'message',
                    content: 'Automate orchestration',
                    linked_artifact_id: null,
                    metadata: { source: 'raw_plan' },
                    created_at: '2026-05-03T00:00:00Z',
                  },
                  ...messages,
                ],
                planning_checkpoints: planningCheckpoints,
              },
            };
          },
        });
      }
      if (String(url).endsWith('/api/orchestration/tasks') && !options) {
        return Promise.resolve({ ok: true, json: async () => [task, cancelledTask] });
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
            kind: 'execution',
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
            kind: 'execution',
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
      if (String(url).includes('/api/orchestration/tasks/task-1/run-ready') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            task: { ...detailWithWorktree, steps: [{ ...detailWithWorktree.steps[0], status: 'complete' }] },
            executed: 1,
            results: [{ step_id: 'step-1', step_type: 'command', status: 'complete' }],
            pending_manual: [],
          }),
        });
      }
      if (String(url).includes('/api/orchestration/tasks/task-cancelled/archive') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...cancelledTask, archived: 1, deleted_at: '2026-05-03T00:00:00Z' }),
        });
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

  it('submits raw plans into the visible Plan Inbox', async () => {
    render(<PlanScreen />);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Plan inbox raw plan' }), { target: { value: 'Automate orchestration' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Plan repo path' }), { target: { value: '/repo' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Plan acceptance criteria' }), { target: { value: 'Vague specs are blocked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start PM Chat' }));

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).endsWith('/api/orchestration/plan-inbox') && options?.method === 'POST'
      );
      expect(calls.length).toBe(1);
      const body = JSON.parse(String(calls[0][1]?.body));
      expect(body.rawPlan).toBe('Automate orchestration');
      expect(body.repoPath).toBe('/repo');
      expect(body.provider).toBe('claude');
      expect(body.model).toBe('claude-sonnet-4-6');
      expect(body.acceptanceCriteria).toEqual(['Vague specs are blocked']);
    });
  });

  it('uses the desktop directory picker for Plan Inbox repo paths', async () => {
    const pickDirectory = vi.fn().mockResolvedValue('/picked/repo');
    window.nidavellir = {
      pickWorkingSetFiles: vi.fn().mockResolvedValue([]),
      pickDirectory,
    };

    render(<PlanScreen />);

    fireEvent.click(await screen.findByRole('button', { name: 'Browse' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Plan repo path' })).toHaveValue('/picked/repo'));

    fireEvent.change(screen.getByRole('textbox', { name: 'Plan inbox raw plan' }), { target: { value: 'Autonomous agent workflow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start PM Chat' }));

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).endsWith('/api/orchestration/plan-inbox') && options?.method === 'POST'
      );
      expect(calls.length).toBe(1);
      const body = JSON.parse(String(calls[0][1]?.body));
      expect(body.repoPath).toBe('/picked/repo');
    });
    expect(pickDirectory).toHaveBeenCalledTimes(1);
  });

  it('supports a back-and-forth with Nidavellir PM for the selected Plan Inbox item', async () => {
    render(<PlanScreen />);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Plan inbox raw plan' }), { target: { value: 'Automate orchestration' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start PM Chat' }));

    expect(await screen.findByText('PM Planning Session')).toBeTruthy();
    expect(await screen.findByText('Nidavellir PM')).toBeTruthy();
    expect(screen.getByText('Checkpoints')).toBeTruthy();
    expect((await screen.findAllByText('Automate orchestration')).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole('textbox', { name: 'Message Nidavellir PM' }), {
      target: { value: 'Decomposer should consume only the approved spec.' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message Nidavellir PM' }), { key: 'Enter', shiftKey: true });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/api/orchestration/plan-inbox/plan-1/pm-turn/stream'))).toBe(false);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message Nidavellir PM' }), { key: 'Enter' });

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).endsWith('/api/orchestration/plan-inbox/plan-1/pm-turn/stream') && options?.method === 'POST'
      );
      expect(calls.length).toBe(1);
      const body = JSON.parse(String(calls[0][1]?.body));
      expect(body.content).toBe('Decomposer should consume only the approved spec.');
      expect(body.provider).toBe('claude');
      expect(body.model).toBe('claude-sonnet-4-6');
    });
    expect(await screen.findByText('As Nidavellir PM, what verification should we lock before I draft the spec?')).toBeTruthy();

    expect(screen.queryByLabelText('Checkpoint status Repo target clarified')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View Spec' }));
    expect(await screen.findByText('Spec Snapshot')).toBeTruthy();
    expect(screen.getByText(/# Working Spec Snapshot/)).toBeTruthy();
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

  it('archives cancelled tasks from the board', async () => {
    render(<PlanScreen />);

    expect(await screen.findByText('Cancelled clutter')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Cancelled clutter' }));

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/tasks/task-cancelled/archive') && options?.method === 'POST'
      );
      expect(calls.length).toBe(1);
      expect(screen.queryByText('Cancelled clutter')).toBeNull();
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

  it('creates agent steps with prompt config', async () => {
    render(<PlanScreen />);

    expect((await screen.findAllByText('Build orchestration')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '+ Step' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Step title' }), { target: { value: 'Ask agent' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Step type' }), { target: { value: 'agent' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Agent prompt' }), { target: { value: 'Update the docs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Step' }));

    await waitFor(() => {
      const stepCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/nodes/node-1/steps') && options?.method === 'POST'
      );
      expect(stepCalls.length).toBe(1);
      expect(JSON.parse(String(stepCalls[0][1]?.body)).config.prompt).toBe('Update the docs');
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

  it('refreshes, checkpoints, and removes worktrees from the Plan page', async () => {
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
      if (String(url).includes('/api/orchestration/worktrees/worktree-1/checkpoint') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            worktree: { ...detailWithWorktree.worktrees[0], status: 'clean', dirty_count: 0 },
            commit: 'def',
            message: 'Checkpoint orchestration/build-orchestration/data-model',
          }),
        });
      }
      if (String(url).includes('/api/orchestration/worktrees/worktree-1/review') && !options) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            worktree: { ...detailWithWorktree.worktrees[0], status: 'clean', dirty_count: 0 },
            review: {
              ready_to_merge: true,
              commit_count: 1,
              files: [{ path: 'README.md', status: 'M' }],
              commits: [{ sha: 'def456', short_sha: 'def456', subject: 'Checkpoint node' }],
              shortstat: '1 file changed, 1 insertion(+)',
              status: 'clean',
              dirty_count: 0,
            },
          }),
        });
      }
      if (String(url).includes('/api/orchestration/worktrees/worktree-1/integration-proposal') && !options) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            worktree: { ...detailWithWorktree.worktrees[0], status: 'clean', dirty_count: 0 },
            proposal: {
              title: 'Integrate orchestration work: Data Model',
              body: '## Orchestration Integration\n- Source branch: `orchestration/build-orchestration/data-model`\n- Target branch: `main`',
              source_branch: 'orchestration/build-orchestration/data-model',
              target_branch: 'main',
              ready_to_merge: true,
              head_commit: 'def456',
              review: {
                ready_to_merge: true,
                commit_count: 1,
                files: [{ path: 'README.md', status: 'M' }],
                commits: [{ sha: 'def456', short_sha: 'def456', subject: 'Checkpoint node' }],
                shortstat: '1 file changed, 1 insertion(+)',
                status: 'clean',
                dirty_count: 0,
              },
            },
          }),
        });
      }
      if (String(url).includes('/api/orchestration/worktrees/worktree-1/integration-preflight') && !options) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            worktree: { ...detailWithWorktree.worktrees[0], status: 'clean', dirty_count: 0 },
            preflight: {
              can_merge: true,
              message: 'Merge preflight passed.',
              target_ref: 'main',
              source_ref: 'orchestration/build-orchestration/data-model',
              commits_to_merge: 1,
              target_ahead_count: 0,
              files: [{ path: 'README.md', status: 'M' }],
              conflicts: [],
            },
          }),
        });
      }
      if (String(url).includes('/api/orchestration/worktrees/worktree-1/integration-worktree') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            source_worktree: detailWithWorktree.worktrees[0],
            integration: {
              branch_name: 'integration/orchestration-build-orchestration-data-model',
              worktree_path: '/repo-worktrees/integrations/data-model',
              head_commit: 'merge123',
              merged: true,
              status: 'clean',
            },
          }),
        });
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
        return Promise.resolve({ ok: true, json: async () => detailWithDirtyWorktree });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));
    render(<PlanScreen />);

    expect(await screen.findByText('execution / orchestration/build-orchestration/data-model')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Checkpoint' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Propose' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preflight' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Ready to merge - 1 commits - 1 files')).toBeTruthy();
    expect(await screen.findByText('Integrate orchestration work: Data Model')).toBeTruthy();
    expect(await screen.findByText('Merge preflight passed')).toBeTruthy();
    expect(await screen.findByText('Integration branch staged')).toBeTruthy();

    await waitFor(() => {
      const refreshCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/worktrees/worktree-1/refresh') && options?.method === 'POST'
      );
      const removeCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/worktrees/worktree-1') && options?.method === 'DELETE'
      );
      const checkpointCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/worktrees/worktree-1/checkpoint') && options?.method === 'POST'
      );
      const reviewCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/worktrees/worktree-1/review') && !options
      );
      const proposalCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/worktrees/worktree-1/integration-proposal') && !options
      );
      const preflightCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/worktrees/worktree-1/integration-preflight') && !options
      );
      const stageCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/worktrees/worktree-1/integration-worktree') && options?.method === 'POST'
      );
      expect(refreshCalls.length).toBe(1);
      expect(checkpointCalls.length).toBe(1);
      expect(reviewCalls.length).toBe(1);
      expect(proposalCalls.length).toBe(1);
      expect(preflightCalls.length).toBe(1);
      expect(stageCalls.length).toBe(1);
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

  it('runs agent steps from the node worktree', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (String(url).endsWith('/api/orchestration/tasks') && !options) {
        return Promise.resolve({ ok: true, json: async () => [task] });
      }
      if (String(url).includes('/api/orchestration/tasks/task-1/events')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (String(url).includes('/api/orchestration/steps/step-1/run-agent') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            step: { ...detailWithAgentStep.steps[0], status: 'complete', output_summary: 'done' },
            run_attempt: { id: 'attempt-1' },
            worktree: { ...detailWithAgentStep.worktrees[0], status: 'dirty', dirty_count: 1 },
            transcript: 'done',
          }),
        });
      }
      if (String(url).includes('/api/orchestration/tasks/task-1')) {
        return Promise.resolve({ ok: true, json: async () => detailWithAgentStep });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));
    render(<PlanScreen />);

    expect(await screen.findByText('Update the docs')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      const runCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/steps/step-1/run-agent') && options?.method === 'POST'
      );
      expect(runCalls.length).toBe(1);
    });
  });

  it('runs ready task steps from the Plan toolbar', async () => {
    render(<PlanScreen />);

    expect((await screen.findAllByText('Build orchestration')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Run Ready' }));

    await waitFor(() => {
      const runCalls = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
        String(url).includes('/api/orchestration/tasks/task-1/run-ready') && options?.method === 'POST'
      );
      expect(runCalls.length).toBe(1);
    });
  });
});
