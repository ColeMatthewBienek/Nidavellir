import { useState } from 'react';
import { TopBar } from '../components/shared/TopBar';
import { Btn } from '../components/shared/Btn';
import { SBadge } from '../components/shared/SBadge';
import type { BadgeStatus } from '../types';

const ALL_TASKS = [
  { id:'AUTH-001', label:'create_tokens() function',      status:'complete' as BadgeStatus, pri:'high',   agent:'claude-opus-4', when:'2h ago'  },
  { id:'AUTH-002', label:'JWT validation middleware',     status:'running'  as BadgeStatus, pri:'high',   agent:'claude-opus-4', when:'2h ago'  },
  { id:'AUTH-003', label:'Rate limiter — token endpoint', status:'pending'  as BadgeStatus, pri:'high',   agent:null,            when:'2h ago'  },
  { id:'AUTH-004', label:'Refresh token endpoint',        status:'pending'  as BadgeStatus, pri:'medium', agent:null,            when:'2h ago'  },
  { id:'TEST-001', label:'Run full test suite',           status:'running'  as BadgeStatus, pri:'medium', agent:'codex-mini',    when:'30m ago' },
  { id:'DOCS-001', label:'Update API documentation',      status:'pending'  as BadgeStatus, pri:'low',    agent:null,            when:'1h ago'  },
  { id:'UI-001',   label:'Polish nav component',          status:'complete' as BadgeStatus, pri:'low',    agent:'claude-haiku',  when:'3h ago'  },
  { id:'UI-002',   label:'Agent status pulse animation',  status:'complete' as BadgeStatus, pri:'low',    agent:'claude-haiku',  when:'4h ago'  },
];

const PRI_COL: Record<string, string> = { high: 'var(--red)', medium: 'var(--yel)', low: 'var(--t1)' };

export function TasksScreen() {
  const [filter, setFilter] = useState('all');
  const rows = filter === 'all' ? ALL_TASKS : ALL_TASKS.filter((t) => t.status === filter);
  const count = (s: string) => s === 'all' ? ALL_TASKS.length : ALL_TASKS.filter((t) => t.status === s).length;

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar title="Tasks" sub={`${count('running')} running · ${count('pending')} pending`}>
        <Btn small primary>+ New Task</Btn>
      </TopBar>

      <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--bd)', background: 'var(--bg1)', display: 'flex', gap: 7, flexShrink: 0 }}>
        {['all','running','pending','complete'].map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 12px', borderRadius: 20,
            border: `1px solid ${filter === f ? 'var(--grn)' : 'var(--bd)'}`,
            background: filter === f ? '#3fb95016' : 'var(--bg2)',
            fontSize: 12, color: filter === f ? 'var(--grn)' : 'var(--t1)', cursor: 'pointer', transition: 'all 0.15s',
          }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}{' '}
            <span style={{ fontSize: 10 }}>{count(f)}</span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '100px 1fr 100px 76px 148px 80px',
          padding: '8px 20px', borderBottom: '1px solid var(--bd)',
          fontSize: 11, fontWeight: 600, color: 'var(--t1)', textTransform: 'uppercase', letterSpacing: '0.5px',
          background: 'var(--bg1)', position: 'sticky', top: 0, zIndex: 2,
        }}>
          <div>ID</div><div>Task</div><div>Status</div><div>Priority</div><div>Agent</div><div>Created</div>
        </div>
        {rows.map((t, i) => (
          <div key={t.id} style={{
            display: 'grid', gridTemplateColumns: '100px 1fr 100px 76px 148px 80px',
            padding: '10px 20px', borderBottom: '1px solid #30363d22',
            background: i % 2 === 0 ? 'transparent' : '#161b2260', alignItems: 'center', cursor: 'pointer',
          }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{t.id}</div>
            <div style={{ fontSize: 13, color: 'var(--t0)' }}>{t.label}</div>
            <div><SBadge s={t.status}/></div>
            <div style={{ fontSize: 11, fontWeight: 500, color: PRI_COL[t.pri] }}>{t.pri}</div>
            <div style={{ fontSize: 11, color: 'var(--t1)', fontFamily: 'var(--mono)' }}>
              {t.agent ?? <span style={{ color: 'var(--bd)' }}>unassigned</span>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--t1)' }}>{t.when}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
