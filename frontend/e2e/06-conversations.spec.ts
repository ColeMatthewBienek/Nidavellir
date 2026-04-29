import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks';
import { installWsMock, wsSend } from './fixtures/ws-mock';

const conversations = [
  {
    id: 'conv-existing',
    title: 'Lighthouse Story',
    createdAt: '2026-04-26T10:00:00Z',
    updatedAt: '2026-04-26T10:05:00Z',
    activeProvider: 'claude',
    activeModel: 'claude-sonnet-4-6',
    workingDirectory: '/mnt/c/Users/colebienek/projects/nidavellir',
    workingDirectoryDisplay: '/mnt/c/Users/colebienek/projects/nidavellir',
    messageCount: 2,
  },
];
let uploadedBlobRequests: Array<{ files: Array<{ fileName: string; contentBase64: string; mimeType?: string }>; source: string }>;
let workingSetFiles: Array<Record<string, unknown>>;
let workspacePath = '/mnt/c/Users/colebienek/projects/nidavellir';
let workspaceDisplay = '/mnt/c/Users/colebienek/projects/nidavellir';

async function dropFilesOnInput(page: import('@playwright/test').Page, files: Array<{ name: string; type: string; content: string }>) {
  await page.evaluate((items) => {
    const dropzone = document.querySelector('[data-testid="chat-input-dropzone"]');
    if (!dropzone) throw new Error('dropzone_missing');
    const dataTransfer = new DataTransfer();
    for (const item of items) {
      dataTransfer.items.add(new File([item.content], item.name, { type: item.type }));
    }
    dropzone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    dropzone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, files);
}

async function pasteImageOnInput(page: import('@playwright/test').Page, file: { type: string; content: string }) {
  await page.evaluate((item) => {
    const input = document.querySelector('[data-testid="chat-input"]');
    if (!input) throw new Error('chat_input_missing');
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([item.content], '', { type: item.type }));
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer }));
  }, file);
}

test.beforeEach(async ({ page }) => {
  uploadedBlobRequests = [];
  workingSetFiles = [];
  workspacePath = '/mnt/c/Users/colebienek/projects/nidavellir';
  workspaceDisplay = '/mnt/c/Users/colebienek/projects/nidavellir';
  await installWsMock(page);
  await page.addInitScript(() => {
    (window as any).__pickedDirectory = null;
    (window as any).__pickDirectoryCalls = 0;
    (window as any).nidavellir = {
      ...((window as any).nidavellir ?? {}),
      pickDirectory: async () => {
        (window as any).__pickDirectoryCalls += 1;
        return (window as any).__pickedDirectory;
      },
    };
  });
  await mockApi(page);
  await page.route('**/api/conversations', async (route) => {
    if (route.request().method() === 'POST') {
      conversations.unshift({
        id: 'conv-new',
        title: 'New Conversation',
        createdAt: '2026-04-26T11:00:00Z',
        updatedAt: '2026-04-26T11:00:00Z',
        activeProvider: 'claude',
        activeModel: 'claude-sonnet-4-6',
        messageCount: 0,
      });
      await route.fulfill({ json: { conversationId: 'conv-new', sessionId: 'sess-new', title: 'New Conversation' } });
      return;
    }
    await route.fulfill({ json: conversations });
  });
  await page.route('**/api/conversations/conv-existing', (route) =>
    route.fulfill({
      json: {
        id: 'conv-existing',
        title: 'Lighthouse Story',
        activeSessionId: 'sess-existing',
        activeProvider: 'claude',
        activeModel: 'claude-sonnet-4-6',
        workingDirectory: workspacePath,
        workingDirectoryDisplay: workspaceDisplay,
        selectedFiles: [],
        messages: [
          { id: 'm1', role: 'user', content: 'Write a 100 word happy story.' },
          { id: 'm2', role: 'agent', content: 'A lighthouse smiled over the bay.' },
        ],
      },
    })
  );
  await page.route('**/api/conversations/conv-existing/files', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: workingSetFiles });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/conversations/conv-existing/files/blob', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as {
      files: Array<{ fileName: string; contentBase64: string; mimeType?: string }>;
      source: string;
    };
    uploadedBlobRequests.push(body);
    const added = body.files
      .filter((file) => !file.fileName.endsWith('.zip'))
      .map((file, index) => {
        const image = file.fileName.endsWith('.png');
        return {
          id: `drop-${uploadedBlobRequests.length}-${index}`,
          conversationId: 'conv-existing',
          fileName: file.fileName,
          originalPath: file.fileName,
          fileKind: image ? 'image' : 'text',
          sizeBytes: 100,
          estimatedTokens: image ? undefined : 12,
          lineCount: image ? undefined : 2,
          imageWidth: image ? 1440 : undefined,
          imageHeight: image ? 900 : undefined,
          active: true,
          source: body.source,
          addedAt: new Date().toISOString(),
        };
      });
    workingSetFiles.push(...added);
    await route.fulfill({
      json: {
        added,
        skipped: body.files
          .filter((file) => file.fileName.endsWith('.zip'))
          .map((file) => ({ path: file.fileName, reason: 'unsupported_binary', message: 'Unsupported file type.' })),
        contextBefore: {
          currentTokens: 42,
          usableTokens: 100000,
          percentUsed: 0.04,
          state: 'ok',
        },
        contextAfter: {
          currentTokens: 54,
          usableTokens: 100000,
          percentUsed: 0.05,
          state: 'ok',
        },
      },
    });
  });
  await page.route('**/api/conversations/conv-existing/workspace', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { path: string };
    if (body.path.includes('missing')) {
      await route.fulfill({ status: 400, json: { detail: 'directory_not_found' } });
      return;
    }
    if (body.path.includes('busy')) {
      await route.fulfill({ status: 409, json: { detail: 'agent_running' } });
      return;
    }
    workspaceDisplay = body.path;
    workspacePath = body.path.startsWith('C:\\')
      ? body.path.replace(/^C:\\/, '/mnt/c/').replaceAll('\\', '/')
      : body.path;
    await route.fulfill({
      json: {
        workingDirectory: workspacePath,
        workingDirectoryDisplay: workspaceDisplay,
        writable: true,
        warning: null,
      },
    });
  });
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
        lastUpdatedAt: '2026-04-26T11:00:00Z',
      },
    })
  );
  await page.goto('/');
  await page.waitForLoadState('networkidle');
});

