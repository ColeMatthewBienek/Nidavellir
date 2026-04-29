import { useEffect, useMemo, useState } from 'react';
import { WorkingSetTab } from './WorkingSetTab';
import { useAgentStore, type Message } from '@/store/agentStore';
import { buildCompletionReport, formatDuration, type CompletionReport, type CompletionReportFile } from '@/lib/completionReport';
import type { CodeRef } from '@/lib/liveRefs';
import { buildActivityTimeline, type ActivityTimelineBlock, type ActivityTimelineItem } from '@/lib/activityTimeline';

type RightSidebarTab = 'working-set' | 'summary' | 'review' | 'git';

interface RightSidebarProps {
  onClose: () => void;
}

const TABS: Array<{ id: RightSidebarTab; label: string }> = [
  { id: 'working-set', label: 'Working Set' },
  { id: 'summary', label: 'Summary' },
  { id: 'review', label: 'Review' },
  { id: 'git', label: 'Git' },
];

interface GitStatusFile {
  path: string;
  status: string;
}

interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  dirtyCount: number;
  files: GitStatusFile[];
}

interface GitTreeNode {
  name: string;
  path: string;
  children: GitTreeNode[];
  file?: GitStatusFile;
}

interface LocalComment {
  id: string;
  path: string;
  line: number;
  text: string;
}

interface CommentDraft {
  path: string;
  line: number;
  text: string;
}

function EmptySidebarTab({ title, description }: { title: string; description: string }) {
  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ fontSize: 11, color: 'var(--t1)', textTransform: 'uppercase', fontWeight: 700 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: 'var(--t0)', lineHeight: 1.55 }}>
        {description}
      </div>
    </div>
  );
}

function latestCompletionReport(messages: Message[]): CompletionReport | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const report = buildCompletionReport(messages[index]);
    if (report) return report;
  }
  return null;
}

function latestAgentMessage(messages: Message[]): Message | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'agent') return messages[index];
  }
  return null;
}

function matchesReviewPath(filePath: string, refPath?: string): boolean {
  if (!refPath) return false;
  const file = filePath.replace(/\\/g, '/');
  const ref = refPath.replace(/\\/g, '/');
  return file === ref || file.endsWith(`/${ref}`) || ref.endsWith(`/${file}`);
}

function SidebarSectionTitle({ children }: { children: string }) {
  return (
    <div style={{
      fontSize: 11,
      color: 'var(--t1)',
      textTransform: 'uppercase',
      fontWeight: 700,
      letterSpacing: '0.45px',
    }}>
      {children}
    </div>
  );
}

function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path;
}

