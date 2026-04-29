import { afterEach, beforeEach, expect, it, vi } from 'vitest';

class MockSocket {
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }
}

class MockWebSocket {
  static OPEN = 1;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('WebSocket', MockWebSocket);
  Object.defineProperty(window, 'WebSocket', {
    value: MockWebSocket,
    configurable: true,
  });
});

afterEach(async () => {
  const { _testResetSocket } = await import('../../lib/agentSocket');
  _testResetSocket();
  vi.unstubAllGlobals();
});

it('sends canonical continue_with_prior_context decision with parent conversation id', async () => {
  const { _testSetSocket, sendSessionSwitch } = await import('../../lib/agentSocket');
  const ws = new MockSocket();
  _testSetSocket(ws as unknown as WebSocket);

  sendSessionSwitch('codex', 'gpt-5.4', 'continue_with_prior_context', 'parent-conv-1');

  expect(ws.sent).toHaveLength(1);
  const payload = JSON.parse(ws.sent[0]);
  expect(payload).toMatchObject({
    type: 'session_switch',
    provider_id: 'codex',
    model_id: 'gpt-5.4',
    mode: 'continue_with_prior_context',
    old_conversation_id: 'parent-conv-1',
  });
});

it('sends canonical start_clean decision with parent conversation id', async () => {
  const { _testSetSocket, sendSessionSwitch } = await import('../../lib/agentSocket');
  const ws = new MockSocket();
  _testSetSocket(ws as unknown as WebSocket);

  sendSessionSwitch('claude', 'claude-opus-4-5', 'start_clean', 'parent-conv-2');

  const payload = JSON.parse(ws.sent[0]);
  expect(payload.mode).toBe('start_clean');
  expect(payload.old_conversation_id).toBe('parent-conv-2');
});
