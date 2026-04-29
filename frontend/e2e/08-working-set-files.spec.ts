import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks';
import { installWsMock } from './fixtures/ws-mock';

type WorkingSetFile = {
  id: string;
  conversationId: string;
  fileName: string;
  originalPath: string;
  fileKind: 'text' | 'image' | 'unsupported';
  sizeBytes: number;
  estimatedTokens?: number;
  lineCount?: number;
  imageWidth?: number;
  imageHeight?: number;
  active: boolean;
  addedAt: string;
  warning?: string;
};

let files: WorkingSetFile[];
let contextUsageRequests: number;

function usage(tokens: number) {
  return {
    model: 'claude-sonnet-4-6',
    provider: 'claude',
    currentTokens: tokens,
    usableTokens: 100000,
    contextLimit: 120000,
    percentUsed: tokens / 1000,
    state: 'ok',
    accuracy: 'estimated',
    lastUpdatedAt: new Date().toISOString(),
  };
}

test.beforeEach(async ({ page }) => {
  files = [];
  contextUsageRequests = 0;

  await installWsMock(page);
  await mockApi(page);
  await page.route('**/api/conversations', (route) =>
    route.fulfill({
      json: [{
        id: 'conv-files',
        title: 'Files Conversation',
        createdAt: '2026-04-26T10:00:00Z',
        updatedAt: '2026-04-26T10:00:00Z',
        activeProvider: 'claude',
        activeModel: 'claude-sonnet-4-6',
        messageCount: 0,
        pinned: false,
        archived: false,
      }],
    })
  );
  await page.route('**/api/conversations/conv-files', (route) =>
    route.fulfill({
      json: {
        id: 'conv-files',
        title: 'Files Conversation',
        activeSessionId: 'sess-files',
        activeProvider: 'claude',
        activeModel: 'claude-sonnet-4-6',
        selectedFiles: [],
        messages: [],
      },
    })
  );
  await page.route('**/api/conversations/conv-files/files', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: files.filter((file) => file.active) });
      return;
    }
    const body = JSON.parse(route.request().postData() || '{}') as { paths: string[] };
    files = body.paths.map((path, index) => {
      const isImage = path.toLowerCase().endsWith('.png');
      return {
        id: `file-${index + 1}`,
        conversationId: 'conv-files',
        fileName: path.split(/[\\/]/).pop() || path,
        originalPath: path,
        fileKind: isImage ? 'image' : 'text',
        sizeBytes: isImage ? 2048 : 1200,
        estimatedTokens: isImage ? undefined : 3200,
        lineCount: isImage ? undefined : 214,
        imageWidth: isImage ? 1440 : undefined,
        imageHeight: isImage ? 900 : undefined,
        active: true,
        addedAt: new Date().toISOString(),
        warning: isImage ? 'stored, not sent by current model' : undefined,
      };
    });
    await route.fulfill({
      json: {
        added: files,
        skipped: [],
        contextBefore: usage(7000),
        contextAfter: usage(10200),
      },
    });
  });
  await page.route('**/api/conversations/conv-files/files/preview', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { paths: string[] };
    if (body.paths.some((path) => path.includes('preview-error'))) {
      await route.fulfill({ status: 500, json: { detail: 'preview_failed' } });
      return;
    }
    const blocked = body.paths.some((path) => path.includes('too-big'));
    await route.fulfill({
      json: {
        files: body.paths.map((path) => {
          const isImage = path.toLowerCase().endsWith('.png');
          return {
            path,
            fileName: path.split(/[\\/]/).pop() || path,
            fileKind: isImage ? 'image' : 'text',
            sizeBytes: isImage ? 2048 : 1200,
            estimatedTokens: isImage ? undefined : 3200,
            lineCount: isImage ? undefined : 214,
            imageWidth: isImage ? 1440 : undefined,
            imageHeight: isImage ? 900 : undefined,
            warning: isImage ? 'stored, not sent by current model' : undefined,
          };
        }),
        contextBefore: usage(7000),
        contextAfter: blocked ? { ...usage(97000), state: 'blocked', percentUsed: 97 } : usage(10200),
        addedTextTokens: blocked ? 90000 : 3200,
        projectedPercentUsed: blocked ? 97 : 10.2,
        canAdd: !blocked,
        blockingReason: blocked ? 'Adding these files would exceed the current model context window.' : undefined,
      },
    });
  });
  await page.route('**/api/conversations/conv-files/files/*', async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.fallback();
      return;
    }
    const id = route.request().url().split('/').pop();
    files = files.map((file) => file.id === id ? { ...file, active: false } : file);
    await route.fulfill({ json: { ok: true, contextAfter: usage(7000) } });
  });
  await page.route('**/api/context/usage?**', (route) => {
    contextUsageRequests += 1;
    return route.fulfill({ json: usage(files.length ? 10200 : 7000) });
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('conversation-row-conv-files').click();
});

