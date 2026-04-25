import type { Page } from '@playwright/test';

export async function goToChat(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('nid:navigate', { detail: 'chat' }));
  });
  await page.waitForSelector('textarea[placeholder*="Message Nidavellir"]');
}

export async function standardSetup(
  page: Page,
  installWs: (p: Page) => Promise<void>,
  mockFn: (p: Page) => Promise<void>
): Promise<void> {
  await installWs(page);
  await mockFn(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(50);
}
