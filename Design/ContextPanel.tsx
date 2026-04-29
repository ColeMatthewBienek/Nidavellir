import { useState } from 'react';
import { FileSearchModal } from './FileSearchModal';

// Initial context files for demo
const CTX_FILES_INIT = [
  { name: 'backend/auth.py', lines: 87, lang: 'py' },
  { name: 'backend/api/auth.py', lines: 34, lang: 'py' },
  { name: 'tests/test_auth.py', lines: 156, lang: 'py' },
];

interface ContextFile {
  name: string;
  lang: string;
  lines: number;
}

interface ContextPanelProps {
  onClose: () => void;
}

export function ContextPanel({ onClose }: ContextPanelProps) {
  const [files, setFiles] = useState<ContextFile[]>(CTX_FILES_INIT);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [expanded, setExpanded] = useState({ files: true, tokens: true });

  const handleAddFiles = (newFiles: ContextFile[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const toggleSection = (section: 'files' | 'tokens') => {
    setExpanded((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const SectionHeader = ({ id, title }: { id: 'files' | 'tokens'; title: string }) => (
    <div
      onClick={() => toggleSection(id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 10px',
        background: 'var(--bg2)',
        borderRadius: 4,
        cursor: 'pointer',
        marginBottom: 6,
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: 'var(--t1)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontSize: 9,
          color: 'var(--t1)',
          transform: expanded[id] ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
        }}
      >
        ▼
      </span>
    </div>
  );

  // Token usage state
  const currentModel = 'Claude Sonnet';
  const currentTokens = 12847;
  const usableTokens = 192000;
  const percentage = Math.round((currentTokens / usableTokens) * 100);

  let healthState: string;
  let healthColor: string;
  if (percentage >= 85) {
    healthState = 'Blocked';
    healthColor = 'var(--red)';
  } else if (percentage >= 75) {
    healthState = 'Compaction Required';
    healthColor = '#ff6b35';
  } else if (percentage >= 65) {
    healthState = 'Prepare Compaction';
    healthColor = 'var(--yel)';
  } else if (percentage >= 50) {
    healthState = 'At Risk';
    healthColor = 'var(--yel)';
  } else {
    healthState = 'OK';
    healthColor = 'var(--grn)';
  }

  return (
    <div
      style={{
        width: 260,
        flexShrink: 0,
        borderLeft: '1px solid var(--bd)',
        background: 'var(--bg1)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--bd)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--t1)',
            textTransform: 'uppercase',
            letterSpacing: '0.7px',
          }}
        >
          Context
        </span>
        <span
          onClick={onClose}
          style={{
            cursor: 'pointer',
            color: 'var(--t1)',
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          ✕
        </span>
      </div>

      {/* Scrollable content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* Files Section */}
        <div>
          <SectionHeader id="files" title="Files" />
          {expanded.files && (
            <div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                {files.map((f) => (
                  <div
                    key={f.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 8px',
                      borderRadius: 4,
                      background: 'var(--bg0)',
                      border: '1px solid var(--bd)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        padding: '1px 5px',
                        background: '#1f6feb18',
                        border: '1px solid #1f6feb33',
                        borderRadius: 2,
                        color: 'var(--blu)',
                        fontFamily: 'monospace',
                        flexShrink: 0,
                      }}
                    >
                      {f.lang}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--t0)',
                        fontFamily: 'monospace',
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {f.name}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--t1)',
                        flexShrink: 0,
                      }}
                    >
                      {f.lines}L
                    </span>
                    <span
                      onClick={() => setFiles((prev) => prev.filter((x) => x.name !== f.name))}
                      style={{
                        cursor: 'pointer',
                        color: 'var(--t1)',
                        fontSize: 11,
                        flexShrink: 0,
                      }}
                    >
                      ✕
                    </span>
                  </div>
                ))}
              </div>
              <div
                onClick={() => setShowFileSearch(true)}
                style={{
                  fontSize: 12,
                  color: 'var(--blu)',
                  cursor: 'pointer',
                }}
              >
                + Add files
              </div>
            </div>
          )}
        </div>

        {/* Token Usage Section */}
        <div>
          <SectionHeader id="tokens" title="Token Usage" />
          {expanded.tokens && (
            <div>
              {/* Model */}
              <div
                style={{
                  fontSize: 9,
                  color: 'var(--t1)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: 4,
                  fontWeight: 600,
                }}
              >
                Model
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--t0)',
                  fontFamily: 'monospace',
                  marginBottom: 10,
                  padding: '6px 8px',
                  background: 'var(--bg0)',
                  borderRadius: 3,
                  border: '1px solid #30363d22',
                }}
              >
                {currentModel}
              </div>

              {/* Context Usage */}
              <div
                style={{
                  fontSize: 9,
                  color: 'var(--t1)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: 4,
                  fontWeight: 600,
                }}
              >
                Context
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--t0)',
                  fontFamily: 'monospace',
                  marginBottom: 3,
                  fontWeight: 600,
                }}
              >
                {currentTokens.toLocaleString()} / {usableTokens.toLocaleString()}
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: 'var(--t1)',
                  marginBottom: 8,
                }}
              >
                {percentage}%
              </div>

              {/* Context Bar */}
              <div
                style={{
                  height: 5,
                  background: 'var(--bd)',
                  borderRadius: 2,
                  overflow: 'hidden',
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${percentage}%`,
                    background: healthColor,
                    borderRadius: 2,
                    transition: 'width 0.3s',
                  }}
                />
              </div>

              {/* Health State */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  marginBottom: 10,
                  padding: '6px 8px',
                  background: `${healthColor}12`,
                  borderRadius: 3,
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: healthColor,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 9,
                    color: healthColor,
                    fontWeight: 600,
                  }}
                >
                  State: {healthState}
                </span>
              </div>

              {/* Accuracy */}
              <div
                style={{
                  fontSize: 9,
                  color: 'var(--grn)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  marginBottom: 10,
                }}
              >
                <span>✔</span>
                <span>Accurate</span>
              </div>

              {/* Context Limits */}
              <div
                style={{
                  fontSize: 8,
                  color: 'var(--t1)',
                  lineHeight: 1.6,
                  padding: '8px 10px',
                  background: 'var(--bg0)',
                  border: '1px solid #30363d22',
                  borderRadius: 3,
                }}
              >
                <div>Limit: 200k</div>
                <div>Usable: 192k</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Memory Health Widget — Fixed Bottom */}
      <div
        style={{
          padding: 10,
          background: 'var(--bg0)',
          border: '1px solid #d2992244',
          borderRadius: 4,
          borderTop: '1px solid var(--bd)',
          margin: 12,
          marginTop: 0,
        }}
      >
        <div
          style={{
            fontSize: 9,
            color: 'var(--yel)',
            fontWeight: 600,
            marginBottom: 6,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          🔥 Status • WARNING
        </div>
        <div
          style={{
            fontSize: 10,
            color: 'var(--t1)',
            marginBottom: 8,
            fontFamily: 'monospace',
            lineHeight: 1.6,
          }}
        >
          <div>Active: 40 | 2.5h: 44</div>
          <div>Fails: 0 | Unused: 32</div>
        </div>
        <button
          style={{
            width: '100%',
            padding: '6px 10px',
            background: 'var(--bg2)',
            border: '1px solid var(--bd)',
            borderRadius: 3,
            fontSize: 10,
            color: 'var(--t0)',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Inspect Dashboard →
        </button>
      </div>

      {/* File Search Modal */}
      {showFileSearch && (
        <FileSearchModal
          onClose={() => setShowFileSearch(false)}
          onAddFiles={handleAddFiles}
        />
      )}
    </div>
  );
}
