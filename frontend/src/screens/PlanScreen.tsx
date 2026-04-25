import { useState } from 'react';
import { TopBar } from '../components/shared/TopBar';
import { Btn } from '../components/shared/Btn';
import { SBadge } from '../components/shared/SBadge';
import { SecPanel } from '../components/shared/SecPanel';
import type { BadgeStatus } from '../types';

const PLAN_PROJECTS = [
  { id: 'jwt', label: 'JWT Auth Refactor',   status: 'active'   as BadgeStatus },
  { id: 'api', label: 'API v2 Migration',    status: 'pending'  as BadgeStatus },
  { id: 'ui',  label: 'UI Component System', status: 'complete' as BadgeStatus },
];
const PLAN_STAGES = ['Interview', 'Spec', 'DAG', 'Review'];

const DAG_NODES = [
  { id: 'spec',  label: 'JWT Auth Spec',     x: 16,  y: 92,  w: 152, h: 38, col: '#1f6feb' },
  { id: 't1',    label: 'create_tokens()',   x: 220, y: 16,  w: 148, h: 38, col: ''        },
  { id: 't2',    label: 'JWT middleware',    x: 220, y: 70,  w: 148, h: 38, col: ''        },
  { id: 't3',    label: 'Rate limiter',      x: 220, y: 124, w: 148, h: 38, col: ''        },
  { id: 't4',    label: 'Refresh endpoint',  x: 220, y: 178, w: 148, h: 38, col: ''        },
  { id: 'tests', label: 'Integration tests', x: 424, y: 92,  w: 148, h: 38, col: '#238636' },
];
const DAG_EDGES = [
  ['spec','t1'],['spec','t2'],['spec','t3'],['spec','t4'],
  ['t1','tests'],['t2','tests'],['t3','tests'],['t4','tests'],
];

function DagEdgePath({ from, to }: { from: string; to: string }) {
  const f = DAG_NODES.find((n) => n.id === from);
  const t = DAG_NODES.find((n) => n.id === to);
  if (!f || !t) return null;
  const x1 = f.x + f.w, y1 = f.y + f.h / 2, x2 = t.x, y2 = t.y + t.h / 2;
  return <path d={`M${x1} ${y1} C${x1+40} ${y1} ${x2-40} ${y2} ${x2} ${y2}`}
    fill="none" stroke="#30363d" strokeWidth={1.5} markerEnd="url(#nidArrow)"/>;
}

function DagNodeRect({ node }: { node: typeof DAG_NODES[0] }) {
  const isSrc = !!node.col;
  return (
    <g>
      <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={5}
        fill={isSrc ? `${node.col}1a` : '#21262d'}
        stroke={isSrc ? node.col : '#30363d'} strokeWidth={isSrc ? 1.5 : 1}/>
      <text x={node.x + node.w / 2} y={node.y + node.h / 2 + 4}
        textAnchor="middle" fontSize={11} fill="#e6edf3" fontFamily="JetBrains Mono,monospace">
        {node.label}
      </text>
    </g>
  );
}