test('dragging files over chat input highlights drop zone', async ({ page }) => {
  await page.getByTestId('conversation-row-conv-existing').click();
  await page.evaluate(() => {
    const dropzone = document.querySelector('[data-testid="chat-input-dropzone"]');
    if (!dropzone) throw new Error('dropzone_missing');
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['hello'], 'README.md', { type: 'text/markdown' }));
    dropzone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
  });

  await expect(page.getByText('Drop files to add to conversation')).toBeVisible();
});

test('/cwd updates the active conversation workspace without sending to the agent', async ({ page }) => {
  await page.getByTestId('conversation-row-conv-existing').click();
  await expect(page.getByTestId('cwd-indicator')).toContainText('/mnt/c/Users/colebienek/projects/nidavellir');

  await page.locator('textarea[placeholder*="Message Nidavellir"]').fill('/cwd "C:\\Users\\colebienek\\OneDrive\\Documents\\New project"');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('Working directory changed to C:\\Users\\colebienek\\OneDrive\\Documents\\New project')).toBeVisible();
  await expect(page.getByTestId('cwd-indicator')).toContainText('C:\\Users\\colebienek\\OneDrive\\Documents\\New project');

  const sent = await page.evaluate(() => (window as any).__mockWs?.sent.map((raw: string) => JSON.parse(raw)) ?? []);
  expect(sent.some((payload: { content?: string }) => payload.content?.startsWith('/cwd'))).toBe(false);
});

test('/cwd with no argument opens a directory picker and updates workspace', async ({ page }) => {
  await page.getByTestId('conversation-row-conv-existing').click();
  await page.locator('textarea[placeholder*="Message Nidavellir"]').fill('/cw');
  await expect(page.getByText('Change Working Directory')).toBeVisible();

  await page.evaluate(() => {
    (window as any).__pickedDirectory = String.raw`C:\Users\colebienek\projects\picked`;
  });
  await page.locator('textarea[placeholder*="Message Nidavellir"]').fill('/cwd');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect.poll(() => page.evaluate(() => (window as any).__pickDirectoryCalls)).toBe(1);
  await expect(page.getByText(String.raw`Working directory changed to C:\Users\colebienek\projects\picked`)).toBeVisible();
  await expect(page.getByTestId('cwd-indicator')).toContainText(String.raw`C:\Users\colebienek\projects\picked`);
});

