import type { Page } from '@playwright/test';

export async function installWsMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class MockWebSocket {
      static OPEN       = 1;
      static CONNECTING = 0;
      static CLOSING    = 2;
      static CLOSED     = 3;

      readyState = 0;
      url: string;

      onopen:    ((e: Event) => void) | null        = null;
      onclose:   ((e: CloseEvent) => void) | null   = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror:   ((e: Event) => void) | null        = null;

      sent: string[] = [];

      constructor(url: string) {
        this.url = url;
        (window as any).__mockWs = this;
        setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.onopen?.(new Event('open'));
        }, 0);
      }

      send(data: string) { this.sent.push(data); }
      close() { this.readyState = MockWebSocket.CLOSED; }

      simulateMessage(data: object) {
        this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
      }
      simulateClose() {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.(new CloseEvent('close'));
      }
      simulateError() {
        this.onerror?.(new Event('error'));
      }
    }

    (window as any).WebSocket = MockWebSocket;
  });
}

export async function wsSend(page: Page, data: object): Promise<void> {
  await page.evaluate((d) => {
    (window as any).__mockWs?.simulateMessage(d);
  }, data);
}

export async function wsClose(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__mockWs?.simulateClose();
  });
}
