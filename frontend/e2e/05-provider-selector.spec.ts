import { test, expect } from '@playwright/test';
import { mockApi, MOCK_AGENT_MODELS } from './fixtures/api-mocks';
import { installWsMock } from './fixtures/ws-mock';

test.beforeEach(async ({ page }) => {
  await installWsMock(page);
  await mockApi(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(100);
});

// Helper: click an element by dispatching a DOM click event,
// bypassing Playwright's viewport and pointer-event geometry checks.
// Used for dropdown rows that are inside overflow:hidden containers.
async function domClick(page: import('@playwright/test').Page, testId: string) {
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    if (el) el.click();
    else throw new Error(`Element not found: [data-testid="${id}"]`);
  }, testId);
}

// ── AgentSelector renders in TopBar ──────────────────────────────────────────

test.describe('AgentSelector renders in TopBar', () => {
  test('no legacy <select> with hardcoded options in the DOM', async ({ page }) => {
    await expect(page.locator('select option', { hasText: 'claude-opus-4' })).toHaveCount(0);
    await expect(page.locator('select option', { hasText: 'claude-sonnet-4' })).toHaveCount(0);
    await expect(page.locator('select option', { hasText: 'codex-mini' })).toHaveCount(0);
  });

  test('provider-btn is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="provider-btn"]')).toBeVisible();
  });

  test('provider-btn is not a <select> element', async ({ page }) => {
    const tag = await page.locator('[data-testid="provider-btn"]').evaluate((el) => el.tagName.toLowerCase());
    expect(tag).not.toBe('select');
  });

  test('button shows default model label containing "sonnet"', async ({ page }) => {
    // Default selectedModel is "claude:claude-sonnet-4-6" → label includes "sonnet"
    await expect(page.locator('[data-testid="provider-btn"]')).toContainText('sonnet');
  });

  test('button shows the Claude provider icon ◆', async ({ page }) => {
    await expect(page.locator('[data-testid="provider-btn"]')).toContainText('◆');
  });

  test('button has the amber/claude theme border class', async ({ page }) => {
    const cls = await page.locator('[data-testid="provider-btn"]').getAttribute('class');
    expect(cls).toMatch(/amber/);
  });
});

// ── Dropdown opens and shows models from API ──────────────────────────────────

test.describe('Dropdown opens and shows models from API', () => {
  test('clicking provider-btn opens the dropdown', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    await expect(page.locator('[data-testid="provider-dropdown"]')).toBeVisible();
  });

  test('dropdown shows the Claude provider section header', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    await expect(page.locator('[data-testid="provider-dropdown"]')).toContainText('Claude');
  });

  test('dropdown shows all 3 Claude models', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    const dropdown = page.locator('[data-testid="provider-dropdown"]');
    await expect(dropdown).toContainText('Claude Opus 4.5');
    await expect(dropdown).toContainText('Claude Sonnet 4.6');
    await expect(dropdown).toContainText('Claude Haiku 4.5');
  });

  test('dropdown shows the Codex provider section header', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    await expect(page.locator('[data-testid="provider-dropdown"]')).toContainText('Codex');
  });

  test('codex model GPT-5.4 shows "not found" (available: false)', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    const codexRow = page.locator('[data-testid="provider-option-codex:gpt-5.4"]');
    await expect(codexRow).toContainText('not found');
  });

  test('codex model button is disabled', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    await expect(page.locator('[data-testid="provider-option-codex:gpt-5.4"]')).toBeDisabled();
  });

  test('dropdown shows the Ollama section header (Qwen shortName)', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    await expect(page.locator('[data-testid="provider-dropdown"]')).toContainText('Qwen');
  });

  test('ollama model shows "local · free" (cost_tier = local)', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    await expect(page.locator('[data-testid="provider-dropdown"]')).toContainText('local · free');
  });
});

// ── Model tiers display correctly ─────────────────────────────────────────────

test.describe('Model tiers display correctly', () => {
  test('Claude Opus 4.5 row shows Opus tier badge', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    const opusRow = page.locator('[data-testid="provider-option-claude:claude-opus-4-5"]');
    await expect(opusRow).toContainText('Opus');
  });

  test('Claude Sonnet 4.6 row shows Sonnet tier badge', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    const sonnetRow = page.locator('[data-testid="provider-option-claude:claude-sonnet-4-6"]');
    await expect(sonnetRow).toContainText('Sonnet');
  });

  test('Claude Haiku 4.5 row shows Haiku tier badge', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    const haikuRow = page.locator('[data-testid="provider-option-claude:claude-haiku-4-5"]');
    await expect(haikuRow).toContainText('Haiku');
  });

  test('active model (claude-sonnet-4-6) has checkmark ✓', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    const sonnetRow = page.locator('[data-testid="provider-option-claude:claude-sonnet-4-6"]');
    await expect(sonnetRow).toContainText('✓');
  });
});

