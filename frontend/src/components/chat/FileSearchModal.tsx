import { useState } from 'react';

export interface ContextFile {
  name: string;
  lang: string;
  lines: number;
}

interface FileSearchModalProps {
  onClose: () => void;
  onAddFiles: (files: ContextFile[]) => void;
}

export function FileSearchModal({ onClose, onAddFiles }: FileSearchModalProps) {
  const [query, setQuery] = useState('');

  const handleAdd = () => {
    if (query.trim()) {
      onAddFiles([{ name: query.trim(), lang: query.split('.').pop() ?? 'txt', lines: 0 }]);
    }
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: '#00000088',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg1)', border: '1px solid var(--bd)',
          borderRadius: 8, padding: 20, width: 360, maxWidth: '90vw',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 14,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t0)' }}>
            Search files
          </span>
          <span onClick={onClose} style={{ cursor: 'pointer', color: 'var(--t1)', fontSize: 14 }}>✕</span>
        </div>

        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') onClose(); }}
          placeholder="Type a file path…"
          style={{
            width: '100%', padding: '8px 10px',
            background: 'var(--bg0)', border: '1px solid var(--bd)', borderRadius: 4,
            fontSize: 12, color: 'var(--t0)', outline: 'none', marginBottom: 12,
          }}
        />

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
            style={{
              padding: '6px 14px', background: 'var(--blu)', border: 'none',
              borderRadius: 4, fontSize: 12, color: '#fff', cursor: 'pointer', fontWeight: 600,
            }}
          >Add</button>
        </div>
      </div>
    </div>
  );
}
