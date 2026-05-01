import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { useAgentStore } from '@/store/agentStore';
import { FileSearchModal } from './FileSearchModal';
import { MemoryHealthWidget } from './MemoryHealthWidget';

function healthOf(pct: number): { state: string; color: string } {
  if (pct >= 85) return { state: 'Blocked', color: 'var(--red)' };
  if (pct >= 75) return { state: 'Compaction Required', color: 'var(--org)' };
  if (pct >= 65) return { state: 'Prepare Compaction', color: 'var(--yel)' };
  if (pct >= 50) return { state: 'At Risk', color: 'var(--yel)' };
  return { state: 'OK', color: 'var(--grn)' };
}

export function WorkingSetTab() {
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [expanded, setExpanded] = useState({ files: true, tokens: true });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const contextUsage = useAgentStore((s) => s.contextUsage);
  const files = useAgentStore((s) => s.workingSetFiles);
  const refreshWorkingSetFiles = useAgentStore((s) => s.refreshWorkingSetFiles);
  const refreshContextUsage = useAgentStore((s) => s.refreshContextUsage);
  const removeWorkingSetFile = useAgentStore((s) => s.removeWorkingSetFile);
  const resourceRevision = useAgentStore((s) => s.resourceRevision);

  useEffect(() => {
    refreshWorkingSetFiles().catch(() => {});
  }, [refreshWorkingSetFiles]);

  useEffect(() => {
    refreshContextUsage().catch(() => {});
  }, [refreshContextUsage, resourceRevision]);

  const model = contextUsage?.model ?? 'Claude Sonnet';
  const currentTokens = contextUsage?.currentTokens ?? 12847;
  const usableTokens = contextUsage?.usableTokens ?? 192000;
  const totalLimit = contextUsage?.totalLimit ?? 200000;
  const accurate = contextUsage?.accurate ?? true;

  const percentage = Math.round((currentTokens / usableTokens) * 100);
  const { state: healthState, color: healthColor } = healthOf(percentage);

  const toggle = (id: 'files' | 'tokens') =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const SectionHeader = ({ id, title }: { id: 'files' | 'tokens'; title: string }) => (
    <div
      onClick={() => toggle(id)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px', background: 'var(--bg2)', borderRadius: 4,
        cursor: 'pointer', marginBottom: 6,
      }}
    >
      <span style={{ fontSize: 10, color: 'var(--t1)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        {title}
      </span>
      <span style={{
        fontSize: 9, color: 'var(--t1)',
        transform: expanded[id] ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s',
        display: 'inline-block',
      }}>▼</span>
    </div>
  );

  const handleFilePick = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    if (!picked.length) return;
    setSelectedPaths(picked.map((file) => (file as File & { path?: string }).path || file.name));
    setShowFileSearch(true);
    event.target.value = '';
  };

  const openFilePicker = async () => {
    try {
      const picked = await window.nidavellir?.pickWorkingSetFiles?.();
      if (picked?.length) {
        setSelectedPaths(picked);
        setShowFileSearch(true);
        return;
      }
    } catch {
      // Fall back to the browser file picker when the Electron bridge is unavailable.
    }
    fileInputRef.current?.click();
  };

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <SectionHeader id="files" title="Files" />
          {expanded.files && (
            <div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                {files.map((f) => (
                  <div key={f.id} data-testid={`working-set-file-${f.id}`} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 8px', borderRadius: 4,
                    background: 'var(--bg0)', border: '1px solid var(--bd)',
                  }}>
                    <span style={{
                      fontSize: 9, padding: '1px 5px',
                      background: '#1f6feb18', border: '1px solid #1f6feb33',
                      borderRadius: 2, color: 'var(--blu)',
                      fontFamily: 'var(--mono)', flexShrink: 0,
                    }}>{f.fileKind === 'image' ? 'img' : 'txt'}</span>
                    <span style={{
                      fontSize: 11, color: 'var(--t0)', fontFamily: 'var(--mono)',
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{f.fileName}</span>
                    <span style={{ fontSize: 10, color: 'var(--t1)', flexShrink: 0 }}>
                      {f.fileKind === 'image'
                        ? 'image attachment'
                        : `~${((f.estimatedTokens ?? 0) / 1000).toFixed(1)}k tokens`}
                    </span>
                    <button
                      aria-label="Remove from Conversation"
                      onClick={() => removeWorkingSetFile(f.id).catch(() => {})}
                      style={{ cursor: 'pointer', color: 'var(--t1)', fontSize: 11, flexShrink: 0, background: 'none', border: 'none' }}
                    >x</button>
                  </div>
                ))}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFilePick}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => { openFilePicker().catch(() => fileInputRef.current?.click()); }}
                style={{ fontSize: 12, color: 'var(--blu)', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
              >
                Add files
              </button>
            </div>
          )}
        </div>

        <div>
          <SectionHeader id="tokens" title="Token Usage" />
          {expanded.tokens && (
            <div>
              <div style={{ fontSize: 9, color: 'var(--t1)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, fontWeight: 600 }}>Model</div>
              <div style={{
                fontSize: 10, color: 'var(--t0)', fontFamily: 'var(--mono)',
                marginBottom: 10, padding: '6px 8px',
                background: 'var(--bg0)', borderRadius: 3, border: '1px solid #30363d22',
              }}>{model}</div>

              <div style={{ fontSize: 9, color: 'var(--t1)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, fontWeight: 600 }}>Usage</div>
              <div style={{ fontSize: 10, color: 'var(--t0)', fontFamily: 'var(--mono)', marginBottom: 3, fontWeight: 600 }}>
                {currentTokens.toLocaleString()} / {usableTokens.toLocaleString()}
              </div>
              <div style={{ fontSize: 9, color: 'var(--t1)', marginBottom: 8 }}>{percentage}%</div>

              <div style={{ height: 5, background: 'var(--bd)', borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
                <div style={{
                  height: '100%', width: `${percentage}%`,
                  background: healthColor, borderRadius: 2, transition: 'width 0.3s',
                }} />
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10,
                padding: '6px 8px', background: `${healthColor}12`, borderRadius: 3,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: healthColor, flexShrink: 0, display: 'inline-block' }} />
                <span style={{ fontSize: 9, color: healthColor, fontWeight: 600 }}>State: {healthState}</span>
              </div>

              <div style={{ fontSize: 9, color: accurate ? 'var(--grn)' : 'var(--red)', display: 'flex', alignItems: 'center', gap: 3, marginBottom: 10 }}>
                <span>{accurate ? '✔' : '✘'}</span>
                <span>{accurate ? 'Accurate' : 'Estimated'}</span>
              </div>

              <div style={{
                fontSize: 8, color: 'var(--t1)', lineHeight: 1.6,
                padding: '8px 10px', background: 'var(--bg0)',
                border: '1px solid #30363d22', borderRadius: 3,
                marginBottom: 10,
              }}>
                <div>Limit: {(totalLimit / 1000).toFixed(0)}k</div>
                <div>Usable: {(usableTokens / 1000).toFixed(0)}k</div>
              </div>

              <button
                onClick={() => window.dispatchEvent(new CustomEvent('nid:navigate', { detail: 'tokens' }))}
                style={{
                  width: '100%', padding: '7px 10px',
                  background: 'var(--bg2)', border: '1px solid var(--bd)',
                  borderRadius: 4, fontSize: 11, color: 'var(--t0)',
                  cursor: 'pointer', fontWeight: 500,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--t1)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--bd)'; }}
              >
                Open Token Usage Dashboard →
              </button>
            </div>
          )}
        </div>

        <MemoryHealthWidget />
      </div>

      {showFileSearch && (
        <FileSearchModal
          paths={selectedPaths}
          onClose={() => setShowFileSearch(false)}
          onAdded={() => refreshWorkingSetFiles().catch(() => {})}
        />
      )}
    </>
  );
}