function buildGitTree(files: GitStatusFile[]): GitTreeNode[] {
  const root: GitTreeNode = { name: '', path: '', children: [] };

  for (const file of files) {
    const parts = file.path.replace(/\\/g, '/').split('/').filter(Boolean);
    let node = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      let child = node.children.find((item) => item.name === part);
      if (!child) {
        child = { name: part, path, children: [] };
        node.children.push(child);
      }
      if (index === parts.length - 1) child.file = file;
      node = child;
    });
  }

  const sortNodes = (nodes: GitTreeNode[]) => {
    nodes.sort((a, b) => {
      if (Boolean(a.file) !== Boolean(b.file)) return a.file ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(root.children);
  return root.children;
}

function filterGitFiles(files: GitStatusFile[], filter: string): GitStatusFile[] {
  const query = filter.trim().toLowerCase();
  if (!query) return files;
  return files.filter((file) => file.path.toLowerCase().includes(query));
}

function toneColor(tone: ActivityTimelineItem['tone']): string {
  if (tone === 'search') return 'var(--blu)';
  if (tone === 'test') return 'var(--grn)';
  if (tone === 'write') return 'var(--yel)';
  if (tone === 'read') return '#8b949e';
  return 'var(--t1)';
}

function SummaryProgressBlock({ block }: { block: ActivityTimelineBlock }) {
  if (block.type === 'steering') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ color: 'var(--t1)', fontSize: 12 }}>↳ Steered conversation</div>
        <div style={{ color: 'var(--t0)', fontSize: 12, lineHeight: 1.45, background: '#30363d66', borderRadius: 8, padding: '7px 9px' }}>
          {block.text}
        </div>
      </div>
    );
  }

  if (block.type === 'narration') {
    return (
      <div style={{ color: 'var(--t0)', fontSize: 13, lineHeight: 1.55, fontWeight: 600 }}>
        {block.text}
      </div>
    );
  }

  if (block.type === 'problem') {
    return (
      <div style={{ borderLeft: '2px solid var(--red)', paddingLeft: 10, color: 'var(--t0)', fontSize: 12, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600 }}>{block.text}</div>
        {block.detail && <div style={{ color: 'var(--t1)', fontFamily: 'var(--mono)', marginTop: 3 }}>{block.detail}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ color: 'var(--t1)', fontSize: 12 }}>{block.label}</div>
      {block.items.slice(0, 6).map((item, index) => (
        <div key={`${block.label}-${item.label}-${index}`} style={{ display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr)', gap: 8, alignItems: 'baseline' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: toneColor(item.tone), display: 'inline-block' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--t0)', fontSize: 12, fontWeight: 600 }}>{item.label}</div>
            {item.detail && (
              <div style={{
                color: 'var(--t1)',
                fontFamily: 'var(--mono)',
                fontSize: 11,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>{item.detail}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SummaryTab({ report, message }: { report: CompletionReport | null; message: Message | null }) {
  const progressBlocks = useMemo(() => message ? buildActivityTimeline(message.events) : [], [message]);

  if (!report && progressBlocks.length === 0) {
    return (
      <EmptySidebarTab
        title="Last Turn Summary"
        description="No build summary yet. When an agent edits files, runs checks, or produces artifacts, this tab will track the turn."
      />
    );
  }

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <SidebarSectionTitle>Progress</SidebarSectionTitle>

      {report ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 9, alignItems: 'baseline' }}>
            <span style={{ color: '#a7a7a7' }}>✓</span>
            <div style={{ color: 'var(--t0)', fontSize: 13, lineHeight: 1.45, fontWeight: 600 }}>
              {report.outcome}
            </div>
          </div>
          {report.changedFiles.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 9, alignItems: 'baseline' }}>
              <span style={{ color: '#a7a7a7' }}>✓</span>
              <div style={{ color: 'var(--t0)', fontSize: 13, lineHeight: 1.45, fontWeight: 600 }}>
                Edited {report.changedFiles.length} {report.changedFiles.length === 1 ? 'file' : 'files'}{' '}
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                  <span style={{ color: 'var(--grn)' }}>+{report.totalAdditions}</span>{' '}
                  <span style={{ color: 'var(--red)' }}>-{report.totalDeletions}</span>
                </span>
              </div>
            </div>
          )}
          {report.verifications.map((verification, index) => (
            <div key={`${verification.command}-${index}`} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 9, alignItems: 'baseline' }}>
              <span style={{ color: verification.status === 'error' ? 'var(--red)' : '#a7a7a7' }}>
                {verification.status === 'error' ? '×' : '✓'}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--t0)', fontSize: 13, lineHeight: 1.45, fontWeight: 600 }}>
                  {verification.summary}
                </div>
                <code style={{
                  display: 'block',
                  marginTop: 3,
                  color: 'var(--t1)',
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>{verification.command}</code>
              </div>
            </div>
          ))}
          <div style={{ color: 'var(--t1)', fontSize: 11, paddingLeft: 27 }}>
            {formatDuration(report.durationMs)}
          </div>
        </div>
      ) : progressBlocks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          {progressBlocks.slice(0, 8).map((block, index) => (
            <SummaryProgressBlock key={`${block.type}-${index}`} block={block} />
          ))}
        </div>
      )}

      <SidebarSectionTitle>Branch Details</SidebarSectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 9, color: 'var(--t0)', fontSize: 13 }}>
          <span style={{ color: 'var(--t1)' }}>◉</span>
          <span>GitHub CLI unavailable</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 9, color: 'var(--t0)', fontSize: 13 }}>
          <span style={{ color: 'var(--t1)' }}>✓</span>
          <span>{report && report.changedFiles.length > 0 ? `${report.changedFiles.length} local ${report.changedFiles.length === 1 ? 'change' : 'changes'}` : 'No changes'}</span>
        </div>
      </div>

      {report && report.changedFiles.length > 0 && (
        <>
          <SidebarSectionTitle>Artifacts</SidebarSectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {report.changedFiles.map((file) => (
              <div key={file.path} style={{ display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr) auto', gap: 8, alignItems: 'center', color: 'var(--t0)', fontSize: 12 }}>
                <span style={{ color: 'var(--t1)' }}>▣</span>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--mono)' }}>{file.path}</span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>
                  <span style={{ color: 'var(--grn)' }}>+{file.additions}</span>{' '}
                  <span style={{ color: 'var(--red)' }}>-{file.deletions}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <SidebarSectionTitle>Sources</SidebarSectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 9, color: 'var(--t0)', fontSize: 13 }}>
        <span style={{ color: 'var(--t1)' }}>◌</span>
        <span>Local workspace</span>
      </div>
    </div>
  );
}

interface ReviewDiffLine {
  line: string;
  oldLine?: number;
  newLine?: number;
  kind: 'hunk' | 'add' | 'remove' | 'context';
}

function parseReviewDiffLines(lines: string[]): ReviewDiffLine[] {
  const parsed: ReviewDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const hunk = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      parsed.push({ line, kind: 'hunk' });
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      parsed.push({ line, newLine, kind: 'add' });
      newLine += 1;
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      parsed.push({ line, oldLine, kind: 'remove' });
      oldLine += 1;
      continue;
    }

    parsed.push({ line, oldLine, newLine, kind: 'context' });
    oldLine += 1;
    newLine += 1;
  }

  return parsed;
}

