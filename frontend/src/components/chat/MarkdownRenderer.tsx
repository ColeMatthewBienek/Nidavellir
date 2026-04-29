import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useAgentStore } from "@/store/agentStore";
import { buildCodePreviewUrl, parseCodeRef, type CodeRef } from "@/lib/liveRefs";

// All structural layout uses inline styles — Tailwind structural classes are broken in this build.
// Colour-only Tailwind classes (text-*, bg-*, border-*) are kept where convenient.

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  return (
    <div style={{
      position: 'relative',
      margin: '12px 0',
      borderRadius: 8,
      overflow: 'hidden',
      border: '1px solid #21262d',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        background: '#161b22',
        borderBottom: '1px solid #21262d',
      }}>
        <span style={{
          fontSize: 10,
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          color: '#484f58',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
        }}>
          {language || "text"}
        </span>
        <button
          onClick={handleCopy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            padding: '2px 8px',
            borderRadius: 4,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: copied ? '#3fb950' : '#484f58',
            transition: 'color 0.15s',
          }}
        >
          {copied ? (
            <>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
              copied
            </>
          ) : (
            <>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
              copy
            </>
          )}
        </button>
      </div>

      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        customStyle={{
          margin:       0,
          padding:      "12px 16px",
          background:   "#0d1117",
          fontSize:     "0.75rem",
          lineHeight:   "1.6",
          borderRadius: 0,
        }}
        codeTagProps={{ style: { fontFamily: '"JetBrains Mono", "Fira Code", monospace' } }}
        wrapLongLines={false}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

type CodePreviewLine = {
  number: number;
  text: string;
  highlighted: boolean;
};

type CodePreview = {
  path: string;
  fileName: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  lines: CodePreviewLine[];
};

