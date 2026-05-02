import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatScreen } from '../../screens/ChatScreen';
import { useAgentStore } from '../../store/agentStore';

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
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
        model: 'gpt-5.5',
        provider: 'codex',
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

describe('ChatScreen Codex-style layout', () => {
  beforeEach(() => {
    mockFetch();
    useAgentStore.setState({
      messages: [],
      conversations: [
        {
          id: 'conv-1',
          title: 'UI Adjustments',
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          messageCount: 2,
          pinned: false,
          archived: false,
        },
      ],
      activeConversationId: 'conv-1',
      conversationId: 'conv-1',
      selectedModel: 'codex:gpt-5.5',
      selectedProvider: 'codex',
      agentModels: [],
      agentModelsLoaded: true,
      isStreaming: false,
      workingDirectory: '/mnt/c/Users/colebienek/projects/nidavellir',
      workingDirectoryDisplay: 'C:\\Users\\colebienek\\projects\\nidavellir',
      workingSetFiles: [],
      contextUsage: null,
    });
  });

  it('expands the input box as the user adds more lines', () => {
    render(<ChatScreen />);
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'one\ntwo\nthree\nfour' } });

    expect(input.style.height).toBe('96px');
  });

  it('can collapse and reopen the conversations drawer', () => {
    render(<ChatScreen />);

    expect(screen.getByText('UI Adjustments')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide conversations' }));

    expect(screen.queryByText('UI Adjustments')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show conversations' }));

    expect(screen.getByText('UI Adjustments')).toBeTruthy();
  });

  it('shows a compact cwd chip and removes the old top working pill', () => {
    render(<ChatScreen />);

    expect(screen.getByTestId('cwd-indicator').textContent).toContain('C:\\Users\\colebienek');
    expect(screen.queryByText('● Working')).toBeNull();
    expect(screen.getByRole('button', { name: 'Toggle working set' })).toBeTruthy();
  });

  it('opens audit bundle export options from the conversation menu', () => {
    render(<ChatScreen />);

    fireEvent.click(screen.getByTestId('conversation-menu-conv-1'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export Audit Bundle' }));

    expect(screen.getByRole('dialog', { name: 'Export audit bundle' })).toBeTruthy();
    expect(screen.getByLabelText(/Include command output/)).not.toBeChecked();
    expect(screen.getByLabelText(/Include memory snapshots/)).not.toBeChecked();
    expect(screen.getByLabelText(/Include instruction file contents/)).not.toBeChecked();
    expect(screen.getByLabelText(/Include skill instruction text/)).not.toBeChecked();

    fireEvent.click(screen.getByLabelText(/Include command output/));

    expect(screen.getByLabelText(/Include command output/)).toBeChecked();
  });
});
