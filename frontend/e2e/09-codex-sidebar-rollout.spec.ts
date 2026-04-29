import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks';
import { installWsMock, wsSend } from './fixtures/ws-mock';

test.beforeEach(async ({ page }) => {
  await installWsMock(page);
  await mockApi(page);

  await page.route('**/api/conversations', (route) =>
    route.fulfill({
      json: [{
        id: 'conv-rollout',
        title: 'Feature Parity',
        createdAt: '2026-04-28T10:00:00Z',
        updatedAt: '2026-04-28T10:05:00Z',
        activeProvider: 'claude',
        activeModel: 'claude-sonnet-4-6',
        workingDirectory: '/mnt/c/Users/colebienek/projects/nidavellir',
        workingDirectoryDisplay: '/mnt/c/Users/colebienek/projects/nidavellir',
        messageCount: 0,
        pinned: false,
        archived: false,
      }],
    })
  );

  await page.route('**/api/conversations/conv-rollout', (route) =>
    route.fulfill({
      json: {
        id: 'conv-rollout',
        title: 'Feature Parity',
        activeSessionId: 'sess-rollout',
        activeProvider: 'claude',
        activeModel: 'claude-sonnet-4-6',
        workingDirectory: '/mnt/c/Users/colebienek/projects/nidavellir',
        workingDirectoryDisplay: '/mnt/c/Users/colebienek/projects/nidavellir',
        selectedFiles: [],
        messages: [],
      },
    })
  );

  await page.route('**/api/conversations/conv-rollout/files', (route) =>
    route.fulfill({ json: [] })
  );

  await page.route('**/api/context/usage?**', (route) =>
    route.fulfill({
      json: {
        model: 'claude-sonnet-4-6',
        provider: 'claude',
        currentTokens: 42,
        usableTokens: 100000,
        contextLimit: 120000,
        percentUsed: 0.04,
        state: 'ok',
        accuracy: 'estimated',
        lastUpdatedAt: '2026-04-28T10:00:00Z',
      },
    })
  );

  await page.route('**/api/memory/quality/summary', (route) =>
    route.fulfill({
      json: {
        status: 'healthy',
        active_memories: 0,
        injected_24h: 0,
        extraction_failures_24h: 0,
        low_confidence_stored: 0,
        never_used: 0,
        recent_alerts: [],
      },
    })
  );

  await page.route('**/api/git/status?**', (route) =>
    route.fulfill({
      json: {
        isRepo: true,
        branch: 'main',
        dirtyCount: 1,
        files: [{ path: 'backend/nidavellir/routers/health.py', status: 'M' }],
      },
    })
  );

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('conversation-row-conv-rollout').click();
});

test('Codex-style sidebar shows Summary, Review, and Git from a completed build turn', async ({ page }) => {
  await page.locator('textarea[placeholder*="Message Nidavellir"]').fill('Add buildMode to health.');
  await page.getByRole('button', { name: 'Send' }).click();

  await wsSend(page, {
    type: 'activity',
    event: { type: 'answer_delta', content: 'Implemented the buildMode health field.' },
  });
  await wsSend(page, {
    type: 'activity',
    event: {
      type: 'patch',
      content: [
        'diff --git a/backend/nidavellir/routers/health.py b/backend/nidavellir/routers/health.py',
        '--- a/backend/nidavellir/routers/health.py',
        '+++ b/backend/nidavellir/routers/health.py',
        '@@ -10,2 +10,3 @@',
        '+    "buildMode": "development",',
      ].join('\n'),
    },
  });
  await wsSend(page, {
    type: 'activity',
    event: { type: 'tool_start', id: 'verify-1', name: 'exec', args: 'cd backend && uv run pytest tests/test_health.py -q' },
  });
  await wsSend(page, {
    type: 'activity',
    event: { type: 'tool_end', id: 'verify-1', status: 'success', summary: '7 passed' },
  });
  await wsSend(page, { type: 'done' });

  await expect(page.getByText('Implemented the buildMode health field.')).toBeVisible();

  await page.getByRole('tab', { name: 'Summary' }).click();
  const sidebar = page.getByLabel('Right sidebar', { exact: true });
  await expect(sidebar.getByText('Changed 1 file and verified with 1 command.')).toBeVisible();
  await expect(sidebar.getByText('cd backend && uv run pytest tests/test_health.py -q')).toBeVisible();
  await expect(sidebar.getByText('7 passed')).toBeVisible();

  await page.getByRole('tab', { name: 'Review' }).click();
  await expect(sidebar.getByText('backend/nidavellir/routers/health.py')).toBeVisible();
  await sidebar.getByRole('button', { name: /Expand diff for backend\/nidavellir\/routers\/health.py/i }).click();
  await expect(sidebar.locator('code').filter({ hasText: 'buildMode' })).toBeVisible();

  await page.getByRole('tab', { name: 'Git' }).click();
  await expect(sidebar.getByText('main')).toBeVisible();
  await expect(sidebar.getByText('1 file changed')).toBeVisible();
});
