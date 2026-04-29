import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MessageList } from '../../components/chat/MessageList';
import { useAgentStore } from '../../store/agentStore';

describe('MessageList activity feed', () => {
  beforeEach(() => {
    useAgentStore.setState({
      messages: [],
      isStreaming: false,
      selectedProvider: 'claude',
    });
  });

  it('shows an animated working indicator while an agent message is streaming', () => {
    useAgentStore.getState().addMessage('agent', 'Working on it');
    render(<MessageList />);

    expect(screen.getAllByLabelText('Agent is working')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Expand agent activity' })).toBeTruthy();
    expect(screen.getByText(/Working for/)).toBeTruthy();
  });

  it('shows a stop button while an agent message is streaming', () => {
    useAgentStore.getState().addMessage('agent', 'Working on it');
    render(<MessageList />);

    expect(screen.getByRole('button', { name: 'Stop agent' })).toBeTruthy();
  });

  it('opens a flowing activity log from the disclosure arrow', () => {
    useAgentStore.getState().addMessage('agent', '');
    useAgentStore.getState().appendStreamEvents([
      { type: 'progress', content: 'I’m checking the frontend activity rendering path.' },
      { type: 'tool_start', id: 'tool-1', name: 'Bash', args: "sed -n '1,260p' frontend/src/components/chat/MessageList.tsx", raw: '◆ Bash(...)' },
      { type: 'tool_end', id: 'tool-1', status: 'success', summary: 'read ok' },
      { type: 'skill_use', name: 'browser-use', detail: 'Checking the local UI' },
      { type: 'patch', content: '+ added line' },
      { type: 'reasoning_signal', content: 'private reasoning should not be rendered verbatim' },
    ]);

    render(<MessageList />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand agent activity' }));

    expect(screen.getByText('I’m checking the frontend activity rendering path.')).toBeTruthy();
    expect(screen.getByText('Explored 1 file')).toBeTruthy();
    expect(screen.getByText('Read MessageList.tsx')).toBeTruthy();
    expect(screen.getByText('Used browser-use: Checking the local UI')).toBeTruthy();
    expect(screen.getByText('Prepared code changes.')).toBeTruthy();
    expect(screen.queryByText('Tool')).toBeNull();
    expect(screen.queryByText('Skill')).toBeNull();
    expect(screen.queryByText('Patch')).toBeNull();
    expect(screen.queryByText('Reasoning')).toBeNull();
    expect(screen.queryByText('private reasoning should not be rendered verbatim')).toBeNull();
  });

  it('keeps tool telemetry out of the main response bubble and reveals it in activity', () => {
    useAgentStore.getState().addMessage('agent', '');
    useAgentStore.getState().appendStreamEvents([
      { type: 'answer_delta', content: 'I found the chat screen.\n' },
      { type: 'tool_start', id: 'tool-1', name: 'exec', args: "/bin/bash -lc 'rg --files .'", raw: "exec /bin/bash -lc 'rg --files .'" },
      { type: 'tool_end', id: 'tool-1', status: 'success', summary: 'succeeded in 351ms: ./frontend/src/screens/ChatScreen.tsx' },
    ]);

    render(<MessageList />);

    expect(screen.getByText('I found the chat screen.')).toBeTruthy();
    expect(screen.queryByText(/rg --files/)).toBeNull();
    expect(screen.queryByText(/succeeded in 351ms/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand agent activity' }));

    expect(screen.getByText('Explored 1 search')).toBeTruthy();
    expect(screen.getByText(/Searched/)).toBeTruthy();
    expect(screen.getByText('succeeded in 351ms: ./frontend/src/screens/ChatScreen.tsx')).toBeTruthy();
  });

  it('shows live running tool activity before the agent finishes', () => {
    useAgentStore.getState().addMessage('agent', '');
    useAgentStore.getState().appendStreamEvents([
      { type: 'tool_start', id: 'tool-live', name: 'exec', args: '/bin/bash -lc pwd', raw: 'exec /bin/bash -lc pwd' },
    ]);

    render(<MessageList />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand agent activity' }));

    expect(screen.getByRole('button', { name: 'Collapse agent activity' })).toBeTruthy();
    expect(screen.getByText('Ran 1 command')).toBeTruthy();
    expect(screen.getByText('Ran exec')).toBeTruthy();
    expect(screen.getByText('/bin/bash -lc pwd')).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
  });

  it('groups streaming tool deltas into one elegant tool card', () => {
    useAgentStore.getState().addMessage('agent', '');
    useAgentStore.getState().appendStreamEvents([
      { type: 'tool_start', id: 'tool-stream', name: 'Bash', args: '{"command":', raw: {} },
      { type: 'tool_delta', id: 'tool-stream', content: '"rg -n ' },
      { type: 'tool_delta', id: 'tool-stream', content: 'TokenUsage' },
      { type: 'tool_delta', id: 'tool-stream', content: ' frontend"}' },
      { type: 'tool_end', id: 'tool-stream', status: 'success', summary: '12 matches' },
    ]);

    render(<MessageList />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand agent activity' }));

    expect(screen.getByText('Ran Bash')).toBeTruthy();
    expect(screen.getByText('12 matches')).toBeTruthy();
    expect(screen.queryByText('Output')).toBeNull();
    expect(screen.queryByText('"rg -n')).toBeNull();
    expect(screen.queryByText('TokenUsage')).toBeNull();
  });

  it('hides standalone output deltas from the polished activity log', () => {
    useAgentStore.getState().addMessage('agent', '');
    useAgentStore.getState().appendStreamEvents([
      { type: 'tool_delta', id: 'orphan', content: 'line one\n' },
      { type: 'tool_delta', id: 'orphan', content: 'line two\n' },
    ]);

    render(<MessageList />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand agent activity' }));

    expect(screen.getByText('Waiting for provider activity')).toBeTruthy();
    expect(screen.queryByText(/line one/)).toBeNull();
    expect(screen.queryByText(/line two/)).toBeNull();
  });

  it('does not render provider lifecycle noise in the expanded activity log', () => {
    useAgentStore.getState().addMessage('agent', '');
    useAgentStore.getState().appendStreamEvents([
      { type: 'progress', content: 'Starting codex in /mnt/c/Users/colebienek/projects/nidavellir' },
      { type: 'progress', content: 'Provider process started' },
      { type: 'progress', content: 'Prompt sent to provider' },
      { type: 'progress', content: 'Codex session 019dd48f-dc0e-7d03-b5f7-8f15a741e003 started' },
      { type: 'progress', content: 'turn started' },
      { type: 'progress', content: 'Provider is still working (10s elapsed)' },
    ]);

    render(<MessageList />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand agent activity' }));

    expect(screen.queryByText(/Starting codex/)).toBeNull();
    expect(screen.queryByText(/Provider process started/)).toBeNull();
    expect(screen.queryByText(/Prompt sent/)).toBeNull();
    expect(screen.queryByText(/turn started/)).toBeNull();
    expect(screen.queryByText(/still working/)).toBeNull();
    expect(screen.getByText('Waiting for provider activity')).toBeTruthy();
  });

  it('renders a completion report for finished build tasks', () => {
    useAgentStore.getState().addMessage('agent', 'Implemented the process change.');
    useAgentStore.getState().appendStreamEvents([
      { type: 'answer_delta', content: 'Implemented the process change.' },
      { type: 'patch', content: [
        'diff --git a/frontend/src/lib/agentSocket.ts b/frontend/src/lib/agentSocket.ts',
        '--- a/frontend/src/lib/agentSocket.ts',
        '+++ b/frontend/src/lib/agentSocket.ts',
        '@@',
        '-        s.clearMessages();',
        '+        if (useAgentStore.getState().isStreaming) {',
        '+          s.finalizeLastAgentMessage();',
        '+        }',
      ].join('\n') },
      { type: 'tool_start', id: 'verify-1', name: 'exec', args: 'cd frontend && npm run typecheck' },
      { type: 'tool_end', id: 'verify-1', status: 'success', summary: 'typecheck passed' },
    ]);
    useAgentStore.setState((state) => ({
      messages: state.messages.map((msg) => ({
        ...msg,
        timestamp: new Date('2026-04-27T20:00:00.000Z'),
        completedAt: new Date('2026-04-27T20:01:34.000Z'),
        streaming: false,
      })),
      isStreaming: false,
    }));

    render(<MessageList />);

    const report = screen.getByLabelText('Task completion report');
    expect(within(report).getByText('Worked for 1m 34s')).toBeTruthy();
    expect(within(report).getByText('Changed 1 file and verified with 1 command.')).toBeTruthy();
    expect(within(report).getByText('Changed')).toBeTruthy();
    expect(within(report).getByText((text) => text.includes('1 file changed'))).toBeTruthy();
    expect(within(report).getAllByText('+3')).toHaveLength(2);
    expect(within(report).getAllByText('-1')).toHaveLength(2);
    expect(within(report).getByText('frontend/src/lib/agentSocket.ts')).toBeTruthy();
    expect(within(report).getByText('Verified')).toBeTruthy();
    expect(within(report).getByText('cd frontend && npm run typecheck')).toBeTruthy();
    expect(within(report).getByText('typecheck passed')).toBeTruthy();
  });

  it('renders agent responses without a strict bubble container', () => {
    useAgentStore.getState().addMessage('agent', 'A clean Codex-style response.');
    useAgentStore.getState().finalizeLastAgentMessage();

    render(<MessageList />);

    const response = screen.getByTestId('agent-message-content');
    expect(response).toHaveTextContent('A clean Codex-style response.');
    expect(response).not.toHaveAttribute('data-bubble', 'true');
  });

  it('shows changed-file diffs in expandable drawers', () => {
    useAgentStore.getState().addMessage('agent', 'Implemented the process change.');
    useAgentStore.getState().appendStreamEvents([
      { type: 'answer_delta', content: 'Implemented the process change.' },
      { type: 'patch', content: [
        'diff --git a/frontend/src/lib/agentSocket.ts b/frontend/src/lib/agentSocket.ts',
        '--- a/frontend/src/lib/agentSocket.ts',
        '+++ b/frontend/src/lib/agentSocket.ts',
        '@@',
        '-        s.clearMessages();',
        '+        s.finalizeLastAgentMessage();',
      ].join('\n') },
    ]);
    useAgentStore.setState((state) => ({
      messages: state.messages.map((msg) => ({
        ...msg,
        completedAt: new Date(),
        streaming: false,
      })),
      isStreaming: false,
    }));

    render(<MessageList />);

    fireEvent.click(screen.getByRole('button', { name: /Expand diff for frontend\/src\/lib\/agentSocket.ts/i }));

    expect(screen.getByText(/s\.clearMessages/)).toBeTruthy();
    expect(screen.getByText(/s\.finalizeLastAgentMessage/)).toBeTruthy();
  });
});
