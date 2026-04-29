import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatScreen } from '../../screens/ChatScreen';
import { useAgentStore } from '../../store/agentStore';
import { _testResetSocket, _testSetSocket } from '../../lib/agentSocket';

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/skills')) return Response.json([
      { slug: 'strict-tdd-builder', name: 'Strict TDD Builder', enabled: true, showInSlash: true },
    ]);
    if (url.includes('/api/conversations')) return Response.json([]);
    if (url.includes('/api/memory/quality/summary')) {
      return Response.json({
        status: 'ok',
        active_memories: 0,
        injected_24h: 0,
        extraction_failures_24h: 0,
        dedup_rejections_24h: 0,
        low_confidence_stored: 0,
        never_used: 0,
        superseded: 0,
      });
    }
    if (url.includes('/api/memory/')) return Response.json([]);
    if (url.includes('/api/context/usage')) {
      return Response.json({
        model: 'claude-sonnet-4-6',
        provider: 'claude',
        currentTokens: 0,
        usableTokens: 100000,
        contextLimit: 120000,
        percentUsed: 0,
        state: 'ok',
        accuracy: 'estimated',
        lastUpdatedAt: new Date().toISOString(),
      });
    }
    return Response.json({});
  }));
}

describe('ChatScreen clipboard attachments', () => {
  beforeEach(() => {
    _testResetSocket();
    mockFetch();
    useAgentStore.setState({
      messages: [],
      conversations: [],
      activeConversationId: 'conv-clipboard',
      conversationId: 'conv-clipboard',
      selectedModel: 'claude:claude-sonnet-4-6',
      selectedProvider: 'claude',
      agentModels: [],
      agentModelsLoaded: true,
      isStreaming: false,
      workingSetFiles: [],
      contextUsage: null,
    });
  });

  it('adds a pasted clipboard screenshot as a pending image attachment', async () => {
    render(<ChatScreen />);
    const input = screen.getByTestId('chat-input');
    const screenshot = new File(['png'], '', { type: 'image/png' });

    fireEvent.paste(input, {
      clipboardData: {
        files: [screenshot],
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => screenshot }],
      },
    });

    expect(await screen.findByTestId('pending-attachment-clipboard-screenshot.png')).toBeTruthy();
    expect(screen.getByText('Image · vision attachment')).toBeTruthy();
  });

  it('does not intercept plain text paste', () => {
    render(<ChatScreen />);
    const input = screen.getByTestId('chat-input');

    fireEvent.paste(input, {
      clipboardData: {
        files: [],
        items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
      },
    });

    expect(screen.queryByTestId(/pending-attachment-/)).toBeNull();
  });

  it('prefills a slash skill invocation from the skill inventory event', () => {
    render(<ChatScreen />);
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;

    act(() => {
      window.dispatchEvent(new CustomEvent('nid:invoke-skill', { detail: { slug: 'strict-tdd-builder' } }));
    });

    expect(input.value).toBe('/skill strict-tdd-builder ');
  });

  it('lists opted-in skills as slash commands', async () => {
    render(<ChatScreen />);
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: '/strict' } });

    await waitFor(() => {
      expect(screen.getByText('/strict-tdd-builder')).toBeTruthy();
    });
    expect(screen.getByText('Invoke Strict TDD Builder')).toBeTruthy();
  });

  it('allows sending an invoked slash skill once task text is present', async () => {
    const sent: string[] = [];
    _testSetSocket({
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent.push(payload);
      },
    } as unknown as WebSocket);
    render(<ChatScreen />);
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;

    fireEvent.change(input, {
      target: {
        value: '/strict-tdd-builder Add a tiny backend health metadata field called buildMode',
      },
    });

    expect(screen.queryByText('/strict-tdd-builder')).toBeNull();
    const sendButton = screen.getByRole('button', { name: 'Send' });
    expect(sendButton).not.toBeDisabled();
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(sent.length).toBeGreaterThan(0);
    });
    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({
      type: 'message',
      content: '/strict-tdd-builder Add a tiny backend health metadata field called buildMode',
      conversation_id: 'conv-clipboard',
    });
  });
});