test('/cwd picker cancel leaves workspace unchanged and does not message the agent', async ({ page }) => {
  await page.getByTestId('conversation-row-conv-existing').click();
  await page.locator('textarea[placeholder*="Message Nidavellir"]').fill('/cwd');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect.poll(() => page.evaluate(() => (window as any).__pickDirectoryCalls)).toBe(1);
  await expect(page.getByTestId('cwd-indicator')).toContainText('/mnt/c/Users/colebienek/projects/nidavellir');
  const sent = await page.evaluate(() => (window as any).__mockWs?.sent.map((raw: string) => JSON.parse(raw)) ?? []);
  expect(sent.some((payload: { content?: string }) => payload.content?.startsWith('/cwd'))).toBe(false);
});

test('/cwd reports backend validation errors as system events', async ({ page }) => {
  await page.getByTestId('conversation-row-conv-existing').click();

  await page.locator('textarea[placeholder*="Message Nidavellir"]').fill('/cwd /missing/workspace');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Working directory was not changed: directory_not_found')).toBeVisible();

  await page.locator('textarea[placeholder*="Message Nidavellir"]').fill('/cwd /busy/workspace');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Working directory was not changed: agent_running')).toBeVisible();
});

test('dropping supported and unsupported files creates removable pending attachments', async ({ page }) => {
  await page.getByTestId('conversation-row-conv-existing').click();

  await dropFilesOnInput(page, [
    { name: 'README.md', type: 'text/markdown', content: '# hello\nworld' },
    { name: 'screenshot.png', type: 'image/png', content: 'pngdata' },
    { name: 'archive.zip', type: 'application/zip', content: 'zipdata' },
  ]);

  await expect(page.getByTestId('pending-attachment-README.md')).toContainText('Text');
  await expect(page.getByTestId('pending-attachment-README.md')).toContainText('tokens');
  await expect(page.getByTestId('pending-attachment-screenshot.png')).toContainText('Image');
  await expect(page.getByTestId('pending-attachment-archive.zip')).toContainText('Unsupported file type');

  await page.getByRole('button', { name: 'Remove README.md' }).click();
  await expect(page.getByTestId('pending-attachment-README.md')).toHaveCount(0);
});

test('sending dropped files uploads blobs before provider call and clears pending attachments', async ({ page }) => {
  await page.getByTestId('conversation-row-conv-existing').click();
  await dropFilesOnInput(page, [
    { name: 'README.md', type: 'text/markdown', content: '# hello\nworld' },
  ]);
  await page.locator('textarea[placeholder*="Message Nidavellir"]').fill('Summarize this.');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect.poll(() => uploadedBlobRequests.length).toBe(1);
  expect(uploadedBlobRequests[0].source).toBe('drag_drop');
  expect(uploadedBlobRequests[0].files[0].fileName).toBe('README.md');
  const sent = await page.evaluate(() => (window as any).__mockWs?.sent.map((raw: string) => JSON.parse(raw)) ?? []);
  expect(sent.at(-1)).toMatchObject({ type: 'message', content: 'Summarize this.', conversation_id: 'conv-existing' });
  await expect(page.getByTestId('pending-attachment-README.md')).toHaveCount(0);
});

test('sending dropped image with empty text is allowed', async ({ page }) => {
  await page.getByTestId('conversation-row-conv-existing').click();
  await dropFilesOnInput(page, [
    { name: 'screenshot.png', type: 'image/png', content: 'pngdata' },
  ]);
  await page.getByRole('button', { name: 'Send' }).click();

  await expect.poll(() => uploadedBlobRequests.length).toBe(1);
  expect(uploadedBlobRequests[0].files[0].fileName).toBe('screenshot.png');
  const sent = await page.evaluate(() => (window as any).__mockWs?.sent.map((raw: string) => JSON.parse(raw)) ?? []);
  expect(sent.at(-1)).toMatchObject({ type: 'message', content: '[Image attached]', conversation_id: 'conv-existing' });
});