test('Working Set label replaces user-facing Context panel label', async ({ page }) => {
  await expect(page.getByText('Working Set', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Context$/)).toHaveCount(0);
  await expect(page.getByText('Files', { exact: true })).toBeVisible();
  await expect(page.getByText('Token Usage', { exact: true })).toBeVisible();
});

test('Add Files picker opens modal, previews impact, and adds selected files', async ({ page }) => {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add files' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'README.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# README\nhello'),
  });

  await expect(page.getByRole('dialog', { name: 'Add Files' })).toBeVisible();
  await expect(page.getByText('README.md')).toBeVisible();
  await expect(page.getByText('Text · 214 lines · ~3.2k tokens')).toBeVisible();
  await expect(page.getByText('Current: 7%')).toBeVisible();
  await expect(page.getByText('After add: 10.2%')).toBeVisible();
  await expect(page.getByText('+3.2k tokens')).toBeVisible();

  const beforeRequests = contextUsageRequests;
  await page.getByRole('button', { name: 'Add Files', exact: true }).click();

  await expect(page.getByTestId('working-set-file-file-1')).toContainText('README.md');
  await expect(page.getByTestId('working-set-file-file-1')).toContainText('~3.2k tokens');
  expect(contextUsageRequests).toBeGreaterThan(beforeRequests);
});

test('Add button is disabled when context limit is exceeded', async ({ page }) => {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add files' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'too-big.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('too big'),
  });

  await expect(page.getByText('Adding these files would exceed the current model context window.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Files', exact: true })).toBeDisabled();
});

test('Preview failure shows an error instead of calculating forever', async ({ page }) => {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add files' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'preview-error.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('error'),
  });

  await expect(page.getByText('Could not calculate file impact. The files were not added.')).toBeVisible();
  await expect(page.getByText('Calculating impact...')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Files', exact: true })).toBeDisabled();
});

test('Remove file deletes it from working set and refreshes context usage', async ({ page }) => {
  files = [{
    id: 'file-1',
    conversationId: 'conv-files',
    fileName: 'README.md',
    originalPath: 'README.md',
    fileKind: 'text',
    sizeBytes: 1200,
    estimatedTokens: 3200,
    lineCount: 214,
    active: true,
    addedAt: new Date().toISOString(),
  }];
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('conversation-row-conv-files').click();

  const beforeRequests = contextUsageRequests;
  await page.getByRole('button', { name: 'Remove from Conversation' }).click();

  await expect(page.getByTestId('working-set-file-file-1')).toHaveCount(0);
  expect(contextUsageRequests).toBeGreaterThan(beforeRequests);
});

test('Images show as vision attachments with non-vision warning', async ({ page }) => {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add files' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'screenshot.png',
    mimeType: 'image/png',
    buffer: Buffer.from('png'),
  });

  await expect(page.getByText('Image · 1440x900 · stored, not sent by current model')).toBeVisible();
});