export function PlanScreen() {
  const [proj, setProj]   = useState('jwt');
  const [stage, setStage] = useState(2);

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <SecPanel title="Plans" action="+" onAction={() => {}}>
        {PLAN_PROJECTS.map((p) => (
          <div key={p.id} onClick={() => setProj(p.id)} style={{
            padding: '10px 14px', cursor: 'pointer',
            borderLeft: proj === p.id ? '2px solid var(--grn)' : '2px solid transparent',
            background: proj === p.id ? 'var(--bg2)' : 'transparent', transition: 'all 0.15s',
          }}>
            <div style={{ fontSize: 13, color: proj === p.id ? 'var(--t0)' : 'var(--t1)', fontWeight: proj === p.id ? 500 : 400, marginBottom: 5 }}>
              {p.label}
            </div>
            <SBadge s={p.status}/>
          </div>
        ))}
      </SecPanel>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar title="JWT Auth Refactor" sub="4 tasks · stage 3 of 4">
          <Btn small>Export Spec</Btn>
          <Btn small primary>Build →</Btn>
        </TopBar>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--bd)', background: 'var(--bg1)', flexShrink: 0 }}>
          {PLAN_STAGES.map((s, i) => (
            <div key={s} onClick={() => setStage(i)} style={{
              padding: '10px 20px', cursor: 'pointer', fontSize: 13,
              color: stage === i ? 'var(--t0)' : 'var(--t1)',
              borderBottom: stage === i ? '2px solid var(--grn)' : '2px solid transparent',
              transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 7,
            }}>
              <span style={{
                width: 17, height: 17, borderRadius: '50%', fontSize: 9, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: i < stage ? 'var(--grnd)' : i === stage ? 'var(--blu)' : 'var(--bd)',
                color: '#fff', flexShrink: 0,
              }}>
                {i < stage ? '✓' : i + 1}
              </span>
              {s}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {stage === 0 && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--t1)', marginBottom: 16 }}>Interview agent gathering requirements…</p>
              <div style={{ background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--t0)', marginBottom: 10 }}>Requirements gathered</div>
                <ul style={{ color: 'var(--t1)', fontSize: 13, lineHeight: 2.1, margin: 0, paddingLeft: 20 }}>
                  <li>Stateless JWT access tokens (15 min TTL)</li>
                  <li>Refresh tokens — 7-day TTL, stored in httpOnly cookie</li>
                  <li>Rate limiting: 5 req/min per IP on <code style={{ fontFamily: 'var(--mono)', color: 'var(--prp)' }}>/auth/token</code></li>
                  <li>Backward compatible migration path for existing sessions</li>
                </ul>
              </div>
            </div>
          )}
          {stage === 1 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--t0)', marginBottom: 12 }}>Specification Draft</div>
              <div style={{ background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 8, padding: 20, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--t1)', lineHeight: 1.9 }}>
                <div style={{ color: 'var(--t0)', fontWeight: 600, marginBottom: 8, fontSize: 14 }}># JWT Authentication Refactor</div>
                <div style={{ marginBottom: 12 }}>{'## Overview\nReplace session-based auth with stateless JWT. Access tokens expire in 15 min; refresh tokens expire in 7 days and are stored in httpOnly cookies only.'}</div>
                <div style={{ marginBottom: 12 }}>{'## Endpoints\nPOST /auth/token    — issue access + refresh tokens\nPOST /auth/refresh  — exchange refresh for new access token\nDELETE /auth/logout — revoke refresh token'}</div>
                <div>{'## Security\n• Rate limit: 5 req/min per IP on POST /auth/token\n• Refresh tokens in httpOnly cookies — never in response body\n• Short-lived access tokens, fully stateless'}</div>
              </div>
            </div>
          )}
          {stage === 2 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--t0)', marginBottom: 14 }}>Task DAG — 4 tasks across 2 phases</div>
              <div style={{ background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16, overflowX: 'auto', marginBottom: 16 }}>
                <svg width={590} height={234}>
                  <defs>
                    <marker id="nidArrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
                      <path d="M0 0 L0 6 L6 3 z" fill="#30363d"/>
                    </marker>
                  </defs>
                  {DAG_EDGES.map(([f, t], i) => <DagEdgePath key={i} from={f} to={t}/>)}
                  {DAG_NODES.map((n) => <DagNodeRect key={n.id} node={n}/>)}
                </svg>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([
                  ['create_tokens()', 'complete', 'claude-opus-4'],
                  ['JWT middleware',  'running',  'claude-opus-4'],
                  ['Rate limiter',    'pending',  null],
                  ['Refresh endpoint','pending',  null],
                ] as [string, BadgeStatus, string | null][]).map(([label, status, agent], i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 6, padding: '10px 14px' }}>
                    <SBadge s={status}/>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--t0)', flex: 1 }}>{label}</span>
                    <span style={{ fontSize: 11, color: 'var(--t1)' }}>{agent ?? <span style={{ color: '#30363d' }}>unassigned</span>}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stage === 3 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--t0)', marginBottom: 14 }}>Review — 2 reviewers</div>
              {[
                { agent: 'claude-opus-4', verdict: 'approved',          comment: 'JWT implementation looks solid. Consider adding token rotation on refresh.' },
                { agent: 'codex-mini',    verdict: 'changes_requested',  comment: 'Rate limiter is correct but missing Retry-After header.' },
              ].map((r) => (
                <div key={r.agent} style={{ background: 'var(--bg1)', border: `1px solid ${r.verdict === 'approved' ? 'var(--grnd)' : 'var(--yel)'}`, borderRadius: 8, padding: 14, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t0)', fontFamily: 'var(--mono)' }}>{r.agent}</span>
                    <SBadge s={r.verdict as BadgeStatus}/>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--t1)', lineHeight: 1.65 }}>{r.comment}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
