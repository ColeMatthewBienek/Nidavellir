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
      if (String(url).includes('/api/git/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            isRepo: true,
            branch: 'main',
            dirtyCount: 2,
            files: [
              { path: 'frontend/src/App.tsx', status: 'M' },
              { path: 'backend/nidavellir/main.py', status: '??' },
            ],
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

  it('renders Codex-style sidebar tabs while preserving Working Set as the active tab', () => {
    render(<ContextPanel onClose={() => {}} />);

    expect(screen.getByRole('tab', { name: 'Working Set' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Summary' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Review' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Git' })).toBeTruthy();
  });

  it('shows Summary and Review placeholders without losing Working Set state', () => {
    render(<ContextPanel onClose={() => {}} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }));
    expect(screen.getByText('Last Turn Summary')).toBeTruthy();
    expect(screen.queryByText(/part of the Codex-style sidebar rollout/i)).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(screen.getByText('Changed Files')).toBeTruthy();
    expect(screen.queryByText(/part of the Codex-style sidebar rollout/i)).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Working Set' }));
    expect(screen.getByRole('button', { name: 'Add files' })).toBeTruthy();
  });

  it('shows live Summary progress while a build turn is still running', () => {
    useAgentStore.setState({
      messages: [{
        id: 'agent-build-live',
        role: 'agent',
        content: '',
        timestamp: new Date('2026-04-28T20:00:00.000Z'),
        streaming: true,
        rawChunks: [],
        events: [
          { type: 'progress', content: 'I’m checking the health route and tests.' },
          { type: 'tool_start', id: 'read-1', name: 'exec', args: "sed -n '1,120p' backend/nidavellir/routers/health.py" },
          { type: 'tool_end', id: 'read-1', status: 'success', summary: 'read ok' },
        ],
      }],
    });

    render(<ContextPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }));

    expect(screen.getByText('Progress')).toBeTruthy();
    expect(screen.getByText('I’m checking the health route and tests.')).toBeTruthy();
    expect(screen.getByText('Explored 1 file')).toBeTruthy();
    expect(screen.getByText('Read health.py')).toBeTruthy();
  });

  it('shows the latest build completion report in the Summary tab', () => {
    useAgentStore.setState({
      messages: [{
        id: 'agent-build-1',
        role: 'agent',
        content: 'Implemented the buildMode health field.',
        timestamp: new Date('2026-04-28T20:00:00.000Z'),
        completedAt: new Date('2026-04-28T20:01:34.000Z'),
        streaming: false,
        rawChunks: [],
        events: [
          { type: 'patch', content: [
            'diff --git a/backend/nidavellir/routers/health.py b/backend/nidavellir/routers/health.py',
            '--- a/backend/nidavellir/routers/health.py',
            '+++ b/backend/nidavellir/routers/health.py',
            '@@ -1,2 +1,3 @@',
            '+    "buildMode": "development",',
          ].join('\n') },
          { type: 'tool_start', id: 'verify-1', name: 'exec', args: 'cd backend && uv run pytest tests/test_health.py -q' },
          { type: 'tool_end', id: 'verify-1', status: 'success', summary: '7 passed' },
        ],
      }],
    });

    render(<ContextPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }));

    expect(screen.getByText('Changed 1 file and verified with 1 command.')).toBeTruthy();
    expect(screen.getByText('Worked for 1m 34s')).toBeTruthy();
    expect(screen.getByText('cd backend && uv run pytest tests/test_health.py -q')).toBeTruthy();
    expect(screen.getByText('7 passed')).toBeTruthy();
  });

  it('shows changed files and expandable diffs in the Review tab', () => {
    useAgentStore.setState({
      messages: [{
        id: 'agent-build-1',
        role: 'agent',
        content: 'Implemented the buildMode health field.',
        timestamp: new Date('2026-04-28T20:00:00.000Z'),
        completedAt: new Date('2026-04-28T20:01:34.000Z'),
        streaming: false,
        rawChunks: [],
        events: [
          { type: 'patch', content: [
            'diff --git a/backend/nidavellir/routers/health.py b/backend/nidavellir/routers/health.py',
            '--- a/backend/nidavellir/routers/health.py',
            '+++ b/backend/nidavellir/routers/health.py',
            '@@ -1,2 +1,3 @@',
            '-    "status": "ok",',
            '+    "status": "ok",',
            '+    "buildMode": "development",',
          ].join('\n') },
        ],
      }],
    });

    render(<ContextPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));

    expect(screen.getByText('1 file changed')).toBeTruthy();
    expect(screen.getByText('backend/nidavellir/routers/health.py')).toBeTruthy();
    expect(screen.getAllByText('+2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-1').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Expand diff for backend\/nidavellir\/routers\/health.py/i }));
    expect(screen.getByText((content) => content.includes('"buildMode": "development"'))).toBeTruthy();
  });

  it('opens the Review tab and expands a changed file when a code ref is activated', async () => {
    useAgentStore.setState({
      messages: [{
        id: 'agent-build-1',
        role: 'agent',
        content: 'Implemented the buildMode health field.',
        timestamp: new Date('2026-04-28T20:00:00.000Z'),
        completedAt: new Date('2026-04-28T20:01:34.000Z'),
        streaming: false,
        rawChunks: [],
        events: [
          { type: 'patch', content: [
            'diff --git a/backend/nidavellir/routers/health.py b/backend/nidavellir/routers/health.py',
            '--- a/backend/nidavellir/routers/health.py',
            '+++ b/backend/nidavellir/routers/health.py',
            '@@ -1,2 +1,3 @@',
            '+    "buildMode": "development",',
          ].join('\n') },
        ],
      }],
    });

    render(<ContextPanel onClose={() => {}} />);

    window.dispatchEvent(new CustomEvent('nid:code-ref-open', {
      detail: { kind: 'code', path: 'backend/nidavellir/routers/health.py', startLine: 12, endLine: 14, label: 'health route' },
    }));

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Review' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByText('backend/nidavellir/routers/health.py')).toBeTruthy();
    await waitFor(() => expect(screen.getByText((content) => content.includes('"buildMode": "development"'))).toBeTruthy());
  });

  it('opens a review file in the editor through the existing code-ref bridge', async () => {
    const openCodeRef = vi.fn().mockResolvedValue(undefined);
    window.nidavellir = {
      openCodeRef,
      pickWorkingSetFiles: vi.fn().mockResolvedValue([]),
    };
    useAgentStore.setState({
      messages: [{
        id: 'agent-build-1',
        role: 'agent',
        content: 'Implemented the buildMode health field.',
        timestamp: new Date('2026-04-28T20:00:00.000Z'),
        completedAt: new Date('2026-04-28T20:01:34.000Z'),
        streaming: false,
        rawChunks: [],
        events: [
          { type: 'patch', content: [
            'diff --git a/backend/nidavellir/routers/health.py b/backend/nidavellir/routers/health.py',
            '--- a/backend/nidavellir/routers/health.py',
            '+++ b/backend/nidavellir/routers/health.py',
            '@@ -1,2 +1,3 @@',
            '+    "buildMode": "development",',
          ].join('\n') },
        ],
      }],
    });

    render(<ContextPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: /Open backend\/nidavellir\/routers\/health.py in editor/i }));

    await waitFor(() => expect(openCodeRef).toHaveBeenCalledWith(
      'backend/nidavellir/routers/health.py',
      undefined,
      undefined,
    ));
  });

  it('renders review diffs with hunk-aware old and new line numbers', () => {
    useAgentStore.setState({
      messages: [{
        id: 'agent-build-1',
        role: 'agent',
        content: 'Implemented the buildMode health field.',
        timestamp: new Date('2026-04-28T20:00:00.000Z'),
        completedAt: new Date('2026-04-28T20:01:34.000Z'),
        streaming: false,
        rawChunks: [],
        events: [
          { type: 'patch', content: [
            'diff --git a/backend/nidavellir/routers/health.py b/backend/nidavellir/routers/health.py',
            '--- a/backend/nidavellir/routers/health.py',
            '+++ b/backend/nidavellir/routers/health.py',
            '@@ -10,2 +10,3 @@',
            '-    "status": "ok",',
            '+    "status": "ok",',
            '+    "buildMode": "development",',
          ].join('\n') },
        ],
      }],
    });

    render(<ContextPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: /Expand diff for backend\/nidavellir\/routers\/health.py/i }));

    expect(screen.getByText('@@ -10,2 +10,3 @@')).toBeTruthy();
    expect(screen.getByLabelText('Old line 10')).toBeTruthy();
    expect(screen.getByLabelText('New line 10')).toBeTruthy();
    expect(screen.getByLabelText('New line 11')).toBeTruthy();
  });

  it('highlights a selected review line range and passes it to the editor bridge', async () => {
    const openCodeRef = vi.fn().mockResolvedValue(undefined);
    window.nidavellir = {
      openCodeRef,
      pickWorkingSetFiles: vi.fn().mockResolvedValue([]),
    };
    useAgentStore.setState({
      messages: [{
        id: 'agent-build-1',
        role: 'agent',
        content: 'Implemented the buildMode health field.',
        timestamp: new Date('2026-04-28T20:00:00.000Z'),
        completedAt: new Date('2026-04-28T20:01:34.000Z'),
        streaming: false,
        rawChunks: [],
        events: [
          { type: 'patch', content: [
            'diff --git a/backend/nidavellir/routers/health.py b/backend/nidavellir/routers/health.py',
            '--- a/backend/nidavellir/routers/health.py',
            '+++ b/backend/nidavellir/routers/health.py',
            '@@ -10,2 +10,3 @@',
            '+    "status": "ok",',
            '+    "buildMode": "development",',
          ].join('\n') },
        ],
      }],
    });

    render(<ContextPanel onClose={() => {}} />);

    window.dispatchEvent(new CustomEvent('nid:code-ref-open', {
      detail: { kind: 'code', path: 'backend/nidavellir/routers/health.py', startLine: 11, endLine: 11, label: 'buildMode line' },
    }));

    const selectedLine = await screen.findByLabelText('New line 11');
    expect(selectedLine.parentElement).toHaveAttribute('aria-current', 'location');

    fireEvent.click(screen.getByRole('button', { name: /Open backend\/nidavellir\/routers\/health.py in editor/i }));
    await waitFor(() => expect(openCodeRef).toHaveBeenCalledWith('backend/nidavellir/routers/health.py', 11, 11));
  });

  it('lets the user add a local comment on a review line', async () => {
    useAgentStore.setState({
      messages: [{
        id: 'agent-build-1',
        role: 'agent',
        content: 'Implemented the buildMode health field.',
        timestamp: new Date('2026-04-28T20:00:00.000Z'),
        completedAt: new Date('2026-04-28T20:01:34.000Z'),
        streaming: false,
        rawChunks: [],
        events: [
          { type: 'patch', content: [
            'diff --git a/backend/nidavellir/routers/health.py b/backend/nidavellir/routers/health.py',
            '--- a/backend/nidavellir/routers/health.py',
            '+++ b/backend/nidavellir/routers/health.py',
            '@@ -10,2 +10,3 @@',
            '+    "buildMode": "development",',
          ].join('\n') },
        ],
      }],
    });

    render(<ContextPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: /Expand diff for backend\/nidavellir\/routers\/health.py/i }));
    fireEvent.click(screen.getByRole('button', { name: /Comment on backend\/nidavellir\/routers\/health.py line 10/i }));

    expect(screen.getByText('Local comment')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Request change'), { target: { value: 'Please cover env override.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(screen.getByText('Please cover env override.')).toBeTruthy());
  });

  it('shows read-only git branch and dirty files in the Git tab', async () => {
    useAgentStore.setState({
      workingDirectory: '/mnt/c/Users/colebienek/projects/nidavellir',
      workingDirectoryDisplay: '/mnt/c/Users/colebienek/projects/nidavellir',
    });

    render(<ContextPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Git' }));

    await waitFor(() => expect(screen.getByText('main')).toBeTruthy());
    expect(screen.getByText('2 files changed')).toBeTruthy();
    expect(screen.getByText('App.tsx')).toBeTruthy();
    expect(screen.getByText('main.py')).toBeTruthy();
  });

  it('renders Git changed files as a filterable tree', async () => {
    useAgentStore.setState({
      workingDirectory: '/mnt/c/Users/colebienek/projects/nidavellir',
      workingDirectoryDisplay: '/mnt/c/Users/colebienek/projects/nidavellir',
    });

    render(<ContextPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Git' }));

    await waitFor(() => expect(screen.getByText('Changed files')).toBeTruthy());
    expect(screen.getByPlaceholderText('Filter files...')).toBeTruthy();
    expect(screen.getByText('frontend')).toBeTruthy();
    expect(screen.getByText('src')).toBeTruthy();
    expect(screen.getByText('backend')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Review frontend\/src\/App.tsx/i })).toBeTruthy();
  });

  it('opens a Git changed file in Review when the file has a review diff', async () => {
    useAgentStore.setState({
      workingDirectory: '/mnt/c/Users/colebienek/projects/nidavellir',
      workingDirectoryDisplay: '/mnt/c/Users/colebienek/projects/nidavellir',
      messages: [{
        id: 'agent-build-1',
        role: 'agent',
        content: 'Implemented the buildMode health field.',
        timestamp: new Date('2026-04-28T20:00:00.000Z'),
        completedAt: new Date('2026-04-28T20:01:34.000Z'),
        streaming: false,
        rawChunks: [],
        events: [
          { type: 'patch', content: [
            'diff --git a/backend/nidavellir/main.py b/backend/nidavellir/main.py',
            '--- a/backend/nidavellir/main.py',
            '+++ b/backend/nidavellir/main.py',
            '@@ -8,2 +8,3 @@',
            '+from .routers import git as git_router',
          ].join('\n') },
        ],
      }],
    });

    render(<ContextPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Git' }));
    await screen.findByRole('button', { name: /Review backend\/nidavellir\/main.py/i });
    fireEvent.click(screen.getByRole('button', { name: /Review backend\/nidavellir\/main.py/i }));

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Review' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByText('backend/nidavellir/main.py')).toBeTruthy();
    expect(screen.getByText((text) => text.includes('git_router'))).toBeTruthy();
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
