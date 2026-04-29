import { useEffect, useState } from 'react';
import { useAgentStore } from '@/store/agentStore';

export interface FilePreviewItem {
  path: string;
  fileName: string;
  fileKind: 'text' | 'image' | 'unsupported';
  sizeBytes: number;
  estimatedTokens?: number;
  lineCount?: number;
  imageWidth?: number;
  imageHeight?: number;
  warning?: string;
}

interface ContextUsagePreview {
  currentTokens: number;
  usableTokens: number;
  percentUsed: number;
  state: string;
}

interface FileAddPreview {
  files: FilePreviewItem[];
  failures?: { path: string; reason: string; message: string }[];
  contextBefore: ContextUsagePreview;
  contextAfter: ContextUsagePreview;
  addedTextTokens: number;
  projectedPercentUsed: number;
  canAdd: boolean;
  blockingReason?: string;
}

interface FileSearchModalProps {
  paths: string[];
  onClose: () => void;
  onAdded: () => void;
}

function formatTokens(tokens?: number): string {
  if (!tokens) return '0';
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
}

function fileDescription(file: FilePreviewItem): string {
  if (file.fileKind === 'image') {
    const dimensions = file.imageWidth && file.imageHeight ? `${file.imageWidth}x${file.imageHeight}` : 'image';
    return `Image · ${dimensions} · ${file.warning || 'vision attachment'}`;
  }
  return `Text · ${file.lineCount ?? 0} lines · ~${formatTokens(file.estimatedTokens)} tokens`;
}

export function FileSearchModal({ paths, onClose, onAdded }: FileSearchModalProps) {
  const activeConversationId = useAgentStore((s) => s.activeConversationId);
  const selectedModel = useAgentStore((s) => s.selectedModel);
  const addWorkingSetFiles = useAgentStore((s) => s.addWorkingSetFiles);
  const [preview, setPreview] = useState<FileAddPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function runPreview() {
      if (!activeConversationId) {
        if (!cancelled) {
          setError('Open a conversation before adding files.');
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setError(null);
      setPreview(null);
      const [provider, ...modelParts] = selectedModel.split(':');
      const model = modelParts.join(':');
      try {
        const resp = await fetch(`http://localhost:7430/api/conversations/${activeConversationId}/files/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths, provider, model }),
        });
        if (!resp.ok) {
          throw new Error(`Preview failed with ${resp.status}`);
        }
        const data = await resp.json();
        if (!cancelled) setPreview(data);
      } catch {
        if (!cancelled) setError('Could not calculate file impact. The files were not added.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    runPreview();
    return () => { cancelled = true; };
  }, [activeConversationId, paths, selectedModel]);

  const handleAdd = async () => {
    const ok = await addWorkingSetFiles(paths);
    if (ok) {
      onAdded();
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add Files"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: '#00000088',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg1)', border: '1px solid var(--bd)',
          borderRadius: 8, padding: 20, width: 460, maxWidth: '90vw',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 14,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t0)' }}>
            Add Files
          </span>
          <button aria-label="Close" onClick={onClose} style={{ cursor: 'pointer', color: 'var(--t1)', fontSize: 14, background: 'none', border: 'none' }}>x</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {(preview?.files ?? paths.map((path) => ({ path, fileName: path.split(/[\\/]/).pop() || path, fileKind: 'text' as const, sizeBytes: 0 }))).map((file) => (
            <div key={file.path} style={{
              padding: '8px 10px',
              borderRadius: 5,
              border: '1px solid var(--bd)',
              background: 'var(--bg0)',
            }}>
              <div style={{ fontSize: 12, color: 'var(--t0)', fontFamily: 'var(--mono)' }}>{file.fileName}</div>
              <div style={{ fontSize: 11, color: 'var(--t1)', marginTop: 3 }}>{fileDescription(file)}</div>
            </div>
          ))}
        </div>

        <div style={{
          padding: 10,
          border: '1px solid var(--bd)',
          borderRadius: 6,
          background: preview?.canAdd === false ? '#f8514914' : 'var(--bg0)',
          marginBottom: 12,
        }}>
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--t1)' }}>Calculating impact...</div>
          ) : error ? (
            <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>
          ) : !preview ? (
            <div style={{ fontSize: 12, color: 'var(--red)' }}>Could not calculate file impact. The files were not added.</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--t0)', marginBottom: 8 }}>
                <span>Current: {preview.contextBefore.percentUsed}%</span>
                <span>After add: {preview.projectedPercentUsed}%</span>
                <span>+{formatTokens(preview.addedTextTokens)} tokens</span>
              </div>
              <div style={{ height: 5, background: 'var(--bd)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, preview.projectedPercentUsed)}%`, background: preview.canAdd ? 'var(--grn)' : 'var(--red)' }} />
              </div>
              {preview.blockingReason && (
                <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 8 }}>
                  {preview.blockingReason}
                </div>
              )}
              {(preview.failures ?? []).map((failure) => (
                <div key={`${failure.path}-${failure.reason}`} style={{ color: 'var(--red)', fontSize: 11, marginTop: 8 }}>
                  {failure.message}
                </div>
              ))}
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px', background: 'var(--bg2)', border: '1px solid var(--bd)',
              borderRadius: 4, fontSize: 12, color: 'var(--t1)', cursor: 'pointer',
            }}
          >Cancel</button>
          <button
            onClick={handleAdd}
            disabled={!preview?.canAdd}
            style={{
              padding: '6px 14px',
              background: preview?.canAdd ? 'var(--blu)' : 'var(--bd)',
              border: 'none',
              borderRadius: 4,
              fontSize: 12,
              color: '#fff',
              cursor: preview?.canAdd ? 'pointer' : 'not-allowed',
              fontWeight: 600,
            }}
          >Add Files</button>
        </div>
      </div>
    </div>
  );
}