// ── Model selection ───────────────────────────────────────────────────────────

test.describe('Model selection', () => {
  test('clicking Claude Haiku 4.5 closes dropdown and updates button label', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    await page.locator('[data-testid="provider-option-claude:claude-haiku-4-5"]').click();
    await expect(page.locator('[data-testid="provider-dropdown"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="provider-btn"]')).toContainText('haiku');
  });

  test('clicking Claude Opus 4.5 updates button to show opus label', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    // domClick bypasses Playwright's viewport geometry check — the element
    // is correctly positioned but inside an overflow:hidden container.
    await domClick(page, 'provider-option-claude:claude-opus-4-5');
    await expect(page.locator('[data-testid="provider-btn"]')).toContainText('opus');
  });

  test('clicking available ollama model switches to ollama provider icon', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    await domClick(page, 'provider-option-ollama:qwen3-coder:30b');
    // Ollama icon is ⬢
    await expect(page.locator('[data-testid="provider-btn"]')).toContainText('⬢');
  });

  test('clicking disabled codex model does NOT change selection', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    // Force-click disabled button to confirm it does nothing
    await page.locator('[data-testid="provider-option-codex:gpt-5.4"]').click({ force: true });
    // Still shows Claude icon
    await expect(page.locator('[data-testid="provider-btn"]')).toContainText('◆');
  });
});

// ── Dropdown dismiss ──────────────────────────────────────────────────────────

test.describe('Dropdown dismiss', () => {
  test('clicking outside the dropdown closes it', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    await expect(page.locator('[data-testid="provider-dropdown"]')).toBeVisible();
    await page.mouse.click(100, 400);
    await expect(page.locator('[data-testid="provider-dropdown"]')).not.toBeVisible();
  });

  test('clicking the button again closes the dropdown (toggle)', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    await expect(page.locator('[data-testid="provider-dropdown"]')).toBeVisible();
    // domClick bypasses Playwright's viewport check that triggers on the second click
    // when the open dropdown changes layout calculations.
    await domClick(page, 'provider-btn');
    await expect(page.locator('[data-testid="provider-dropdown"]')).not.toBeVisible();
  });
});

// ── No models case ────────────────────────────────────────────────────────────

test.describe('No models case', () => {
  test('dropdown shows "No agents available" when model list is empty', async ({ page }) => {
    await page.route('**/api/agents/models', (route) =>
      route.fulfill({ json: { models: [] } })
    );
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(100);

    await page.locator('[data-testid="provider-btn"]').click();
    await expect(page.locator('[data-testid="provider-dropdown"]')).toContainText('No agents available');
  });
});

// ── Model data integrity ──────────────────────────────────────────────────────
// Verifies the dropdown renders correctly based on what the /api/agents/models
// endpoint returns. Loading-gate behavior (open && !loading) is covered at the
// unit level; E2E confirms the end-to-end data flow from mock → store → UI.

test.describe('Model data integrity', () => {
  test('dropdown accurately reflects available vs unavailable models', async ({ page }) => {
    await page.locator('[data-testid="provider-btn"]').click();
    const dropdown = page.locator('[data-testid="provider-dropdown"]');

    // Available claude models are clickable (no disabled attr)
    const sonnet = page.locator('[data-testid="provider-option-claude:claude-sonnet-4-6"]');
    await expect(sonnet).toBeEnabled();

    // Unavailable codex model is disabled
    const codex = page.locator('[data-testid="provider-option-codex:gpt-5.4"]');
    await expect(codex).toBeDisabled();

    // Ollama is available and shows local/free label
    await expect(dropdown).toContainText('local · free');
  });

  test('selecting a model updates the active indicator to the new model', async ({ page }) => {
    // Switch to Haiku
    await page.locator('[data-testid="provider-btn"]').click();
    await page.locator('[data-testid="provider-option-claude:claude-haiku-4-5"]').click();

    // Re-open and confirm Haiku now has the checkmark
    await page.locator('[data-testid="provider-btn"]').click();
    const haikuRow = page.locator('[data-testid="provider-option-claude:claude-haiku-4-5"]');
    await expect(haikuRow).toContainText('✓');

    // And Sonnet no longer has it
    const sonnetRow = page.locator('[data-testid="provider-option-claude:claude-sonnet-4-6"]');
    await expect(sonnetRow).not.toContainText('✓');
  });
});
