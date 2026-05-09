import { test, expect, type Page, type Route } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks';

const checkpoints = [
  ['intake', 'Intake captured'],
  ['repo_target', 'Repo target clarified'],
  ['scope', 'Scope and non-goals agreed'],
  ['acceptance', 'Acceptance criteria agreed'],
  ['verification', 'Verification strategy agreed'],
  ['risks', 'Risks and dependencies agreed'],
  ['spec_draft', 'Spec draft generated'],
  ['spec_approved', 'Spec approved for decomposition'],
].map(([key, title]) => ({
  id: `checkpoint-${key}`,
  plan_inbox_item_id: 'plan-pilot',
  key,
  title,
  status: 'agreed',
  summary: `${title} locked.`,
  source_message_ids: [],
  blocking_question: null,
  created_at: '2026-05-09T12:00:00Z',
  updated_at: '2026-05-09T12:00:00Z',
}));

const plan = {
  id: 'plan-pilot',
  raw_plan: 'Ready pilot plan',
  repo_path: '/tmp/nidavellir-small-project',
  base_branch: 'main',
  provider: 'claude',
  model: 'claude-sonnet-4-6',
  entry_mode: 'existing_project',
  work_lane: 'chore',
  repo_profile: { ok: true, package_manager: 'npm', test_commands: ['npm test'], git: { current_branch: 'main' } },
  automation_mode: 'autonomous',
  max_concurrency: 1,
  priority: null,
  source: 'plan_tab',
  constraints: [],
  acceptance_criteria: ['Pilot history is durable'],
  status: 'spec_ready',
  locked_by: null,
  locked_at: null,
  final_spec_id: 'spec-pilot',
  archived: false,
  deleted_at: null,
  created_at: '2026-05-09T12:00:00Z',
  updated_at: '2026-05-09T12:00:00Z',
  discussion_messages: [{
    id: 'discussion-raw',
    plan_inbox_item_id: 'plan-pilot',
    role: 'user',
    kind: 'message',
    content: 'Ready pilot plan',
    linked_artifact_id: null,
    metadata: { source: 'raw_plan' },
    created_at: '2026-05-09T12:00:00Z',
  }],
  planning_checkpoints: checkpoints,
  specs: [{
    id: 'spec-pilot',
    plan_inbox_item_id: 'plan-pilot',
    version: 1,
    content: '# Agentic Forward Spec\n\n## Verification Strategy\n- `npm test`',
    metadata: {},
    status: 'ready',
    created_at: '2026-05-09T12:00:00Z',
    updated_at: '2026-05-09T12:00:00Z',
  }],
  decomposition_runs: [],
};

const task = {
  id: 'task-pilot',
  title: 'Ready pilot plan',
  description: 'Run the tiny project verification.',
  status: 'review',
  priority: null,
  labels: [],
  conversation_id: null,
  base_repo_path: '/tmp/nidavellir-small-project',
  base_branch: 'main',
  task_branch: 'codex/pilot-task',
  worktree_path: '/tmp/nidavellir-small-project/.worktrees/task-pilot',
  archived: 0,
  deleted_at: null,
  updated_at: '2026-05-09T12:01:00Z',
  nodes: [{
    id: 'node-pilot',
    task_id: 'task-pilot',
    title: 'Verification',
    description: 'Run test command',
    status: 'complete',
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    skill_ids: [],
    position_x: 80,
    position_y: 80,
  }],
  edges: [],
  steps: [{
    id: 'step-pilot',
    node_id: 'node-pilot',
    order_index: 0,
    type: 'command',
    title: 'Run tests',
    description: 'npm test',
    status: 'complete',
    config: { command: 'npm test' },
    output_summary: 'orchestration-smoke-ok',
  }],
  worktrees: [{
    id: 'worktree-pilot',
    task_id: 'task-pilot',
    node_id: 'node-pilot',
    repo_path: '/tmp/nidavellir-small-project',
    worktree_path: '/tmp/nidavellir-small-project/.worktrees/task-pilot',
    kind: 'execution',
    base_branch: 'main',
    branch_name: 'codex/pilot-task',
    base_commit: 'abc123',
    head_commit: 'def456',
    status: 'dirty',
    dirty_count: 1,
    dirty_summary: [{ path: 'pilot.txt', status: 'M' }],
  }],
  readiness: { runnable: [], blocked: [] },
};

