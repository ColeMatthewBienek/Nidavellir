import type { Page } from '@playwright/test';

// ── Mock payloads ─────────────────────────────────────────────────────────────

export const MOCK_PROVIDERS = [
  {
    id: 'claude',
    display_name: 'Anthropic Claude',
    description: 'Flagship Anthropic model via Claude Code CLI.',
    available: true,
    roles: ['executor', 'chat'],
    cost_tier: 'api_metered',
    latency_tier: 'medium',
    supports_session_resume: true,
    supports_persistent_context: true,
    supports_multiline_input: true,
    supports_file_context: true,
    supports_image_input: true,
    supports_interrupt: true,
    streams_incrementally: true,
    emits_tool_use_blocks: true,
    output_format: 'ansi_rich',
    supports_bash_execution: true,
    supports_file_write: true,
    supports_worktree_isolation: true,
    requires_network: true,
    supports_parallel_slots: false,
    max_concurrent_slots: null,
  },
  {
    id: 'codex',
    display_name: 'OpenAI Codex',
    description: 'OpenAI o4-mini via Codex CLI.',
    available: false,
    roles: ['executor'],
    cost_tier: 'api_metered',
    latency_tier: 'low',
    supports_session_resume: false,
    supports_persistent_context: false,
    supports_multiline_input: true,
    supports_file_context: false,
    supports_image_input: false,
    supports_interrupt: false,
    streams_incrementally: true,
    emits_tool_use_blocks: false,
    output_format: 'ansi_simple',
    supports_bash_execution: true,
    supports_file_write: true,
    supports_worktree_isolation: false,
    requires_network: true,
    supports_parallel_slots: false,
    max_concurrent_slots: null,
  },
  {
    id: 'ollama',
    display_name: 'Ollama (Qwen)',
    description: 'Local Qwen3-coder via Ollama.',
    available: true,
    roles: ['executor', 'chat'],
    cost_tier: 'local',
    latency_tier: 'low',
    supports_session_resume: false,
    supports_persistent_context: false,
    supports_multiline_input: true,
    supports_file_context: false,
    supports_image_input: false,
    supports_interrupt: false,
    streams_incrementally: true,
    emits_tool_use_blocks: false,
    output_format: 'plain',
    supports_bash_execution: false,
    supports_file_write: false,
    supports_worktree_isolation: false,
    requires_network: false,
    supports_parallel_slots: true,
    max_concurrent_slots: 4,
  },
];

export const MOCK_AGENT_MODELS = [
  {
    id:           'claude:claude-opus-4-5',
    provider_id:  'claude',
    model_id:     'claude-opus-4-5',
    display_name: 'Claude Opus 4.5',
    description:  'Most capable Claude model.',
    cost_tier:    'subscription',
    available:    true,
  },
  {
    id:           'claude:claude-sonnet-4-6',
    provider_id:  'claude',
    model_id:     'claude-sonnet-4-6',
    display_name: 'Claude Sonnet 4.6',
    description:  'Balanced capability and speed.',
    cost_tier:    'subscription',
    available:    true,
  },
  {
    id:           'claude:claude-haiku-4-5',
    provider_id:  'claude',
    model_id:     'claude-haiku-4-5',
    display_name: 'Claude Haiku 4.5',
    description:  'Fast and efficient.',
    cost_tier:    'subscription',
    available:    true,
  },
  {
    id:           'codex:gpt-5.4',
    provider_id:  'codex',
    model_id:     'gpt-5.4',
    display_name: 'GPT-5.4',
    description:  'Codex default — most capable model for complex coding tasks.',
    cost_tier:    'subscription',
    available:    false,
  },
  {
    id:           'ollama:qwen3-coder:30b',
    provider_id:  'ollama',
    model_id:     'qwen3-coder:30b',
    display_name: 'qwen3-coder:30b',
    description:  'Local Ollama model.',
    cost_tier:    'local',
    available:    true,
  },
];

export const MOCK_HEALTH_OK = { status: 'ok' };

// ── Route installers ──────────────────────────────────────────────────────────

/** Standard mock: health OK, providers + models loaded from mock data */
export async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: MOCK_HEALTH_OK })
  );
  await page.route('**/api/agents/providers', (route) =>
    route.fulfill({ json: { providers: MOCK_PROVIDERS } })
  );
  await page.route('**/api/agents/models', (route) =>
    route.fulfill({ json: { models: MOCK_AGENT_MODELS } })
  );
  await page.route('**/api/conversations', (route) =>
    route.fulfill({ json: [] })
  );
}

/** Simulates backend completely unreachable */
export async function mockApiDown(page: Page): Promise<void> {
  await page.route('**/api/health', (route) => route.abort('connectionrefused'));
  await page.route('**/api/agents/providers', (route) => route.abort('connectionrefused'));
  await page.route('**/api/agents/models', (route) => route.abort('connectionrefused'));
}

/** Providers endpoint returns only available providers */
export async function mockApiOnlyAvailable(page: Page): Promise<void> {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: MOCK_HEALTH_OK })
  );
  await page.route('**/api/agents/providers', (route) =>
    route.fulfill({ json: { providers: MOCK_PROVIDERS.filter((p) => p.available) } })
  );
  await page.route('**/api/agents/models', (route) =>
    route.fulfill({ json: { models: MOCK_AGENT_MODELS.filter((m) => m.available) } })
  );
}
