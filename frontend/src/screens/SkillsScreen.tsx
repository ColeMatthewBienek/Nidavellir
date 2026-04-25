import { useState } from 'react';
import { TopBar } from '../components/shared/TopBar';
import { Btn } from '../components/shared/Btn';

const SKILL_DATA = [
  { id:'01',  name:'Interviewer',  tags:['requirements'],    desc:'Gathers requirements through structured dialogue. Extracts intent, constraints, and edge cases.',                     lastUsed:'today',     runs:42 },
  { id:'02',  name:'Spec Editor',  tags:['spec','planning'], desc:'Transforms raw requirements into a structured technical specification with acceptance criteria.',                     lastUsed:'today',     runs:38 },
  { id:'03',  name:'Reviewer',     tags:['review','QA'],     desc:'Reviews code and specs for correctness, style, and completeness. Produces severity-rated feedback.',                 lastUsed:'1h ago',    runs:67 },
  { id:'03b', name:'Consolidator', tags:['review'],          desc:'Merges multiple review comments into a coherent summary, resolving conflicts by impact.',                            lastUsed:'3h ago',    runs:21 },
  { id:'04',  name:'Orchestrator', tags:['orchestration','DAG'], desc:'Decomposes specs into task DAGs, assigns agents, sequences work, monitors completion.',                         lastUsed:'2h ago',    runs:15 },
  { id:'sw',  name:'Spec Writer',  tags:['spec'],            desc:'General-purpose spec writing. Produces detailed functional and technical specs from prompts.',                       lastUsed:'yesterday', runs:29 },
];

export function SkillsScreen() {
  const [sel, setSel] = useState<typeof SKILL_DATA[0] | null>(null);

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar title="Skills" sub={`${SKILL_DATA.length} loaded`}>
          <Btn small primary>+ Load Skill</Btn>
        </TopBar>
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, maxWidth: 1000 }}>
            {SKILL_DATA.map((sk) => (
              <div key={sk.id} onClick={() => setSel(sel?.id === sk.id ? null : sk)} style={{
                background: 'var(--bg1)', border: `1px solid ${sel?.id === sk.id ? 'var(--grn)' : 'var(--bd)'}`,
                borderRadius: 8, padding: 14, cursor: 'pointer', transition: 'border-color 0.15s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t1)', background: 'var(--bg2)', padding: '2px 6px', borderRadius: 3 }}>{sk.id}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t0)' }}>{sk.name}</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--t1)', lineHeight: 1.65, margin: '0 0 10px' }}>{sk.desc}</p>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {sk.tags.map((tg) => (
                    <span key={tg} style={{ fontSize: 10, padding: '1px 6px', background: '#bc8cff15', border: '1px solid #bc8cff30', borderRadius: 3, color: 'var(--prp)', fontFamily: 'var(--mono)' }}>{tg}</span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--t1)', display: 'flex', gap: 12 }}>
                  <span>Last used: {sk.lastUsed}</span><span>{sk.runs} runs</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {sel && (
        <div style={{ width: 260, borderLeft: '1px solid var(--bd)', background: 'var(--bg1)', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t0)' }}>{sel.name}</span>
            <span onClick={() => setSel(null)} style={{ cursor: 'pointer', color: 'var(--t1)', fontSize: 14 }}>✕</span>
          </div>
          <div style={{ flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Description</div>
              <div style={{ fontSize: 12, color: 'var(--t0)', lineHeight: 1.75 }}>{sel.desc}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tags</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {sel.tags.map((tg) => (
                  <span key={tg} style={{ fontSize: 11, padding: '2px 8px', background: '#bc8cff15', border: '1px solid #bc8cff30', borderRadius: 3, color: 'var(--prp)', fontFamily: 'var(--mono)' }}>{tg}</span>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Usage</div>
              <div style={{ fontSize: 12, color: 'var(--t0)' }}>{sel.runs} total runs</div>
              <div style={{ fontSize: 12, color: 'var(--t1)' }}>Last used: {sel.lastUsed}</div>
            </div>
            <Btn primary>Invoke Skill</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
