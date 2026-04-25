import { useState } from 'react';
import { TopBar } from '../components/shared/TopBar';
import { Btn } from '../components/shared/Btn';

const SCHED_DAYS  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const SCHED_DATES = [21,22,23,24,25,26,27];
const SCHED_RUNS  = [
  { id:1, label:'Auth Refactor Build', agent:'claude-opus-4', day:0, start:8,  dur:4, col:'#1f6feb' },
  { id:2, label:'Test Suite',          agent:'codex-mini',    day:0, start:13, dur:2, col:'#3fb950' },
  { id:3, label:'API Migration',       agent:'gemini-2.5',    day:1, start:9,  dur:6, col:'#bc8cff' },
  { id:4, label:'Code Review',         agent:'claude-opus-4', day:2, start:10, dur:3, col:'#d29922' },
  { id:5, label:'Docs Generation',     agent:'claude-haiku',  day:3, start:8,  dur:2, col:'#3fb950' },
  { id:6, label:'Integration Tests',   agent:'codex-mini',    day:4, start:9,  dur:5, col:'#1f6feb' },
  { id:7, label:'Deploy Staging',      agent:'claude-opus-4', day:5, start:14, dur:1, col:'#f85149' },
];
const HOURS = Array.from({ length: 12 }, (_, i) => i + 7);
const fmtH = (h: number) => h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`;
const CELL_H = 52;
const TODAY = 3;

export function ScheduleScreen() {
  const [sel, setSel] = useState<typeof SCHED_RUNS[0] | null>(null);

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar title="Schedule" sub="Week of Apr 21–27, 2026">
        <select style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 5, padding: '4px 8px', fontSize: 12, color: 'var(--t0)', cursor: 'pointer', outline: 'none' }}>
          <option>Week view</option><option>Month view</option>
        </select>
        <Btn primary small>+ Schedule Run</Btn>
      </TopBar>

      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '48px repeat(7,1fr)', minWidth: 700 }}>
          <div style={{ height: 36 }}/>
          {SCHED_DAYS.map((d, i) => (
            <div key={d} style={{
              height: 36, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6,
              borderLeft: '1px solid var(--bd)', background: i === TODAY ? '#1f6feb12' : 'var(--bg1)', borderBottom: '1px solid var(--bd)',
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: i === TODAY ? 'var(--blu)' : 'var(--t1)' }}>{d}</span>
              <span style={{ fontSize: 11, color: i === TODAY ? 'var(--blu)' : 'var(--t1)' }}>{SCHED_DATES[i]}</span>
            </div>
          ))}
          {HOURS.map((h) => (
            <div key={h} style={{ display: 'contents' }}>
              <div style={{ height: CELL_H, paddingTop: 6, paddingRight: 8, textAlign: 'right', flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: 'var(--t1)', fontFamily: 'var(--mono)' }}>{fmtH(h)}</span>
              </div>
              {SCHED_DAYS.map((_, d) => (
                <div key={d} style={{ height: CELL_H, borderLeft: '1px solid var(--bd)', borderTop: '1px solid #30363d22', background: d === TODAY ? '#1f6feb08' : 'transparent', position: 'relative' }}>
                  {SCHED_RUNS.filter((r) => r.day === d && r.start === h).map((r) => (
                    <div key={r.id} onClick={() => setSel(sel?.id === r.id ? null : r)} style={{
                      position: 'absolute', top: 3, left: 4, right: 4,
                      height: CELL_H * r.dur - 6, background: `${r.col}1a`,
                      border: `1px solid ${r.col}55`, borderLeft: `3px solid ${r.col}`,
                      borderRadius: 4, padding: '4px 7px', cursor: 'pointer', overflow: 'hidden', zIndex: 1,
                      outline: sel?.id === r.id ? `1px solid ${r.col}` : 'none', transition: 'all 0.15s',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: r.col, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--t1)' }}>{r.agent}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>

        {sel && (
          <div style={{ marginTop: 16, background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 8, padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 3, height: 44, background: sel.col, borderRadius: 2, flexShrink: 0 }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--t0)' }}>{sel.label}</div>
              <div style={{ fontSize: 11, color: 'var(--t1)', marginTop: 2 }}>{sel.agent} · {sel.dur}h · {SCHED_DAYS[sel.day]} {fmtH(sel.start)}</div>
            </div>
            <Btn small>Edit</Btn>
            <Btn small>Cancel</Btn>
          </div>
        )}
      </div>
    </div>
  );
}
