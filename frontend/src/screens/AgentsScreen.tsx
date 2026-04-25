import { TopBar } from '../components/shared/TopBar';
import { Btn } from '../components/shared/Btn';
import { SBadge } from '../components/shared/SBadge';
import { ProviderIcon } from '../components/shared/ProviderIcon';
import type { BadgeStatus } from '../types';

const AGENT_DATA = [
  { id:'a1', name:'claude-opus-4',  model:'claude-opus-4',   provider:'Anthropic', status:'active' as BadgeStatus, task:'auth-refactor · JWT middleware', elapsed:'14m', done:3 },
  { id:'a2', name:'codex-mini',     model:'o4-mini (Codex)', provider:'OpenAI',    status:'busy'   as BadgeStatus, task:'test_suite.py · 247/312 tests',  elapsed:'6m',  done:5 },
  { id:'a3', name:'gemini-2.5-pro', model:'gemini-2.5-pro',  provider:'Google',    status:'idle'   as BadgeStatus, task:'—',                              elapsed:'—',   done:1 },
  { id:'a4', name:'claude-haiku',   model:'claude-haiku-4-5',provider:'Anthropic', status:'idle'   as BadgeStatus, task:'—',                              elapsed:'—',   done:8 },
];

const ACTIVITY_LOG = [
  { time:'14:32', agent:'claude-opus-4',  msg:'Completed: create_tokens() — 47 lines' },
  { time:'14:28', agent:'codex-mini',     msg:'Running test_suite.py: 247/312 tests passed' },
  { time:'14:21', agent:'claude-opus-4',  msg:'Started: JWT middleware refactor' },
  { time:'13:55', agent:'claude-haiku',   msg:'Completed: /auth/token API documentation' },
  { time:'13:40', agent:'gemini-2.5-pro', msg:'Completed: API v2 spec review — 2 comments' },
];

const STATUS_COL: Partial<Record<BadgeStatus, string>> = {
  active: '#3fb950', busy: '#d29922', idle: '#8b949e', error: '#f85149',
};

function AgentCard({ ag }: { ag: typeof AGENT_DATA[0] }) {
  const statusCol = STATUS_COL[ag.status] ?? '#8b949e';
  const pulse = ag.status === 'active';
  return (
    <div style={{ background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <ProviderIcon provider={ag.provider} size={36}/>
            <span style={{
              position: 'absolute', bottom: -2, right: -2,
              width: 10, height: 10, borderRadius: '50%',
              background: statusCol, border: '2px solid var(--bg1)',
              boxShadow: pulse ? `0 0 8px ${statusCol}` : 'none',
              animation: pulse ? 'nidPulse 2s ease-in-out infinite' : 'none',
            }}/>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t0)', fontFamily: 'var(--mono)' }}>{ag.name}</div>
            <div style={{ fontSize: 11, color: 'var(--t1)' }}>{ag.provider}</div>
          </div>
        </div>
        <SBadge s={ag.status}/>
      </div>
      <span style={{ fontSize: 11, padding: '2px 7px', background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 3, color: 'var(--t1)', fontFamily: 'var(--mono)', alignSelf: 'flex-start' }}>
        {ag.model}
      </span>
      <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 3 }}>Current task</div>
        <div style={{ fontSize: 12, color: ag.task === '—' ? '#8b949e55' : 'var(--t0)', fontFamily: 'var(--mono)', lineHeight: 1.5 }}>{ag.task}</div>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <span style={{ fontSize: 11, color: 'var(--t1)' }}>Elapsed <b style={{ color: 'var(--t0)', fontWeight: 500 }}>{ag.elapsed}</b></span>
        <span style={{ fontSize: 11, color: 'var(--t1)' }}>Today <b style={{ color: 'var(--grn)', fontWeight: 500 }}>{ag.done} done</b></span>
      </div>
    </div>
  );
}

export function AgentsScreen() {
  const active = AGENT_DATA.filter((a) => a.status !== 'idle').length;
  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar title="Agents" sub={`${active} active · ${AGENT_DATA.length} total`}>
        <Btn small primary onClick={() => window.dispatchEvent(new CustomEvent('nid:spawn'))}>
          + Spawn Agent
        </Btn>
      </TopBar>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14, maxWidth: 900, marginBottom: 20 }}>
          {AGENT_DATA.map((a) => <AgentCard key={a.id} ag={a}/>)}
        </div>
        <div style={{ background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden', maxWidth: 900 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bd)', fontSize: 11, fontWeight: 600, color: 'var(--t1)', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
            Activity log
          </div>
          {ACTIVITY_LOG.map((e, i) => (
            <div key={i} style={{ padding: '9px 14px', borderBottom: i < 4 ? '1px solid #30363d22' : 'none', display: 'flex', gap: 12, alignItems: 'baseline' }}>
              <span style={{ fontSize: 11, color: 'var(--t1)', fontFamily: 'var(--mono)', flexShrink: 0 }}>{e.time}</span>
              <span style={{ fontSize: 11, color: 'var(--grn)', fontFamily: 'var(--mono)', flexShrink: 0, minWidth: 130 }}>{e.agent}</span>
              <span style={{ fontSize: 12, color: 'var(--t1)' }}>{e.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