const evidence = {
  task_id: 'task-pilot',
  task_status: 'review',
  generated_at: '2026-05-09T12:01:00Z',
  summary: { step_count: 1, run_attempt_count: 1, artifact_count: 1, event_count: 5, latest_status: 'complete' },
  steps: task.steps,
  run_attempts: [],
  artifacts: [{
    id: 'artifact-pilot',
    task_id: null,
    node_id: null,
    step_id: null,
    run_attempt_id: null,
    type: 'pilot_run',
    title: 'Pilot run: Ready pilot plan',
    summary: 'Pilot succeeded: 1 task(s), 1 evidence bundle(s), 0 failure(s).',
    content: '{}',
    metadata: { plan_inbox_item_id: 'plan-pilot', status: 'succeeded' },
    created_at: '2026-05-09T12:01:00Z',
  }],
  events: [],
};

async function mockPlanPilotApi(page: Page) {
  let pilotRan = false;
  let queuedStatus = 'review';

  const fulfill = (route: Route, json: unknown) => route.fulfill({ json });

  await page.route('**/api/orchestration/plan-inbox', async (route) => {
    if (route.request().method() === 'POST') {
      await fulfill(route, plan);
      return;
    }
    await fulfill(route, []);
  });
  await page.route('**/api/orchestration/plan-inbox/plan-pilot', (route) => fulfill(route, plan));
  await page.route('**/api/orchestration/plan-inbox/plan-pilot/pilot-runs', (route) => fulfill(route, pilotRan ? [{
    id: 'event-pilot',
    created_at: '2026-05-09T12:01:00Z',
    status: 'succeeded',
    summary: 'Pilot succeeded: 1 task(s), 1 evidence bundle(s), 0 failure(s).',
    failures: [],
    task_ids: ['task-pilot'],
    task_inbox_item_ids: ['task-inbox-pilot'],
    spec_id: 'spec-pilot',
    decomposition_run_id: 'decomp-pilot',
    artifact: evidence.artifacts[0],
    event: { id: 'event-pilot', type: 'autonomous_pilot_run_finished', payload: { plan_inbox_item_id: 'plan-pilot' }, created_at: '2026-05-09T12:01:00Z' },
  }] : []));
  await page.route('**/api/orchestration/plan-inbox/plan-pilot/pilot-run', async (route) => {
    pilotRan = true;
    await fulfill(route, {
      plan,
      spec: plan.specs[0],
      decomposition: {
        plan,
        decomposition_run: { id: 'decomp-pilot', plan_inbox_item_id: 'plan-pilot', spec_id: 'spec-pilot', pass_index: 1, decomposer_output: {}, status: 'created', created_at: '2026-05-09T12:01:00Z', updated_at: '2026-05-09T12:01:00Z' },
        task_inbox_items: [{ id: 'task-inbox-pilot', plan_inbox_item_id: 'plan-pilot', decomposition_run_id: 'decomp-pilot', candidate_task_id: null, title: 'Ready pilot plan', objective: 'Run pilot', payload: {}, dependencies: [], status: 'materialized', priority: null, locked_by: null, locked_at: null, materialized_task_id: 'task-pilot', materialized_node_id: 'node-pilot', created_at: '2026-05-09T12:01:00Z', updated_at: '2026-05-09T12:01:00Z' }],
      },
      daemon_tick: { mode: 'autonomous' },
      tasks: [task],
      evidence: [evidence],
      pilot: { status: 'succeeded', summary: 'Pilot succeeded: 1 task(s), 1 evidence bundle(s), 0 failure(s).', failures: [] },
      artifact: evidence.artifacts[0],
      event: { id: 'event-pilot', type: 'autonomous_pilot_run_finished', payload: { plan_inbox_item_id: 'plan-pilot', status: 'succeeded', artifact_id: 'artifact-pilot' }, created_at: '2026-05-09T12:01:00Z' },
    });
  });
  await page.route('**/api/orchestration/task-inbox', (route) => fulfill(route, []));
  await page.route('**/api/orchestration/tasks', (route) => fulfill(route, pilotRan ? [{ ...task, status: queuedStatus }] : []));
  await page.route('**/api/orchestration/tasks/task-pilot/events', (route) => fulfill(route, []));
  await page.route('**/api/orchestration/tasks/task-pilot/evidence', (route) => fulfill(route, evidence));
  await page.route('**/api/orchestration/tasks/task-pilot', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = JSON.parse(route.request().postData() || '{}') as { status?: string };
      queuedStatus = body.status ?? queuedStatus;
      await fulfill(route, { ...task, status: queuedStatus });
      return;
    }
    await fulfill(route, { ...task, status: queuedStatus });
  });
  await page.route('**/api/orchestration/artifacts/artifact-pilot', (route) => fulfill(route, evidence.artifacts[0]));
  await page.route('**/api/orchestration/events?**', (route) => fulfill(route, []));
  await page.route('**/api/orchestration/daemon/state', (route) => fulfill(route, {
    id: 'default',
    status: 'active',
    autonomy_mode: 'autonomous',
    interval_seconds: 30,
    max_inbox_items: 5,
    max_queued_tasks: 2,
    max_steps_per_task: 10,
    process_inbox: true,
    run_queue: true,
    last_tick_started_at: null,
    last_tick_finished_at: null,
    last_tick_event_id: null,
    last_tick_summary: {},
    health: { state: 'idle', is_active: true },
    created_at: '2026-05-09T12:00:00Z',
    updated_at: '2026-05-09T12:00:00Z',
  }));
  await page.route('**/api/orchestration/readiness', (route) => fulfill(route, {
    status: 'ready',
    generated_at: '2026-05-09T12:00:00Z',
    checks: [],
    counts: { plan_inbox_count: 0, task_count: 0, new_task_inbox_count: 0, queued_task_count: 0, running_task_count: 0, blocked_task_count: 0, active_worktree_count: 0 },
  }));
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await mockPlanPilotApi(page);
  await page.goto('/');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('nid:navigate', { detail: 'plan' }));
  });
  await expect(page.getByRole('textbox', { name: 'Plan inbox raw plan' })).toBeVisible();
});

