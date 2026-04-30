import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MarkdownRenderer } from '../../components/chat/MarkdownRenderer';
import { parseCodeRef } from '../../lib/liveRefs';
import { useAgentStore } from '../../store/agentStore';

describe('live code references', () => {
  beforeEach(() => {
    useAgentStore.setState({
      workingDirectory: '/mnt/c/Users/colebienek/projects/nidavellir',
      workingDirectoryDisplay: '/mnt/c/Users/colebienek/projects/nidavellir',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        path: '/mnt/c/Users/colebienek/projects/nidavellir/frontend/src/App.tsx',
        fileName: 'App.tsx',
        startLine: 12,
        endLine: 14,
        lineCount: 30,
        lines: [
          { number: 10, text: 'before', highlighted: false },
          { number: 12, text: 'const active = true;', highlighted: true },
          { number: 13, text: 'render(active);', highlighted: true },
          { number: 14, text: 'after(active);', highlighted: true },
        ],
      }),
    }));
  });

  it('parses local path line ranges', () => {
    expect(parseCodeRef('frontend/src/App.tsx:12-14')).toMatchObject({
      path: 'frontend/src/App.tsx',
      startLine: 12,
      endLine: 14,
      kind: 'code',
    });
  });

  it('parses code scheme links with GitHub-style line anchors', () => {
    expect(parseCodeRef('code://frontend/src/App.tsx#L12-L14')).toMatchObject({
      path: 'frontend/src/App.tsx',
      startLine: 12,
      endLine: 14,
      kind: 'code',
    });
  });

  it('renders inline code refs as live links and opens highlighted preview', async () => {
    render(<MarkdownRenderer content={'See `frontend/src/App.tsx:12-14`.'} />);

    fireEvent.click(screen.getByRole('button', { name: /Open code reference frontend\/src\/App.tsx:12-14/i }));

    await waitFor(() => expect(screen.getByRole('dialog', { name: /Code reference preview/i })).toBeTruthy());
    expect(screen.getByText('App.tsx')).toBeTruthy();
    expect(screen.getByText('const active = true;')).toBeTruthy();
    expect(screen.getAllByTestId('highlighted-code-line')).toHaveLength(3);
  });

  it('renders markdown code-scheme links as live links', async () => {
    render(<MarkdownRenderer content={'Open [the app shell](code://frontend/src/App.tsx#L12-L14).'} />);

    fireEvent.click(screen.getByRole('button', { name: /Open code reference the app shell/i }));

    await waitFor(() => expect(screen.getByText('render(active);')).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/refs/code?'));
  });

  it('renders GFM tables as tables instead of raw pipe text', () => {
    render(<MarkdownRenderer content={[
      '| Priority | Action |',
      '|---|---|',
      '| High | Update `project_overview.md` |',
      '| Low | Add architectural constants |',
    ].join('\n')} />);

    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Priority' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: /Update/ })).toBeTruthy();
    expect(screen.queryByText(/\|---\|---\|/)).toBeNull();
  });

  it('opens VS Code with the backend-resolved absolute path, not the relative ref', async () => {
    const openCodeRef = vi.fn().mockResolvedValue(undefined);
    window.nidavellir = { openCodeRef, pickWorkingSetFiles: vi.fn().mockResolvedValue([]) };
    render(<MarkdownRenderer content={'See `frontend/src/App.tsx:12-14`.'} />);

    fireEvent.click(screen.getByRole('button', { name: /Open code reference frontend\/src\/App.tsx:12-14/i }));

    await waitFor(() => expect(openCodeRef).toHaveBeenCalledWith(
      '/mnt/c/Users/colebienek/projects/nidavellir/frontend/src/App.tsx',
      12,
      14,
    ));
  });
});
