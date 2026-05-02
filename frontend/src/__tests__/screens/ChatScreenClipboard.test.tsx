import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatScreen } from '../../screens/ChatScreen';
import { useAgentStore } from '../../store/agentStore';
import { _testResetSocket, _testSetSocket } from '../../lib/agentSocket';

let slashSkillsResponse = [
  { slug: 'strict-tdd-builder', name: 'Strict TDD Builder', enabled: true, showInSlash: true },
];

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/skills')) return Response.json(slashSkillsResponse);
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
    slashSkillsResponse = [
      { slug: 'strict-tdd-builder', name: 'Strict TDD Builder', enabled: true, showInSlash: true },
    ];
    mockFetch();
    useAgentStore.setState({
      messages: [],
      conversations: [],
      activeConversationId: 'conv-clipboard',
      conversationId: 'conv-clipboard',
      selectedModel: 'claude:claude-sonnet-4-6',
      selectedProvider: 'claude',
      providers: [{
        id: 'claude',
        display_name: 'Claude Code',
        description: '',
        available: true,
        roles: ['chat'],
        supports_session_resume: true,
        supports_persistent_context: true,
        supports_multiline_input: true,
        supports_file_context: true,
        supports_image_input: true,
        supports_live_steering: false,
        supports_queued_steering: true,
        supports_redirect_steering: true,
        steering_label: 'Queue note',
        supports_interrupt: true,
        streams_incrementally: true,
        emits_tool_use_blocks: true,
        output_format: 'ansi_rich',
        supports_bash_execution: true,
        supports_file_write: true,
        supports_worktree_isolation: true,
        cost_tier: 'subscription',
        requires_network: true,
        latency_tier: 'medium',
        supports_parallel_slots: true,
        max_concurrent_slots: null,
      }],
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

  it('reloads slash skills after the skill inventory changes', async () => {
    render(<ChatScreen />);
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('http://localhost:7430/api/skills'));
    slashSkillsResponse = [
      { slug: 'review-helper-edited', name: 'Review Helper Edited', enabled: true, showInSlash: true },
    ];

    act(() => {
      window.dispatchEvent(new CustomEvent('nid:skills-changed'));
    });

    fireEvent.change(input, { target: { value: '/review' } });

    expect(await screen.findByText('/review-helper-edited')).toBeTruthy();
    expect(screen.getByText('Invoke Review Helper Edited')).toBeTruthy();
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

  it('sends the message when Enter is pressed', async () => {
    const sent: string[] = [];
    _testSetSocket({
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent.push(payload);
      },
    } as unknown as WebSocket);
    render(<ChatScreen />);
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'Run the focused tests.' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({
      type: 'message',
      content: 'Run the focused tests.',
      conversation_id: 'conv-clipboard',
    });
    expect(input.value).toBe('');
  });

  it('keeps Shift+Enter available for multiline input', async () => {
    const sent: string[] = [];
    _testSetSocket({
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent.push(payload);
      },
    } as unknown as WebSocket);
    render(<ChatScreen />);
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'Line one' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(sent).toEqual([]);
    expect(input.value).toBe('Line one');
  });

  it('allows Enter to send slash-like text when no slash menu command matches', async () => {
    const sent: string[] = [];
    _testSetSocket({
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent.push(payload);
      },
    } as unknown as WebSocket);
    render(<ChatScreen />);
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: '/not-a-command' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({
      type: 'message',
      content: '/not-a-command',
      conversation_id: 'conv-clipboard',
    });
  });

  it('sends composer text as steering while an agent turn is running', async () => {
    const sent: string[] = [];
    _testSetSocket({
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent.push(payload);
      },
    } as unknown as WebSocket);
    useAgentStore.getState().addMessage('agent', '');
    useAgentStore.setState({ isStreaming: true });

    render(<ChatScreen />);
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'Also make the Git tab a tree view.' } });
    const steerButton = screen.getByRole('button', { name: 'Queue note' });
    expect(steerButton).not.toBeDisabled();
    fireEvent.click(steerButton);

    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({
      type: 'steer',
      content: 'Also make the Git tab a tree view.',
      conversation_id: 'conv-clipboard',
    });
    expect(input.value).toBe('');
    expect(useAgentStore.getState().messages.at(-1)?.events).toContainEqual({
      type: 'steering_signal',
      content: 'Also make the Git tab a tree view.',
    });
  });

  it('treats slash-prefixed text as steering while an agent turn is running', async () => {
    const sent: string[] = [];
    _testSetSocket({
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent.push(payload);
      },
    } as unknown as WebSocket);
    useAgentStore.getState().addMessage('agent', '');
    useAgentStore.setState({ isStreaming: true });

    render(<ChatScreen />);
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: '/strict-tdd-builder keep the failing test first' } });
    expect(screen.queryByText('COMMANDS')).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({
      type: 'steer',
      content: '/strict-tdd-builder keep the failing test first',
    });
  });

  it('labels live steering distinctly when the selected provider supports it', async () => {
    useAgentStore.setState({
      providers: [{
        ...useAgentStore.getState().providers[0],
        supports_live_steering: true,
        supports_queued_steering: false,
        supports_redirect_steering: false,
        steering_label: 'Steer',
      }],
    });
    useAgentStore.getState().addMessage('agent', '');
    useAgentStore.setState({ isStreaming: true });

    render(<ChatScreen />);

    expect(screen.getByRole('button', { name: 'Steer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Redirect' })).toBeNull();
    expect(screen.getByText('live steering')).toBeTruthy();
  });

  it('shows a Codex-style review changes strip for the latest build report', async () => {
    useAgentStore.setState({
      messages: [{
        id: 'agent-report',
        role: 'agent',
        content: 'Implemented the focused change.',
        timestamp: new Date('2026-04-29T10:00:00Z'),
        completedAt: new Date('2026-04-29T10:01:00Z'),
        streaming: false,
        rawChunks: [],
        events: [{
          type: 'diff',
          content: [
            'diff --git a/frontend/src/screens/ChatScreen.tsx b/frontend/src/screens/ChatScreen.tsx',
            '--- a/frontend/src/screens/ChatScreen.tsx',
            '+++ b/frontend/src/screens/ChatScreen.tsx',
            '@@ -1,1 +1,2 @@',
            ' existing',
            '+added',
          ].join('\n'),
        }],
      }],
    });

    render(<ChatScreen />);

    const strip = screen.getByTestId('review-changes-strip');
    expect(strip.textContent).toContain('1 file changed');
    expect(strip.textContent).toContain('+1');
    const reviewButton = screen.getByRole('button', { name: /Review changes/i });
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Review' }).getAttribute('aria-selected')).toBe('true');
    });
  });

  it('can redirect a one-shot provider by cancelling and queuing the steering note', async () => {
    const sent: string[] = [];
    _testSetSocket({
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent.push(payload);
      },
    } as unknown as WebSocket);
    useAgentStore.getState().addMessage('agent', '');
    useAgentStore.setState({ isStreaming: true });

    render(<ChatScreen />);
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'Stop and use the tree-view approach instead.' } });
    const redirectButton = screen.getByRole('button', { name: 'Redirect' });
    expect(redirectButton).not.toBeDisabled();
    fireEvent.click(redirectButton);

    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({
      type: 'redirect',
      content: 'Stop and use the tree-view approach instead.',
      conversation_id: 'conv-clipboard',
    });
    expect(input.value).toBe('');
    expect(useAgentStore.getState().isStreaming).toBe(false);
  });
});