test('runs a PM-approved autonomous pilot and reviews it from history', async ({ page }) => {
  const pilotRequest = page.waitForRequest((request) =>
    request.method() === 'POST' && request.url().endsWith('/api/orchestration/plan-inbox/plan-pilot/pilot-run')
  );

  await page.getByRole('textbox', { name: 'Plan inbox raw plan' }).fill('Ready pilot plan');
  await page.getByRole('textbox', { name: 'Plan repo path' }).fill('/tmp/nidavellir-small-project');
  await page.getByRole('button', { name: 'Start PM Chat' }).click();
  await expect(page.getByText('PM Planning Session')).toBeVisible();

  await page.getByLabel('Pilot max steps').selectOption('5');
  await page.getByLabel('Pilot timeout seconds').fill('90');
  await page.getByRole('button', { name: 'Run Pilot' }).click();

  const request = await pilotRequest;
  expect(await request.postDataJSON()).toMatchObject({
    maxTasks: 1,
    runAgent: true,
    maxStepsPerTask: 5,
    timeoutSeconds: 90,
    lockedBy: 'plan-screen-pilot',
  });

  await expect(page.getByText('Pilot result')).toBeVisible();
  await expect(page.getByText('Pilot Runs')).toBeVisible();
  await expect(page.getByText('Pilot succeeded: 1 task(s), 1 evidence bundle(s), 0 failure(s).').first()).toBeVisible();

  await page.getByRole('button', { name: 'Open Task' }).click();
  await expect(page.getByText('Execution Evidence')).toBeVisible();
  await expect(page.getByText('orchestration-smoke-ok').first()).toBeVisible();

  const queueRequest = page.waitForRequest((queued) =>
    queued.method() === 'PATCH' && queued.url().endsWith('/api/orchestration/tasks/task-pilot')
  );
  await page.getByRole('button', { name: 'Queue Task' }).click();
  expect(await (await queueRequest).postDataJSON()).toEqual({ status: 'queued_for_execution' });
});
