import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden border border-[#21262d]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-[#21262d]">
        <span className="text-[10px] font-mono text-[#484f58] uppercase tracking-wider">
          {language || "text"}
        </span>
        <button
          onClick={handleCopy}
          className={cn(
            "flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded transition-all",
            copied ? "text-[#3fb950]" : "text-[#484f58] hover:text-[#8b949e]"
          )}
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
    <div className={cn("markdown-body", className)}>
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
                className="font-mono text-[0.8em] px-1.5 py-0.5 rounded bg-[#161b22] border border-[#21262d] text-[#c9d1d9]"
                {...props}
              >
                {children}
              </code>
            );
          },

          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer"
                className="text-[#1f6feb] hover:text-[#1f6feb]/80 underline underline-offset-2 decoration-[#1f6feb]/40 transition-colors">
                {children}
              </a>
            );
          },

          h1({ children }) {
            return <h1 className="text-[15px] font-semibold text-[#e6edf3] mt-4 mb-2 pb-1 border-b border-[#21262d]">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-[14px] font-semibold text-[#e6edf3] mt-3 mb-1.5">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-[13px] font-semibold text-[#e6edf3] mt-2 mb-1">{children}</h3>;
          },

          p({ children }) {
            return <p className="text-[13px] text-[#c9d1d9] leading-[1.65] mb-2 last:mb-0">{children}</p>;
          },

          ul({ children }) {
            return <ul className="my-2 ml-4 space-y-0.5 list-none">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="my-2 ml-4 space-y-0.5 list-decimal list-inside">{children}</ol>;
          },
          li({ children, className: cls }) {
            const isTask = cls?.includes("task-list-item");
            return (
              <li className={cn("text-[13px] text-[#c9d1d9] leading-[1.6] flex items-start gap-2", isTask && "list-none")}>
                {!isTask && <span className="mt-[0.45em] w-1 h-1 rounded-full bg-[#484f58] flex-shrink-0" />}
                <span>{children}</span>
              </li>
            );
          },

          blockquote({ children }) {
            return <blockquote className="my-2 pl-3 border-l-2 border-[#484f58] text-[#8b949e] italic">{children}</blockquote>;
          },

          strong({ children }) {
            return <strong className="font-semibold text-[#e6edf3]">{children}</strong>;
          },
          em({ children }) {
            return <em className="italic text-[#c9d1d9]">{children}</em>;
          },
          del({ children }) {
            return <del className="line-through text-[#484f58]">{children}</del>;
          },

          table({ children }) {
            return (
              <div className="my-3 overflow-x-auto rounded-lg border border-[#21262d]">
                <table className="w-full text-[12px] border-collapse">{children}</table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-[#161b22] text-[#8b949e]">{children}</thead>;
          },
          th({ children }) {
            return <th className="px-3 py-2 text-left font-semibold text-[11px] uppercase tracking-wider border-b border-[#21262d]">{children}</th>;
          },
          td({ children }) {
            return <td className="px-3 py-2 text-[#c9d1d9] border-b border-[#21262d] last:border-0">{children}</td>;
          },
          tr({ children }) {
            return <tr className="hover:bg-[#161b22]/50 transition-colors">{children}</tr>;
          },

          hr() {
            return <hr className="my-4 border-[#21262d]" />;
          },

          input({ type, checked }) {
            if (type === "checkbox") {
              return <input type="checkbox" checked={checked} readOnly className="mr-1.5 mt-0.5 cursor-default" />;
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
