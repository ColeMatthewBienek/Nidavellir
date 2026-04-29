import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks';
import { installWsMock } from './fixtures/ws-mock';

type Conversation = {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  activeProvider: string;
  activeModel: string;
  messageCount: number;
};

let conversations: Conversation[];

function sortConversations(items: Conversation[]) {
  return [...items]
    .filter((c) => !c.archived)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

test.beforeEach(async ({ page }) => {
  conversations = [
    {
      id: 'conv-a',
      title: 'Alpha Conversation',
      pinned: false,
      archived: false,
      createdAt: '2026-04-26T10:00:00Z',
      updatedAt: '2026-04-26T10:00:00Z',
      activeProvider: 'claude',
      activeModel: 'claude-sonnet-4-6',
      messageCount: 1,
    },
    {
      id: 'conv-b',
      title: 'Beta Conversation',
      pinned: false,
      archived: false,
      createdAt: '2026-04-26T11:00:00Z',
      updatedAt: '2026-04-26T11:00:00Z',
      activeProvider: 'claude',
      activeModel: 'claude-sonnet-4-6',
      messageCount: 1,
    },
  ];

  await installWsMock(page);
  await mockApi(page);
  await page.route('**/api/conversations', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: sortConversations(conversations) });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/conversations/*/pin', async (route) => {
    const id = route.request().url().match(/conversations\/([^/]+)\/pin/)?.[1] ?? '';
    const body = JSON.parse(route.request().postData() || '{}') as { pinned: boolean };
    const item = conversations.find((c) => c.id === id);
    if (!item) {
      await route.fulfill({ status: 404, json: { detail: 'conversation_not_found' } });
      return;
    }
    item.pinned = body.pinned;
    item.updatedAt = new Date().toISOString();
    await route.fulfill({ json: item });
  });
  await page.route('**/api/conversations/*/archive', async (route) => {
    const id = route.request().url().match(/conversations\/([^/]+)\/archive/)?.[1] ?? '';
    const item = conversations.find((c) => c.id === id);
    if (!item) {
      await route.fulfill({ status: 404, json: { detail: 'conversation_not_found' } });
      return;
    }
    item.archived = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/conversations/*', async (route) => {
    const id = route.request().url().match(/conversations\/([^/?]+)/)?.[1] ?? '';
    const item = conversations.find((c) => c.id === id);
    if (!item) {
      await route.fulfill({ status: 404, json: { detail: 'conversation_not_found' } });
      return;
    }
    if (route.request().method() === 'PATCH') {
      const body = JSON.parse(route.request().postData() || '{}') as { title: string };
      item.title = body.title;
      item.updatedAt = new Date().toISOString();
      await route.fulfill({ json: item });
      return;
    }
    await route.fulfill({
      json: {
        id: item.id,
        title: item.title,
        activeSessionId: `${item.id}-session`,
        activeProvider: item.activeProvider,
        activeModel: item.activeModel,
        selectedFiles: [],
        messages: [{ id: `${item.id}-m1`, role: 'user', content: `${item.title} message` }],
      },
    });
  });
  await page.route('**/api/context/usage?**', (route) =>
    route.fulfill({
      json: {
        model: 'claude-sonnet-4-6',
        provider: 'claude',
        currentTokens: 4,
        usableTokens: 100000,
        contextLimit: 120000,
        percentUsed: 0.01,
        state: 'ok',
        accuracy: 'estimated',
        lastUpdatedAt: new Date().toISOString(),
      },
    })
  );
  await page.goto('/');
  await page.waitForLoadState('networkidle');
});

test('uses Conversation terminology and row menu labels', async ({ page }) => {
  await expect(page.getByText('Conversations')).toBeVisible();
  await expect(page.getByText(/thread/i)).toHaveCount(0);

  await page.getByTestId('conversation-menu-conv-a').click();

  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Pin Conversation' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete Conversation' })).toBeVisible();
});

test('renames a conversation inline and rejects empty rename', async ({ page }) => {
  await page.getByTestId('conversation-menu-conv-a').click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();

  const input = page.getByPlaceholder('Conversation name');
  await input.fill('Renamed Conversation');
  await input.press('Enter');
  await expect(page.getByTestId('conversation-row-conv-a')).toContainText('Renamed Conversation');

  await page.getByTestId('conversation-menu-conv-a').click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByPlaceholder('Conversation name').fill('   ');
  await page.getByPlaceholder('Conversation name').press('Enter');
  await expect(page.getByTestId('conversation-row-conv-a')).toContainText('Renamed Conversation');
});

test('pin and unpin move conversation between Pinned and Recent sections', async ({ page }) => {
  await expect(page.getByText('Pinned')).toHaveCount(0);
  await page.getByTestId('conversation-menu-conv-a').click();
  await page.getByRole('menuitem', { name: 'Pin Conversation' }).click();

  await expect(page.getByText('Pinned')).toBeVisible();
  await expect(page.getByText('Recent')).toBeVisible();
  await expect(page.getByTestId('conversation-row-conv-a')).toContainText('●');

  await page.getByTestId('conversation-menu-conv-a').click();
  await page.getByRole('menuitem', { name: 'Unpin Conversation' }).click();
  await expect(page.getByText('Pinned')).toHaveCount(0);
  await expect(page.getByTestId('conversation-row-conv-a')).not.toContainText('●');
});

test('delete requires confirmation and active delete selects fallback conversation', async ({ page }) => {
  await page.getByTestId('conversation-row-conv-a').click();
  await expect(page.getByTestId('conversation-row-conv-a')).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('conversation-menu-conv-a').click();
  await page.getByRole('menuitem', { name: 'Delete Conversation' }).click();

  await expect(page.getByText('Delete this conversation?')).toBeVisible();
  await expect(page.getByText('This will remove it from your conversation list. This cannot be undone in the MVP.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('conversation-row-conv-a')).toBeVisible();

  await page.getByTestId('conversation-menu-conv-a').click();
  await page.getByRole('menuitem', { name: 'Delete Conversation' }).click();
  await page.getByRole('button', { name: 'Delete Conversation' }).click();

  await expect(page.getByTestId('conversation-row-conv-a')).toHaveCount(0);
  await expect(page.getByTestId('conversation-row-conv-b')).toHaveAttribute('aria-selected', 'true');
});