function isSelectedDiffLine(entry: ReviewDiffLine, ref?: CodeRef): boolean {
  if (!ref?.startLine) return false;
  const startLine = ref.startLine;
  const endLine = ref.endLine ?? startLine;
  const candidate = entry.newLine ?? entry.oldLine;
  return candidate !== undefined && candidate >= startLine && candidate <= endLine;
}

function DiffLine({
  entry,
  selected,
  filePath,
  comments,
  onStartComment,
}: {
  entry: ReviewDiffLine;
  selected?: boolean;
  filePath: string;
  comments: LocalComment[];
  onStartComment: (path: string, line: number) => void;
}) {
  const line = entry.line;
  const added = line.startsWith('+') && !line.startsWith('+++');
  const removed = line.startsWith('-') && !line.startsWith('---');
  const hunk = entry.kind === 'hunk';
  const lineNumber = entry.newLine ?? entry.oldLine;
  const lineComments = lineNumber === undefined ? [] : comments.filter((comment) => comment.path === filePath && comment.line === lineNumber);
  return (
    <div>
      <div
        aria-current={selected ? 'location' : undefined}
        style={{
          display: 'grid',
          gridTemplateColumns: '38px 38px minmax(0, 1fr) 30px',
          background: selected ? '#f0b4292a' : hunk ? '#1f6feb18' : added ? '#23863622' : removed ? '#da363322' : 'transparent',
          borderLeft: `3px solid ${selected ? 'var(--yel)' : hunk ? 'var(--blu)' : added ? 'var(--grn)' : removed ? 'var(--red)' : 'transparent'}`,
          fontFamily: 'var(--mono)',
          fontSize: 11,
          lineHeight: 1.65,
          color: selected ? 'var(--t0)' : hunk ? '#79c0ff' : added ? '#aff5b4' : removed ? '#ffdcd7' : 'var(--t1)',
        }}
      >
        <span
          aria-label={entry.oldLine ? `Old line ${entry.oldLine}` : undefined}
          style={{ color: entry.oldLine ? '#8b949e' : '#30363d', textAlign: 'right', paddingRight: 8, userSelect: 'none' }}
        >
          {entry.oldLine ?? ''}
        </span>
        <span
          aria-label={entry.newLine ? `New line ${entry.newLine}` : undefined}
          style={{ color: entry.newLine ? '#8b949e' : '#30363d', textAlign: 'right', paddingRight: 8, userSelect: 'none' }}
        >
          {entry.newLine ?? ''}
        </span>
        <code style={{ whiteSpace: 'pre', overflowX: 'auto', paddingRight: 8, fontWeight: hunk ? 600 : undefined }}>{line || ' '}</code>
        {lineNumber !== undefined && !hunk ? (
          <button
            type="button"
            aria-label={`Comment on ${filePath} line ${lineNumber}`}
            onClick={() => onStartComment(filePath, lineNumber)}
            style={{
              border: 'none',
              background: 'transparent',
              color: lineComments.length > 0 ? 'var(--yel)' : 'var(--t1)',
              cursor: 'pointer',
              fontSize: 12,
              opacity: lineComments.length > 0 ? 1 : 0.55,
            }}
          >
            ⊕
          </button>
        ) : <span />}
      </div>
      {lineComments.length > 0 && (
        <div style={{ margin: '5px 12px 7px 84px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {lineComments.map((comment) => (
            <div key={comment.id} style={{
              border: '1px solid #8b949e44',
              borderRadius: 6,
              background: '#21262d',
              padding: '7px 9px',
              color: 'var(--t0)',
              fontSize: 12,
              lineHeight: 1.45,
            }}>
              {comment.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewFileRow({
  file,
  selectedRef,
  comments,
  onAddComment,
}: {
  file: CompletionReportFile;
  selectedRef?: CodeRef;
  comments: LocalComment[];
  onAddComment: (comment: Omit<LocalComment, 'id'>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const diffLines = parseReviewDiffLines(file.diffLines);
  const selected = matchesReviewPath(file.path, selectedRef?.path);

  useEffect(() => {
    if (selected) setOpen(true);
  }, [selected]);

  const openInEditor = () => {
    window.nidavellir?.openCodeRef?.(
      file.path,
      selected ? selectedRef?.startLine : undefined,
      selected ? selectedRef?.endLine : undefined,
    ).catch(() => {});
  };

  return (
    <div style={{ borderTop: '1px solid #30363d55' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'stretch',
        background: open ? '#30363d33' : selected ? '#1f6feb12' : 'transparent',
      }}>
        <button
          type="button"
          aria-label={`${open ? 'Collapse' : 'Expand'} diff for ${file.path}`}
          onClick={() => setOpen((value) => !value)}
          style={{
            minWidth: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto auto',
            alignItems: 'center',
            gap: 8,
            padding: '8px 9px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{
            color: 'var(--t0)',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{file.path}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, flexShrink: 0 }}>
            <span style={{ color: 'var(--grn)' }}>+{file.additions}</span>{' '}
            <span style={{ color: 'var(--red)' }}>-{file.deletions}</span>
          </span>
          <span style={{ color: 'var(--t1)', fontSize: 13 }}>{open ? '⌃' : '⌄'}</span>
        </button>
        <button
          type="button"
          aria-label={`Open ${file.path} in editor`}
          title="Open in editor"
          onClick={openInEditor}
          style={{
            border: 'none',
            borderLeft: '1px solid #30363d55',
            background: 'transparent',
            color: 'var(--t1)',
            padding: '0 8px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          ↗
        </button>
      </div>
      {open && (
        <>
          {draft && (
            <div style={{
            margin: '10px 12px',
            border: '1px solid var(--bd)',
            borderRadius: 8,
            background: 'var(--bg2)',
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--t0)', fontSize: 12, fontWeight: 700 }}>
              <span>Local comment</span>
              <span style={{ color: 'var(--t1)', fontWeight: 500 }}>Comment on line R{draft.line}</span>
            </div>
            <textarea
              placeholder="Request change"
              value={draft.text}
              onChange={(event) => setDraft({ ...draft, text: event.target.value })}
              style={{
                width: '100%',
                minHeight: 64,
                resize: 'vertical',
                border: '1px solid #30363d88',
                borderRadius: 6,
                background: 'var(--bg0)',
                color: 'var(--t0)',
                padding: 8,
                fontSize: 12,
                lineHeight: 1.45,
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setDraft(null)} style={{ border: 'none', background: 'transparent', color: 'var(--t1)', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
              <button
                type="button"
                onClick={() => {
                  if (!draft.text.trim()) return;
                  onAddComment({ path: draft.path, line: draft.line, text: draft.text.trim() });
                  setDraft(null);
                }}
                style={{
                  border: '1px solid var(--bd)',
                  borderRadius: 6,
                  background: 'var(--bg2)',
                  color: 'var(--t0)',
                  cursor: draft.text.trim() ? 'pointer' : 'not-allowed',
                  fontSize: 12,
                  padding: '5px 10px',
                }}
              >
                Comment
              </button>
            </div>
            </div>
          )}
          <div style={{
          margin: 0,
          maxHeight: 300,
          overflow: 'auto',
          background: '#0d1117',
          borderTop: '1px solid #30363d55',
          padding: '7px 0',
        }}>
          {diffLines.map((entry, index) => (
            <DiffLine
              key={`${file.path}-${index}`}
              entry={entry}
              selected={selected && isSelectedDiffLine(entry, selectedRef)}
              filePath={file.path}
              comments={comments}
              onStartComment={(path, line) => setDraft({ path, line, text: '' })}
            />
          ))}
          </div>
        </>
      )}
    </div>
  );
}

function ReviewTab({
  report,
  selectedRef,
  comments,
  onAddComment,
}: {
  report: CompletionReport | null;
  selectedRef?: CodeRef;
  comments: LocalComment[];
  onAddComment: (comment: Omit<LocalComment, 'id'>) => void;
}) {
  if (!report || report.changedFiles.length === 0) {
    return (
      <EmptySidebarTab
        title="Changed Files"
        description="This surface will show changed files, additions and deletions, expandable diffs, and open-in-editor actions."
      />
    );
  }

  const fileCount = report.changedFiles.length;

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <SidebarSectionTitle>Changed Files</SidebarSectionTitle>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 10,
        color: 'var(--t1)',
        fontSize: 11,
      }}>
        <span>{fileCount} {fileCount === 1 ? 'file' : 'files'} changed</span>
        <span style={{ fontFamily: 'var(--mono)' }}>
          <span style={{ color: 'var(--grn)' }}>+{report.totalAdditions}</span>{' '}
          <span style={{ color: 'var(--red)' }}>-{report.totalDeletions}</span>
        </span>
      </div>
      <div style={{
        border: '1px solid var(--bd)',
        borderRadius: 7,
        background: 'var(--bg0)',
        overflow: 'hidden',
      }}>
        {report.changedFiles.map((file) => (
          <ReviewFileRow
            key={file.path}
            file={file}
            selectedRef={selectedRef}
            comments={comments}
            onAddComment={onAddComment}
          />
        ))}
      </div>
    </div>
  );
}

function GitTreeRow({
  node,
  depth,
  onReviewFile,
}: {
  node: GitTreeNode;
  depth: number;
  onReviewFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);

  if (node.file) {
    const statusColor = node.file.status === '??' ? 'var(--blu)' : 'var(--yel)';
    return (
      <button
        type="button"
        aria-label={`Review ${node.file.path}`}
        onClick={() => onReviewFile(node.file!.path)}
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '20px minmax(0, 1fr)',
          gap: 8,
          alignItems: 'center',
          padding: '5px 8px',
          paddingLeft: 8 + depth * 17,
          border: 'none',
          background: 'transparent',
          color: 'var(--t0)',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: 12,
        }}
      >
        <span style={{ color: statusColor, fontFamily: 'var(--mono)', fontSize: 10 }}>{node.file.status}</span>
        <span
          title={node.file.path}
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--mono)',
          }}
        >
          {fileName(node.file.path)}
        </span>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        aria-label={`${open ? 'Collapse' : 'Expand'} ${node.path}`}
        onClick={() => setOpen((value) => !value)}
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '14px minmax(0, 1fr)',
          gap: 6,
          alignItems: 'center',
          padding: '5px 8px',
          paddingLeft: 8 + depth * 17,
          border: 'none',
          background: 'transparent',
          color: 'var(--t0)',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: 12,
          fontWeight: 650,
        }}
      >
        <span style={{ color: 'var(--t1)' }}>{open ? '⌄' : '›'}</span>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
      </button>
      {open && (
        <div style={{
          marginLeft: 8 + depth * 17,
          borderLeft: depth >= 0 ? '1px solid #30363d88' : 'none',
          paddingLeft: 4,
        }}>
          {node.children.map((child) => (
            <GitTreeRow key={child.path} node={child} depth={depth + 1} onReviewFile={onReviewFile} />
          ))}
        </div>
      )}
    </div>
  );
}

function GitTab({ onReviewFile }: { onReviewFile: (path: string) => void }) {
  const workingDirectory = useAgentStore((state) => state.workingDirectory);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!workingDirectory) {
      setStatus(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`http://localhost:7430/api/git/status?path=${encodeURIComponent(workingDirectory)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`http_${response.status}`);
        return response.json() as Promise<GitStatus>;
      })
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'git_status_unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workingDirectory]);

  const visibleFiles = status?.files ? filterGitFiles(status.files, filter) : [];
  const tree = buildGitTree(visibleFiles);

  if (!workingDirectory) {
    return (
      <EmptySidebarTab
        title="Git"
        description="Set a working directory to inspect git status for this conversation."
      />
    );
  }

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <SidebarSectionTitle>Git</SidebarSectionTitle>

      {loading && <div style={{ color: 'var(--t1)', fontSize: 12 }}>Loading git status...</div>}
      {error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div>}

      {!loading && status && !status.isRepo && (
        <div style={{
          border: '1px dashed var(--bd)',
          borderRadius: 6,
          padding: 12,
          color: 'var(--t1)',
          fontSize: 12,
          lineHeight: 1.5,
          background: 'var(--bg0)',
        }}>
          This workspace is not a git repository.
        </div>
      )}

      {!loading && status?.isRepo && (
        <>
          <div style={{
            border: '1px solid var(--bd)',
            borderRadius: 7,
            background: 'var(--bg0)',
            padding: 11,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            gap: 8,
            alignItems: 'center',
          }}>
            <span style={{ color: 'var(--t1)', fontSize: 11 }}>Branch</span>
            <code style={{ color: 'var(--t0)', fontFamily: 'var(--mono)', fontSize: 11 }}>{status.branch ?? 'detached'}</code>
            <span style={{ color: 'var(--t1)', fontSize: 11 }}>State</span>
            <span style={{ color: status.dirtyCount > 0 ? 'var(--yel)' : 'var(--grn)', fontSize: 11 }}>
              {status.dirtyCount === 0
                ? 'clean'
                : `${status.dirtyCount} ${status.dirtyCount === 1 ? 'file' : 'files'} changed`}
            </span>
          </div>

          {status.files.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--t0)', fontSize: 13, fontWeight: 700 }}>
                <span>Changed files</span>
                <span style={{ color: 'var(--t1)' }}>{visibleFiles.length}</span>
              </div>
              <input
                aria-label="Filter changed files"
                placeholder="Filter files..."
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                style={{
                  width: '100%',
                  border: '1px solid var(--bd)',
                  borderRadius: 7,
                  background: 'var(--bg2)',
                  color: 'var(--t0)',
                  padding: '8px 10px',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
              <div style={{
                border: '1px solid var(--bd)',
                borderRadius: 7,
                background: 'var(--bg0)',
                padding: '7px 0',
                overflow: 'hidden',
              }}>
                {tree.length === 0 ? (
                  <div style={{ color: 'var(--t1)', fontSize: 12, padding: '8px 10px' }}>No changed files match.</div>
                ) : tree.map((node) => (
                  <GitTreeRow key={node.path} node={node} depth={0} onReviewFile={onReviewFile} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function RightSidebar({ onClose }: RightSidebarProps) {
  const [activeTab, setActiveTab] = useState<RightSidebarTab>('working-set');
  const [selectedReviewRef, setSelectedReviewRef] = useState<CodeRef | undefined>();
  const [comments, setComments] = useState<LocalComment[]>([]);
  const messages = useAgentStore((state) => state.messages);
  const report = latestCompletionReport(messages);
  const latestMessage = latestAgentMessage(messages);
  const addComment = (comment: Omit<LocalComment, 'id'>) => {
    setComments((items) => [...items, { ...comment, id: `${Date.now()}-${items.length}` }]);
  };

  useEffect(() => {
    const onCodeRefOpen = (event: Event) => {
      const detail = (event as CustomEvent<CodeRef>).detail;
      if (!detail?.path) return;
      setSelectedReviewRef(detail);
      setActiveTab('review');
    };
    window.addEventListener('nid:code-ref-open', onCodeRefOpen);
    return () => window.removeEventListener('nid:code-ref-open', onCodeRefOpen);
  }, []);

  return (
    <aside
      aria-label="Right sidebar"
      style={{
        width: 430,
        flexShrink: 0,
        borderLeft: '1px solid var(--bd)',
        background: 'var(--bg1)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <div style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--bd)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--t1)',
          textTransform: 'uppercase',
          letterSpacing: '0.7px',
        }}>
          Workspace
        </span>
        <button
          type="button"
          aria-label="Close right sidebar"
          onClick={onClose}
          style={{
            cursor: 'pointer',
            color: 'var(--t1)',
            fontSize: 13,
            lineHeight: 1,
            border: 'none',
            background: 'transparent',
            padding: 2,
          }}
        >
          ✕
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Right sidebar sections"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 4,
          padding: 8,
          borderBottom: '1px solid var(--bd)',
          background: 'var(--bg0)',
        }}
      >
        {TABS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(tab.id)}
              style={{
                minWidth: 0,
                border: `1px solid ${selected ? 'var(--blu)' : 'transparent'}`,
                background: selected ? '#1f6feb18' : 'transparent',
                color: selected ? 'var(--t0)' : 'var(--t1)',
                borderRadius: 5,
                padding: '5px 6px',
                cursor: 'pointer',
                fontSize: 11,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'working-set' && <WorkingSetTab />}
      {activeTab === 'summary' && <SummaryTab report={report} message={latestMessage} />}
      {activeTab === 'review' && <ReviewTab report={report} selectedRef={selectedReviewRef} comments={comments} onAddComment={addComment} />}
      {activeTab === 'git' && <GitTab onReviewFile={(path) => {
        setSelectedReviewRef({ kind: 'code', path, label: path });
        setActiveTab('review');
      }} />}
    </aside>
  );
}
