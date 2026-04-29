import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContextPanel } from '../../components/chat/ContextPanel';
import { useAgentStore } from '../../store/agentStore';

describe('ContextPanel — Token Usage section', () => {
  beforeEach(() => {
    delete window.nidavellir;
    useAgentStore.setState({
      activeConversationId: 'conv-test',
      conversationId: 'conv-test',
      selectedModel: 'claude:claude-sonnet-4-6',
      workingSetFiles: [],
      refreshWorkingSetFiles: vi.fn().mockResolvedValue(undefined),
      removeWorkingSetFile: vi.fn().mockResolvedValue(undefined),
      addWorkingSetFiles: vi.fn().mockResolvedValue(true),
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/memory/quality/summary')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'healthy',
            active_memories: 0,
            injected_24h: 0,
            extraction_failures_24h: 0,
            low_confidence_stored: 0,
            never_used: 0,
            recent_alerts: [],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
        files: [{
          path: 'README.md',
          fileName: 'README.md',
          fileKind: 'text',
          sizeBytes: 100,
          estimatedTokens: 25,
          lineCount: 3,
        }],
        contextBefore: { currentTokens: 0, usableTokens: 100000, percentUsed: 0, state: 'ok' },
        contextAfter: { currentTokens: 25, usableTokens: 100000, percentUsed: 0.03, state: 'ok' },
        addedTextTokens: 25,
        projectedPercentUsed: 0.03,
        canAdd: true,
      }),
      });
    }));
  });

  it('renders without crashing', () => {
    expect(() => render(<ContextPanel onClose={() => {}} />)).not.toThrow();
  });

  it('shows Token Usage section header', () => {
    render(<ContextPanel onClose={() => {}} />);
    expect(screen.getAllByText(/^Token Usage$/i).length).toBeGreaterThan(0);
  });

  it('shows Files section header', () => {
    render(<ContextPanel onClose={() => {}} />);
    // "Files" appears in section header (uppercase) and file path names
    expect(screen.getAllByText(/Files/i).length).toBeGreaterThan(0);
  });

  it('calls onClose when ✕ is clicked', () => {
    const onClose = vi.fn();
    render(<ContextPanel onClose={onClose} />);
    // The header close button
    const closeBtn = screen.getAllByText('✕')[0];
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('toggles Files section when header clicked', () => {
    render(<ContextPanel onClose={() => {}} />);
    // The section header contains "FILES" (uppercased) — get the first exact match
    const fileHeaders = screen.getAllByText(/^files$/i);
    const fileHeader = fileHeaders[0].closest('div')!;
    fireEvent.click(fileHeader);
    // After collapse, "Add files" link should be gone
    expect(screen.queryByRole('button', { name: 'Add files' })).toBeNull();
  });

  it('shows Add files button when files section expanded', () => {
    render(<ContextPanel onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Add files' })).toBeTruthy();
  });

  it('removes a file when Remove from Conversation is clicked on file row', () => {
    const removeWorkingSetFile = vi.fn().mockResolvedValue(undefined);
    useAgentStore.setState({
      removeWorkingSetFile,
      workingSetFiles: [{
        id: 'file-1',
        conversationId: 'conv-test',
        fileName: 'README.md',
        originalPath: 'README.md',
        fileKind: 'text',
        sizeBytes: 100,
        estimatedTokens: 25,
        lineCount: 3,
        active: true,
        addedAt: new Date().toISOString(),
      }],
    });
    render(<ContextPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove from Conversation' }));
    expect(removeWorkingSetFile).toHaveBeenCalledWith('file-1');
  });

  it('shows Open Token Usage Dashboard button', () => {
    render(<ContextPanel onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /Open Token Usage Dashboard/i })).toBeTruthy();
  });

  it('Open Token Usage Dashboard button dispatches nid:navigate event', () => {
    render(<ContextPanel onClose={() => {}} />);
    const dispatched: string[] = [];
    window.addEventListener('nid:navigate', (e) => {
      dispatched.push((e as CustomEvent).detail);
    });
    fireEvent.click(screen.getByRole('button', { name: /Open Token Usage Dashboard/i }));
    expect(dispatched).toContain('tokens');
  });

  it('opens Add Files modal when files are selected', async () => {
    render(<ContextPanel onClose={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello'], 'README.md', { type: 'text/markdown' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Add Files' })).toBeTruthy());
  });

  it('uses the Electron file picker bridge so Windows file paths reach the backend', async () => {
    window.nidavellir = {
      pickWorkingSetFiles: vi.fn().mockResolvedValue([String.raw`C:\Users\colebienek\Downloads\pep.webp`]),
    };

    render(<ContextPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add files' }));

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Add Files' })).toBeTruthy());
    expect(window.nidavellir.pickWorkingSetFiles).toHaveBeenCalled();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls.some(([url, init]) => (
      url === 'http://localhost:7430/api/conversations/conv-test/files/preview'
        && JSON.parse(String(init.body)).paths[0] === String.raw`C:\Users\colebienek\Downloads\pep.webp`
    ))).toBe(true);
  });

  it('shows an error instead of calculating forever when file impact preview fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/memory/quality/summary')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'healthy',
            active_memories: 0,
            injected_24h: 0,
            extraction_failures_24h: 0,
            low_confidence_stored: 0,
            never_used: 0,
            recent_alerts: [],
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
    }));

    render(<ContextPanel onClose={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello'], 'README.md', { type: 'text/markdown' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('Could not calculate file impact. The files were not added.')).toBeTruthy());
    expect(screen.queryByText('Calculating impact...')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Files' })).toBeDisabled();
  });
});
