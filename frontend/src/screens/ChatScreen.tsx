import { useState } from 'react';
import { TopBar } from '../components/shared/TopBar';
import { Btn } from '../components/shared/Btn';
import { SecPanel } from '../components/shared/SecPanel';
import { SlashMenu, SLASH_CMDS } from '../components/chat/SlashMenu';
import { ContextPanel } from '../components/chat/ContextPanel';
import { MessageList } from '../components/chat/MessageList';
import { AgentSelector } from '../components/chat/AgentSelector';
import { useAgentStore } from '../store/agentStore';
import { sendMessage, sendNewSession } from '../lib/agentSocket';

export function ChatScreen() {
  const addMessage    = useAgentStore((s) => s.addMessage);
  const clearMessages = useAgentStore((s) => s.clearMessages);
  const isStreaming   = useAgentStore((s) => s.isStreaming);
  const selectedModel = useAgentStore((s) => s.selectedModel);

  const startNewChat = () => {
    clearMessages();
    const [providerId, ...rest] = selectedModel.split(':');
    sendNewSession(providerId, rest.join(':'));
  };

  const [input, setInput]     = useState('');
  const [ctxOpen, setCtxOpen] = useState(true);
  const [slashHL, setSlashHL] = useState(0);

  const slashMatch    = input.match(/^(\/\S*)/);
  const slashQuery    = slashMatch ? slashMatch[1].toLowerCase() : null;
  const showSlash     = !!slashQuery;
  const slashFiltered = showSlash ? SLASH_CMDS.filter((c) => c.cmd.startsWith(slashQuery!)) : [];

  const handleSlashSelect = (cmd: typeof SLASH_CMDS[0]) => {
    if (cmd.action === 'spawn') {
      setInput('');
      window.dispatchEvent(new CustomEvent('nid:spawn'));
    } else if (cmd.action === 'context') {
      setInput(''); setCtxOpen(true);
    } else if (cmd.action === 'clear') {
      clearMessages(); setInput('');
    } else if (cmd.action === 'help') {
      setInput('');
      addMessage('agent', '**Available commands**\n\n' + SLASH_CMDS.map((c) => `\`${c.cmd}\` — ${c.desc}`).join('\n'));
      useAgentStore.getState().finalizeLastAgentMessage();
    } else if (cmd.action.startsWith('nav:')) {
      setInput('');
      window.dispatchEvent(new CustomEvent('nid:navigate', { detail: cmd.action.slice(4) }));
    } else {
      setInput(cmd.cmd + ' ');
    }
    setSlashHL(0);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (showSlash && slashFiltered.length) {
      if (e.key === 'ArrowDown')  { e.preventDefault(); setSlashHL((i) => (i + 1) % slashFiltered.length); return; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); setSlashHL((i) => (i - 1 + slashFiltered.length) % slashFiltered.length); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); handleSlashSelect(slashFiltered[slashHL]); return; }
      if (e.key === 'Escape') { setInput(''); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !showSlash) { e.preventDefault(); send(); }
  };

  const send = () => {
    if (!input.trim() || isStreaming) return;
    const content = input.trim();
    setInput('');
    addMessage('user', content);
    sendMessage(content);
  };

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Thread list — structure preserved; thread items are a future spec */}
      <SecPanel title="Threads" action="+" onAction={startNewChat}>
        <div />
      </SecPanel>

      {/* Messages */}
      <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar title="chat">
          <AgentSelector compact />
          <div onClick={() => setCtxOpen((o) => !o)} style={{
            fontSize: 12, color: ctxOpen ? 'var(--grn)' : 'var(--t1)',
            background: ctxOpen ? '#3fb95012' : 'var(--bg2)',
            border: `1px solid ${ctxOpen ? '#3fb95044' : 'var(--bd)'}`,
            borderRadius: 5, padding: '4px 10px', cursor: 'pointer', transition: 'all 0.2s',
          }}>
            {ctxOpen ? '● Context' : `${3} files`}
          </div>
        </TopBar>

        {/* MessageList owns layout and scroll */}
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <MessageList />
        </div>

        {/* Input */}
        <div style={{ padding: 14, borderTop: '1px solid var(--bd)', background: 'var(--bg1)', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            {showSlash && slashFiltered.length > 0 && (
              <SlashMenu
                query={slashQuery!}
                highlight={slashHL}
                setHighlight={setSlashHL}
                onSelect={handleSlashSelect}
              />
            )}
            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-end',
              background: 'var(--bg2)', borderRadius: 8, padding: '10px 12px',
              border: `1px solid ${showSlash && slashFiltered.length ? 'var(--blu)' : 'var(--bd)'}`,
              transition: 'border-color 0.15s',
            }}>
              <textarea
                value={input}
                onChange={(e) => { setInput(e.target.value); setSlashHL(0); }}
                onKeyDown={handleKey}
                placeholder="Message Nidavellir…   / for commands"
                rows={1}
                disabled={isStreaming}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  resize: 'none', fontSize: 13, color: 'var(--t0)', lineHeight: 1.5,
                  opacity: isStreaming ? 0.5 : 1,
                }}
              />
              <Btn primary onClick={send} disabled={!input.trim() || isStreaming || showSlash}>
                Send
              </Btn>
            </div>
          </div>
          <div style={{ marginTop: 5, fontSize: 11, color: '#8b949e77', display: 'flex', gap: 16 }}>
            <span>↵ send</span>
            <span>shift+↵ newline</span>
            <span style={{ color: showSlash ? 'var(--blu)' : '#8b949e77' }}>/ commands</span>
          </div>
        </div>
      </div>

      {ctxOpen && <ContextPanel onClose={() => setCtxOpen(false)} />}
    </div>
  );
}
