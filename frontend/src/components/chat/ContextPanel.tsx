import { useState } from 'react';
import { useAgentStore } from '@/store/agentStore';

const CTX_FILES_INIT = [
  { name: 'backend/auth.py',     lines: 87,  lang: 'py' },
  { name: 'backend/api/auth.py', lines: 34,  lang: 'py' },
  { name: 'tests/test_auth.py',  lines: 156, lang: 'py' },
];

interface ContextPanelProps {
  onClose: () => void;
}

export function ContextPanel({ onClose }: ContextPanelProps) {
  const [files, setFiles] = useState(CTX_FILES_INIT);
  const memories = useAgentStore((s) => s.memories);

  return (
    <div style={{
      width: 260, flexShrink: 0,
      borderLeft: '1px solid var(--bd)',
      background: 'var(--bg1)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--bd)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t1)', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
          Context
        </span>
        <span onClick={onClose} style={{ cursor: 'pointer', color: 'var(--t1)', fontSize: 13, lineHeight: 1 }}>✕</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Files */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--t1)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Files</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {files.map((f) => (
              <div key={f.name} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 8px', borderRadius: 4, background: 'var(--bg0)', border: '1px solid var(--bd)',
              }}>
                <span style={{
                  fontSize: 9, padding: '1px 5px', background: '#1f6feb18',
                  border: '1px solid #1f6feb33', borderRadius: 2,
                  color: 'var(--blu)', fontFamily: 'var(--mono)', flexShrink: 0,
                }}>{f.lang}</span>
                <span style={{
                  fontSize: 11, color: 'var(--t0)', fontFamily: 'var(--mono)', flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{f.name}</span>
                <span style={{ fontSize: 10, color: 'var(--t1)', flexShrink: 0 }}>{f.lines}L</span>
                <span
                  onClick={() => setFiles((prev) => prev.filter((x) => x.name !== f.name))}
                  style={{ cursor: 'pointer', color: 'var(--t1)', fontSize: 11, flexShrink: 0 }}
                >✕</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--blu)', cursor: 'pointer' }}>+ Add files</div>
        </div>

        {/* Memory */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--t1)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            Memory hits {memories.length > 0 && <span style={{ color: 'var(--blu)' }}>({memories.length})</span>}
          </div>
          {memories.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--t1)', opacity: 0.5, fontStyle: 'italic' }}>
              No memories yet
            </div>
          ) : (
            memories.slice(0, 8).map((m) => (
              <div key={m.id} style={{
                fontSize: 11, color: 'var(--t1)', lineHeight: 1.65,
                padding: '7px 9px', borderRadius: 4, background: 'var(--bg0)',
                border: '1px solid var(--bd)', marginBottom: 4,
              }}>{m.content}</div>
            ))
          )}
        </div>

        {/* Agent */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--t1)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Agent</div>
          <div style={{
            padding: '8px 10px', background: 'var(--bg0)', border: '1px solid var(--bd)',
            borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', background: 'var(--grn)',
              display: 'inline-block', boxShadow: '0 0 5px #3fb950',
              animation: 'nidPulse 2s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 12, color: 'var(--t0)', fontFamily: 'var(--mono)', flex: 1 }}>claude-opus-4</span>
            <span style={{ fontSize: 10, color: 'var(--t1)' }}>active</span>
          </div>
        </div>

        {/* Token usage */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--t1)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Token usage</div>
          <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 5, display: 'flex', justifyContent: 'space-between' }}>
            <span>12,847 / 200,000</span>
            <span style={{ color: 'var(--grn)' }}>6%</span>
          </div>
          <div style={{ height: 4, background: 'var(--bd)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: '6%', height: '100%', background: 'var(--grn)', borderRadius: 2 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