test('pasting a clipboard screenshot creates an image attachment and uploads it before sending', async ({ page }) => {
  await page.getByTestId('conversation-row-conv-existing').click();
  await pasteImageOnInput(page, { type: 'image/png', content: 'pngdata' });

  await expect(page.getByTestId('pending-attachment-clipboard-screenshot.png')).toContainText('Image');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect.poll(() => uploadedBlobRequests.length).toBe(1);
  expect(uploadedBlobRequests[0].source).toBe('clipboard_paste');
  expect(uploadedBlobRequests[0].files[0].fileName).toBe('clipboard-screenshot.png');
  const sent = await page.evaluate(() => (window as any).__mockWs?.sent.map((raw: string) => JSON.parse(raw)) ?? []);
  expect(sent.at(-1)).toMatchObject({ type: 'message', content: '[Image attached]', conversation_id: 'conv-existing' });
});

test('conversation plus creates a durable conversation and clears chat', async ({ page }) => {
  await wsSend(page, { type: 'conversation_created', conversation_id: 'old-conv' });
  await wsSend(page, { type: 'chunk', content: 'Old visible response' });
  await wsSend(page, { type: 'done' });
  await expect(page.getByText('Old visible response')).toBeVisible();

  await page.getByTestId('new-conversation-button').click();

  await expect(page.getByTestId('conversation-row-conv-new')).toBeVisible();
  await expect(page.getByTestId('conversation-row-conv-new')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Start a conversation with the agent.')).toBeVisible();
  await expect(page.getByText('Old visible response')).not.toBeVisible();
  await expect(page.locator('textarea[placeholder*="Message Nidavellir"]')).toBeFocused();
});

test('selecting an existing conversation loads and highlights messages', async ({ page }) => {
  await expect(page.getByTestId('conversation-row-conv-existing')).toBeVisible();

  await page.getByTestId('conversation-row-conv-existing').click();

  await expect(page.getByTestId('conversation-row-conv-existing')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Write a 100 word happy story.')).toBeVisible();
  await expect(page.getByText('A lighthouse smiled over the bay.')).toBeVisible();

  await page.locator('textarea[placeholder*="Message Nidavellir"]').fill('Make it rhyme like a rap.');
  await page.getByRole('button', { name: 'Send' }).click();

  const lastPayload = await page.evaluate(() => {
    const sent = (window as any).__mockWs?.sent ?? [];
    return JSON.parse(sent[sent.length - 1]);
  });
  expect(lastPayload).toMatchObject({
    type: 'message',
    content: 'Make it rhyme like a rap.',
    conversation_id: 'conv-existing',
  });
});

test('streaming agent response exposes expandable activity feed', async ({ page }) => {
  await wsSend(page, {
    type: 'activity',
    event: { type: 'tool_start', id: 'tool-1', name: 'Bash', args: 'ls -la', raw: 'tool' },
  });

  await expect(page.getByLabel('Agent is working')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand agent activity' })).toBeVisible();

  await page.getByRole('button', { name: 'Expand agent activity' }).click();

  await expect(page.getByRole('log', { name: 'Agent activity' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse agent activity' })).toBeVisible();
  await expect(page.getByText('Tool')).toBeVisible();
  await expect(page.getByText('Bash')).toBeVisible();
  await expect(page.getByText('ls -la')).toBeVisible();
});

test('send immediately shows working state and stop controls cancel the agent', async ({ page }) => {
  await page.getByTestId('conversation-row-conv-existing').click();
  await page.locator('textarea[placeholder*="Message Nidavellir"]').fill('Do something slow.');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByLabel('Agent is working')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop agent' })).toBeVisible();

  await page.getByRole('button', { name: 'Stop agent' }).click();
  let lastPayload = await page.evaluate(() => {
    const sent = (window as any).__mockWs?.sent ?? [];
    return JSON.parse(sent[sent.length - 1]);
  });
  expect(lastPayload).toMatchObject({ type: 'cancel' });

  await page.locator('textarea[placeholder*="Message Nidavellir"]').fill('Do something slow again.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.keyboard.press('Escape');
  lastPayload = await page.evaluate(() => {
    const sent = (window as any).__mockWs?.sent ?? [];
    return JSON.parse(sent[sent.length - 1]);
  });
  expect(lastPayload).toMatchObject({ type: 'cancel' });
});