function CodePreviewModal({ preview, onClose }: { preview: CodePreview; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Code reference preview"
      style={{
        position: 'fixed',
        inset: 0,
        background: '#010409aa',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(920px, 92vw)',
          maxHeight: '80vh',
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: '0 20px 60px #00000088',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid #30363d', background: '#161b22' }}>
          <span style={{ color: '#e6edf3', fontWeight: 600, fontSize: 12 }}>{preview.fileName}</span>
          <span style={{ color: '#8b949e', fontSize: 11, fontFamily: 'var(--mono)' }}>
            L{preview.startLine}{preview.endLine !== preview.startLine ? `-L${preview.endLine}` : ''}
          </span>
          <span style={{ color: '#484f58', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.path}</span>
          <button
            type="button"
            aria-label="Close code preview"
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 16 }}
          >
            x
          </button>
        </div>
        <pre style={{ margin: 0, maxHeight: '65vh', overflow: 'auto', padding: '10px 0', background: '#0d1117' }}>
          {preview.lines.map((line) => (
            <div
              key={line.number}
              data-testid={line.highlighted ? 'highlighted-code-line' : undefined}
              style={{
                display: 'grid',
                gridTemplateColumns: '64px minmax(0, 1fr)',
                background: line.highlighted ? '#1f6feb24' : 'transparent',
                borderLeft: line.highlighted ? '3px solid #1f6feb' : '3px solid transparent',
                color: '#c9d1d9',
                fontSize: 12,
                lineHeight: 1.6,
                fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              }}
            >
              <span style={{ color: line.highlighted ? '#58a6ff' : '#484f58', textAlign: 'right', paddingRight: 12, userSelect: 'none' }}>{line.number}</span>
              <code style={{ whiteSpace: 'pre', paddingRight: 16 }}>{line.text || ' '}</code>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

function CodeRefLink({ refInfo, children }: { refInfo: CodeRef; children: React.ReactNode }) {
  const base = useAgentStore((state) => state.workingDirectory);
  const [preview, setPreview] = useState<CodePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const childLabel = typeof children === 'string'
    ? children
    : Array.isArray(children)
      ? children.map((child) => typeof child === 'string' ? child : '').join('')
      : refInfo.label;

  const open = useCallback(async () => {
    setError(null);
    window.dispatchEvent(new CustomEvent('nid:code-ref-open', { detail: refInfo }));
    try {
      const response = await fetch(buildCodePreviewUrl(refInfo, base));
      if (!response.ok) throw new Error(`http_${response.status}`);
      const resolvedPreview = await response.json() as CodePreview;
      setPreview(resolvedPreview);
      if (window.nidavellir?.openCodeRef) {
        window.nidavellir.openCodeRef(
          resolvedPreview.path,
          resolvedPreview.startLine,
          resolvedPreview.endLine,
        ).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open reference');
    }
  }, [base, refInfo]);

  return (
    <>
      <button
        type="button"
        aria-label={`Open ${refInfo.kind} reference ${childLabel || refInfo.label}`}
        onClick={open}
        title={refInfo.label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          maxWidth: '100%',
          padding: '1px 6px',
          borderRadius: 4,
          border: '1px solid #1f6feb55',
          background: '#1f6feb16',
          color: '#79c0ff',
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: '0.82em',
          cursor: 'pointer',
          verticalAlign: 'baseline',
        }}
      >
        <span style={{ color: '#58a6ff' }}>{refInfo.kind === 'document' ? 'doc' : 'code'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      </button>
      {error && <span style={{ color: '#f85149', fontSize: 11, marginLeft: 6 }}>{error}</span>}
      {preview && createPortal(<CodePreviewModal preview={preview} onClose={() => setPreview(null)} />, document.body)}
    </>
  );
}

interface MarkdownRendererProps {
  content:    string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        urlTransform={(url) => url}
        components={{
          code({ className: cls, children, ...props }) {
            const match  = /language-(\w+)/.exec(cls ?? "");
            const isBlock = !!match;
            const raw    = String(children).replace(/\n$/, "");

            if (isBlock) {
              return <CodeBlock language={match![1]}>{raw}</CodeBlock>;
            }
            const refInfo = parseCodeRef(raw);
            if (refInfo) {
              return <CodeRefLink refInfo={refInfo}>{raw}</CodeRefLink>;
            }
            return (
              <code
                style={{
                  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                  fontSize: '0.8em',
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: '#161b22',
                  border: '1px solid #21262d',
                  color: '#c9d1d9',
                }}
                {...props}
              >
                {children}
              </code>
            );
          },

          a({ href, children }) {
            const refInfo = href ? parseCodeRef(href) : null;
            if (refInfo) {
              return <CodeRefLink refInfo={refInfo}>{children}</CodeRefLink>;
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#1f6feb',
                  textDecoration: 'underline',
                  textUnderlineOffset: 2,
                  textDecorationColor: '#1f6feb66',
                  transition: 'color 0.15s',
                }}
              >
                {children}
              </a>
            );
          },

          h1({ children }) {
            return (
              <h1 style={{ fontSize: 15, fontWeight: 650, color: '#f0f6fc', marginTop: 14, marginBottom: 7, paddingBottom: 0, borderBottom: 'none', lineHeight: 1.35 }}>
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 style={{ fontSize: 13.5, fontWeight: 650, color: '#f0f6fc', marginTop: 12, marginBottom: 5, lineHeight: 1.35 }}>
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 style={{ fontSize: 13, fontWeight: 650, color: '#f0f6fc', marginTop: 8, marginBottom: 3, lineHeight: 1.35 }}>
                {children}
              </h3>
            );
          },

          p({ children }) {
            return (
              <p style={{ fontSize: 13, color: '#d6dee6', lineHeight: 1.55, margin: '0 0 8px' }}>
                {children}
              </p>
            );
          },

          ul({ children }) {
            return (
              <ul style={{ margin: '6px 0 10px', marginLeft: 16, padding: 0, listStyle: 'none' }}>
                {children}
              </ul>
            );
          },
          ol({ children }) {
            return (
              <ol style={{ margin: '6px 0 10px', marginLeft: 16, paddingLeft: 16, listStyleType: 'decimal' }}>
                {children}
              </ol>
            );
          },
          li({ children, className: cls }) {
            const isTask = cls?.includes("task-list-item");
            return (
              <li style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: 13,
                color: '#d6dee6',
                lineHeight: 1.5,
                listStyle: 'none',
                marginBottom: 5,
              }}>
                {!isTask && (
                  <span style={{
                    marginTop: '0.45em',
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: '#484f58',
                    flexShrink: 0,
                    display: 'inline-block',
                  }} />
                )}
                <span>{children}</span>
              </li>
            );
          },

          blockquote({ children }) {
            return (
              <blockquote style={{
                margin: '8px 0',
                paddingLeft: 12,
                borderLeft: '2px solid #484f58',
                color: '#8b949e',
                fontStyle: 'italic',
              }}>
                {children}
              </blockquote>
            );
          },

          strong({ children }) {
            return <strong style={{ fontWeight: 600, color: '#e6edf3' }}>{children}</strong>;
          },
          em({ children }) {
            return <em style={{ fontStyle: 'italic', color: '#c9d1d9' }}>{children}</em>;
          },
          del({ children }) {
            return <del style={{ textDecoration: 'line-through', color: '#484f58' }}>{children}</del>;
          },

          table({ children }) {
            return (
              <div style={{ margin: '12px 0', overflowX: 'auto', borderRadius: 8, border: '1px solid #21262d' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return <thead style={{ background: '#161b22', color: '#8b949e' }}>{children}</thead>;
          },
          th({ children }) {
            return (
              <th style={{
                padding: '8px 12px',
                textAlign: 'left',
                fontWeight: 600,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderBottom: '1px solid #21262d',
              }}>
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td style={{ padding: '8px 12px', color: '#c9d1d9', borderBottom: '1px solid #21262d' }}>
                {children}
              </td>
            );
          },
          tr({ children }) {
            return <tr>{children}</tr>;
          },

          hr() {
            return <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid #21262d' }} />;
          },

          input({ type, checked }) {
            if (type === "checkbox") {
              return (
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  style={{ marginRight: 6, marginTop: 2, cursor: 'default' }}
                />
              );
            }
            return null;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
