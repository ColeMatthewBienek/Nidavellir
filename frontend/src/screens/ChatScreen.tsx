import { useState } from 'react';
import { TopBar } from '../components/shared/TopBar';
import { Btn } from '../components/shared/Btn';
import { SecPanel } from '../components/shared/SecPanel';
import { SlashMenu, SLASH_CMDS } from '../components/chat/SlashMenu';
import { ContextPanel } from '../components/chat/ContextPanel';
import { MessageList } from '../components/chat/MessageList';
import { useAgentStore } from '../store/agentStore';

const CHAT_THREADS = [
  { id: 'auth', label: 'auth-refactor',   time: 'now', unread: true  },
  { id: 'api',  label: 'API integration', time: '2h',  unread: false },
  { id: 'bug',  label: 'Bug fix #234',    time: '5h',  unread: false },
  { id: 'mem',  label: 'Memory system',   time: '1d',  unread: false },
];

const STREAM_RESP = "Adding rate limiting to the token endpoint.\n\nUsing a sliding window counter backed by Redis:\n```python\nfrom fastapi import Request, HTTPException\nfrom redis.asyncio import Redis\n\nredis = Redis.from_url(os.environ['REDIS_URL'])\n\nasync def rate_limit(request: Request):\n    ip  = request.client.host\n    key = f\"rl:token:{ip}\"\n    count = await redis.incr(key)\n    if count == 1:\n        await redis.expire(key, 60)   # 60s window\n    if count > 5:\n        raise HTTPException(429, \"Rate limit exceeded\")\n```\n\nApplied to the router:\n```python\n@router.post(\"/auth/token\",\n    dependencies=[Depends(rate_limit)])\nasync def get_token(form: OAuth2PasswordRequestForm):\n    user = await authenticate(form.username, form.password)\n    return create_tokens(str(user.id))\n```\n\nWant me to add `Retry-After` headers and exponential backoff too?";

export function ChatScreen() {
  // Use individual selectors — combined object selectors create new refs each render
  // and trigger Zustand's forceStoreRerender on every subscription check.
  const addMessage               = useAgentStore((s) => s.addMessage);
  const appendRawChunk           = useAgentStore((s) => s.appendRawChunk);
  const finalizeLastAgentMessage = useAgentStore((s) => s.finalizeLastAgentMessage);
  const clearMessages            = useAgentStore((s) => s.clearMessages);
  const isStreaming              = useAgentStore((s) => s.isStreaming);

  const [thread, setThread]   = useState('auth');
  const [input, setInput]     = useState('');
  const [thinking, setThinking] = useState(false);
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
    if (!input.trim() || isStreaming || thinking) return;
    const userContent = input.trim();
    setInput('');
    addMessage('user', userContent);
    setThinking(true);

    // Simulate streaming response (replaced by real WebSocket when backend adds chat route)
    setTimeout(() => {
      setThinking(false);
      useAgentStore.setState({ isStreaming: true });
      addMessage('agent', '');
      let i = 0;
      const iv = setInterval(() => {
        const chunk = STREAM_RESP.slice(i, i + 8);
        if (chunk) appendRawChunk(chunk);
        i += 8;
        if (i >= STREAM_RESP.length) {
          clearInterval(iv);
          finalizeLastAgentMessage();
        }
      }, 18);
    }, 1200);
  };

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Thread list */}
      <SecPanel title="Threads" action="+" onAction={() => {}}>
        {CHAT_THREADS.map((t) => (
          <div key={t.id} onClick={() => setThread(t.id)} style={{
            padding: '10px 14px', cursor: 'pointer',
            borderLeft: thread === t.id ? '2px solid var(--grn)' : '2px solid transparent',
            background: thread === t.id ? 'var(--bg2)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            transition: 'all 0.15s',
          }}>
            <div>
              <div style={{ fontSize: 13, color: thread === t.id ? 'var(--t0)' : 'var(--t1)', fontWeight: thread === t.id ? 500 : 400 }}>
                {t.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--t1)', marginTop: 1 }}>{t.time}</div>
            </div>
            {t.unread && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--blu)', flexShrink: 0 }} />}
          </div>
        ))}
      </SecPanel>

      {/* Messages */}
      <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar title={CHAT_THREADS.find((t) => t.id === thread)?.label ?? 'chat'}>
          <select style={{
            background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 5,
            padding: '4px 8px', fontSize: 12, color: 'var(--t0)', cursor: 'pointer', outline: 'none',
          }}>
            <option>claude-opus-4</option>
            <option>claude-sonnet-4</option>
            <option>codex-mini</option>
          </select>
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
                disabled={isStreaming || thinking}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  resize: 'none', fontSize: 13, color: 'var(--t0)', lineHeight: 1.5,
                  opacity: isStreaming || thinking ? 0.5 : 1,
                }}
              />
              <Btn primary onClick={send} disabled={!input.trim() || isStreaming || thinking || showSlash}>
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
