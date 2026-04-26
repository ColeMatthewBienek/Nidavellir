import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

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

interface MarkdownRendererProps {
  content:    string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        components={{
          code({ className: cls, children, ...props }) {
            const match  = /language-(\w+)/.exec(cls ?? "");
            const isBlock = !!match;
            const raw    = String(children).replace(/\n$/, "");

            if (isBlock) {
              return <CodeBlock language={match![1]}>{raw}</CodeBlock>;
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
              <h1 style={{ fontSize: 15, fontWeight: 600, color: '#e6edf3', marginTop: 16, marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #21262d' }}>
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3', marginTop: 12, marginBottom: 6 }}>
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginTop: 8, marginBottom: 4 }}>
                {children}
              </h3>
            );
          },

          p({ children }) {
            return (
              <p style={{ fontSize: 13, color: '#c9d1d9', lineHeight: 1.65, marginBottom: 8 }}>
                {children}
              </p>
            );
          },

          ul({ children }) {
            return (
              <ul style={{ margin: '8px 0', marginLeft: 16, padding: 0, listStyle: 'none' }}>
                {children}
              </ul>
            );
          },
          ol({ children }) {
            return (
              <ol style={{ margin: '8px 0', marginLeft: 16, paddingLeft: 16, listStyleType: 'decimal' }}>
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
                color: '#c9d1d9',
                lineHeight: 1.6,
                listStyle: 'none',
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
