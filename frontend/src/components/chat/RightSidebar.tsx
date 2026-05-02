import { useEffect, useMemo, useState } from 'react';
import { WorkingSetTab } from './WorkingSetTab';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useAgentStore, type Message } from '@/store/agentStore';
import { buildCompletionReport, formatDuration, parseDiffFiles, type CompletionReport, type CompletionReportFile } from '@/lib/completionReport';
import type { CodeRef } from '@/lib/liveRefs';
import { buildActivityTimeline, type ActivityTimelineBlock, type ActivityTimelineItem } from '@/lib/activityTimeline';

type RightSidebarTab = 'working-set' | 'summary' | 'review' | 'instructions' | 'commands' | 'audit' | 'git';
type InstructionViewMode = 'edit' | 'preview';
type ReviewScope = 'last-turn' | 'unstaged' | 'staged' | 'branch';

interface RightSidebarProps {
  onClose: () => void;
}

const TABS: Array<{ id: RightSidebarTab; label: string }> = [
  { id: 'working-set', label: 'Working Set' },
  { id: 'summary', label: 'Summary' },
  { id: 'review', label: 'Review' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'commands', label: 'Commands' },
  { id: 'audit', label: 'Audit' },
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

interface GitDiffResponse {
  isRepo: boolean;
  scope: ReviewScope;
  file: string | null;
  diff: string;
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

interface ProjectInstructionItem {
  name: string;
  path: string;
  content: string;
  scope: string;
  token_estimate: number;
  metadata: Record<string, unknown>;
}

interface ProjectInstructionSuppression {
  name: string;
  path: string;
  scope: string;
  reason: string;
  duplicate_of?: string | null;
  metadata: Record<string, unknown>;
}

interface EditableInstructionFile {
  name: string;
  path: string;
  exists: boolean;
  content: string;
  sizeBytes: number;
  modifiedAt?: number | null;
  scope?: 'global' | 'project';
}

interface ProjectInstructionResponse {
  workspace: string;
  provider?: string | null;
  instructions: ProjectInstructionItem[];
  discovered: ProjectInstructionItem[];
  suppressed: ProjectInstructionSuppression[];
  renderedText: string;
  tokenEstimate: number;
  editableFiles: EditableInstructionFile[];
}

interface PermissionEvaluationResult {
  action: string;
  decision: 'allow' | 'deny' | 'ask' | 'allow_once' | 'allow_for_conversation' | 'allow_for_project';
  reason: string;
  path?: string | null;
  normalized_path?: string | null;
  protected: boolean;
  outside_workspace: boolean;
  matched_rule?: string | null;
  requires_user_choice: boolean;
}

interface CommandRun {
  id: string;
  conversation_id?: string | null;
  command: string;
  cwd: string;
  exit_code?: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  include_in_chat: boolean;
  added_to_working_set: boolean;
  duration_ms: number;
  created_at: string;
}

interface CommandRunEvent {
  type: 'started' | 'output' | 'finished';
  run_id: string;
  conversation_id?: string | null;
  command: string;
  cwd: string;
  stream?: 'stdout' | 'stderr';
  content?: string;
  exit_code?: number | null;
  timed_out?: boolean;
  duration_ms?: number;
}

interface CommandPreset {
  id: string;
  label: string;
  command: string;
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

function AuditTab() {
  const activeConversationId = useAgentStore((state) => state.activeConversationId);
  const messages = useAgentStore((state) => state.messages);
  const workingSetFiles = useAgentStore((state) => state.workingSetFiles);

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <SidebarSectionTitle>Audit Bundle</SidebarSectionTitle>
      <div style={{ fontSize: 12, color: 'var(--t0)', lineHeight: 1.55 }}>
        Export this conversation as a reviewable evidence bundle with a manifest, messages, working-set metadata, permission decisions, command records, instruction diagnostics, and skill inventory metadata.
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 8,
      }}>
        <div style={{ border: '1px solid var(--bd)', borderRadius: 7, padding: 10, background: 'var(--bg0)' }}>
          <div style={{ color: 'var(--t1)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>Messages</div>
          <div style={{ color: 'var(--t0)', fontSize: 18, fontWeight: 750, marginTop: 3 }}>{messages.length}</div>
        </div>
        <div style={{ border: '1px solid var(--bd)', borderRadius: 7, padding: 10, background: 'var(--bg0)' }}>
          <div style={{ color: 'var(--t1)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>Working Set</div>
          <div style={{ color: 'var(--t0)', fontSize: 18, fontWeight: 750, marginTop: 3 }}>{workingSetFiles.length}</div>
        </div>
      </div>
      <div style={{
        border: '1px solid var(--bd)',
        borderRadius: 7,
        padding: 10,
        color: 'var(--t1)',
        fontSize: 11,
        lineHeight: 1.5,
        background: 'var(--bg0)',
      }}>
        Command output, memory snapshots, instruction file contents, and skill instruction text are redacted by default. The export dialog lets you opt into each sensitive section.
      </div>
      <button
        type="button"
        disabled={!activeConversationId}
        onClick={() => window.dispatchEvent(new CustomEvent('nid:audit-export-open'))}
        style={{
          border: '1px solid var(--bd)',
          borderRadius: 6,
          background: activeConversationId ? '#23863633' : 'transparent',
          color: activeConversationId ? 'var(--t0)' : 'var(--t1)',
          cursor: activeConversationId ? 'pointer' : 'not-allowed',
          padding: '8px 11px',
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        Export Audit Bundle
      </button>
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

function completionReports(messages: Message[]): CompletionReport[] {
  const reports: CompletionReport[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const report = buildCompletionReport(messages[index]);
    if (report) reports.push(report);
  }
  return reports;
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

function fileIcon(path: string): { label: string; color: string } {
  const lower = path.toLowerCase();
  if (/\.(tsx|jsx)$/.test(lower)) return { label: '⚛', color: '#61dafb' };
  if (/\.py$/.test(lower)) return { label: 'Py', color: '#74c0fc' };
  if (/\.(ts|js)$/.test(lower)) return { label: 'TS', color: '#58a6ff' };
  if (/\.md$/.test(lower)) return { label: 'Md', color: '#a5d6ff' };
  if (/(^|\/)\.github(\/|$)/.test(lower)) return { label: 'GH', color: '#c9d1d9' };
  if (/(^|\/)(package-lock\.json|package\.json)$/.test(lower)) return { label: 'npm', color: '#f85149' };
  if (/\.(json|toml|ya?ml)$/.test(lower)) return { label: '{}', color: '#d29922' };
  return { label: '□', color: 'var(--t1)' };
}

function scopeLabel(scope: ReviewScope): string {
  if (scope === 'last-turn') return 'Last turn';
  if (scope === 'unstaged') return 'Unstaged';
  if (scope === 'staged') return 'Staged';
  return 'Branch';
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

function compactDirectoryNode(node: GitTreeNode): GitTreeNode {
  let current = node;
  let name = node.name;
  while (!current.file && current.children.length === 1 && !current.children[0].file) {
    current = current.children[0];
    name = `${name}/${current.name}`;
  }
  if (current === node) return node;
  return {
    ...current,
    name,
    path: current.path,
  };
}

function toneColor(tone: ActivityTimelineItem['tone']): string {
  if (tone === 'search') return 'var(--blu)';
  if (tone === 'test') return 'var(--grn)';
  if (tone === 'write') return 'var(--yel)';
  if (tone === 'read') return '#8b949e';
  return 'var(--t1)';
}

function openActivityPath(item: ActivityTimelineItem) {
  if (!item.path) return;
  window.dispatchEvent(new CustomEvent('nid:code-ref-open', {
    detail: { kind: 'code', path: item.path, label: item.path, reviewScope: 'last-turn' },
  }));
  window.dispatchEvent(new CustomEvent('nid:workspace-tab', { detail: 'review' }));
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
        <div key={`${block.label}-${item.label}-${index}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'baseline' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--t1)', fontSize: 12, lineHeight: 1.45 }}>
              {item.path && item.tone === 'write' ? (
                <button
                  type="button"
                  onClick={() => openActivityPath(item)}
                  style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0, font: 'inherit', textAlign: 'left' }}
                >
                  <span>{item.label.replace(/\s+\S+$/, ' ')}</span>
                  <span style={{ color: 'var(--blu)' }}>{item.detail ?? item.path}</span>
                </button>
              ) : (
                item.label
              )}
              {item.additions !== undefined && (
                <span style={{ marginLeft: 6, fontFamily: 'var(--mono)' }}>
                  <span style={{ color: 'var(--grn)' }}>+{item.additions}</span>{' '}
                  <span style={{ color: 'var(--red)' }}>-{item.deletions ?? 0}</span>
                </span>
              )}
            </div>
            {item.detail && !(item.path && item.tone === 'write') && (
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
          {item.status === 'running' && <span style={{ color: toneColor(item.tone), fontSize: 10 }}>Running</span>}
        </div>
      ))}
    </div>
  );
}

function SummaryTab({ reports, message }: { reports: CompletionReport[]; message: Message | null }) {
  const report = reports[0] ?? null;
  const progressBlocks = useMemo(() => message ? buildActivityTimeline(message.events) : [], [message]);

  if (reports.length === 0 && progressBlocks.length === 0) {
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

      {reports.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reports.slice(0, 6).map((item, index) => (
            <div key={`${item.outcome}-${index}`} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 9, alignItems: 'baseline' }}>
              <span style={{ color: '#a7a7a7' }}>✓</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--t0)', fontSize: 13, lineHeight: 1.45, fontWeight: 600 }}>
                  {item.outcome}
                </div>
                <div style={{ color: 'var(--t1)', fontSize: 11, marginTop: 3 }}>
                  {formatDuration(item.durationMs)}
                  {item.changedFiles.length > 0 && (
                    <span style={{ fontFamily: 'var(--mono)', marginLeft: 8 }}>
                      {item.changedFiles.length} {item.changedFiles.length === 1 ? 'file' : 'files'} ·{' '}
                      <span style={{ color: 'var(--grn)' }}>+{item.totalAdditions}</span>{' '}
                      <span style={{ color: 'var(--red)' }}>-{item.totalDeletions}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
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
                <span style={{ color: fileIcon(file.path).color, fontSize: 12 }}>{fileIcon(file.path).label}</span>
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
  scope,
  onScopeChange,
  selectedRef,
  comments,
  onAddComment,
}: {
  report: CompletionReport | null;
  scope: ReviewScope;
  onScopeChange: (scope: ReviewScope) => void;
  selectedRef?: CodeRef;
  comments: LocalComment[];
  onAddComment: (comment: Omit<LocalComment, 'id'>) => void;
}) {
  const workingDirectory = useAgentStore((state) => state.workingDirectory);
  const [menuOpen, setMenuOpen] = useState(false);
  const [gitFiles, setGitFiles] = useState<CompletionReportFile[]>([]);
  const [gitError, setGitError] = useState<string | null>(null);
  const [loadingGitDiff, setLoadingGitDiff] = useState(false);

  useEffect(() => {
    if (scope === 'last-turn') return;
    if (!workingDirectory) {
      setGitFiles([]);
      setGitError('Set a working directory to review git changes.');
      return;
    }

    const params = new URLSearchParams({ path: workingDirectory, scope });
    if (selectedRef?.path && scope === 'unstaged') params.set('file', selectedRef.path);
    let cancelled = false;
    setLoadingGitDiff(true);
    setGitError(null);
    fetch(`http://localhost:7430/api/git/diff?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`git_diff_${response.status}`);
        return response.json() as Promise<GitDiffResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setGitFiles(data.isRepo ? parseDiffFiles(data.diff) : []);
      })
      .catch((err) => {
        if (!cancelled) setGitError(err instanceof Error ? err.message : 'git_diff_unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoadingGitDiff(false);
      });

    return () => {
      cancelled = true;
    };
  }, [scope, workingDirectory, selectedRef?.path]);

  const changedFiles = scope === 'last-turn' ? (report?.changedFiles ?? []) : gitFiles;
  const totalAdditions = changedFiles.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = changedFiles.reduce((sum, file) => sum + file.deletions, 0);

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          aria-label="Review scope"
          onClick={() => setMenuOpen((value) => !value)}
          style={{
            border: '1px solid #30363d88',
            borderRadius: 8,
            background: '#30363d66',
            color: 'var(--t0)',
            fontSize: 12,
            fontWeight: 650,
            padding: '6px 10px',
            cursor: 'pointer',
          }}
        >
          {scopeLabel(scope)}⌄
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label="Review scope options"
            style={{
              position: 'absolute',
              top: 34,
              left: 0,
              zIndex: 20,
              width: 170,
              border: '1px solid #30363d88',
              borderRadius: 9,
              background: '#2b2b2b',
              boxShadow: '0 12px 28px #00000066',
              padding: 6,
            }}
          >
            {(['unstaged', 'staged', 'branch', 'last-turn'] as ReviewScope[]).map((item) => (
              <button
                key={item}
                type="button"
                role="menuitem"
                onClick={() => {
                  onScopeChange(item);
                  setMenuOpen(false);
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  border: 'none',
                  borderRadius: 6,
                  background: item === scope ? '#3a3a3a' : 'transparent',
                  color: 'var(--t0)',
                  cursor: 'pointer',
                  padding: '7px 8px',
                  fontSize: 12,
                  textAlign: 'left',
                }}
              >
                <span>{scopeLabel(item)}</span>
                {item === scope && <span style={{ color: 'var(--t1)' }}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {changedFiles.length > 0 && (
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
          <span style={{ color: 'var(--grn)' }}>+{totalAdditions}</span>{' '}
          <span style={{ color: 'var(--red)' }}>-{totalDeletions}</span>
        </span>
      )}
    </div>
  );

  if (changedFiles.length === 0) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {header}
        <EmptySidebarTab
          title="Changed Files"
          description={loadingGitDiff ? 'Loading git diff...' : gitError ?? 'No changed files for this review scope.'}
        />
      </div>
    );
  }

  const fileCount = changedFiles.length;

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {header}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 10,
        color: 'var(--t1)',
        fontSize: 11,
      }}>
        <span>{fileCount} {fileCount === 1 ? 'file' : 'files'} changed</span>
      </div>
      <div style={{
        border: '1px solid var(--bd)',
        borderRadius: 7,
        background: 'var(--bg0)',
        overflow: 'hidden',
      }}>
        {changedFiles.map((file) => (
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
  selectedPath,
}: {
  node: GitTreeNode;
  depth: number;
  onReviewFile: (path: string) => void;
  selectedPath?: string;
}) {
  const [open, setOpen] = useState(true);
  const displayNode = node.file ? node : compactDirectoryNode(node);

  if (displayNode.file) {
    const icon = fileIcon(displayNode.file.path);
    const selected = selectedPath === displayNode.file.path;
    return (
      <button
        type="button"
        aria-label={`Review ${displayNode.file.path}`}
        onClick={() => onReviewFile(displayNode.file!.path)}
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '20px minmax(0, 1fr)',
          gap: 8,
          alignItems: 'center',
          padding: '4px 7px',
          paddingLeft: 7 + depth * 13,
          border: '1px solid transparent',
          borderRadius: 6,
          background: selected ? '#2a2a2a' : 'transparent',
          color: 'var(--t0)',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: 12,
        }}
      >
        <span
          aria-label={`${icon.label} file icon`}
          style={{
            color: icon.color,
            fontFamily: icon.label.length > 1 ? 'var(--mono)' : undefined,
            fontSize: icon.label.length > 2 ? 9 : 13,
            textAlign: 'center',
          }}
        >
          {icon.label}
        </span>
        <span
          title={displayNode.file.path}
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--sans)',
          }}
        >
          {fileName(displayNode.file.path)}
        </span>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        aria-label={`${open ? 'Collapse' : 'Expand'} ${displayNode.path}`}
        onClick={() => setOpen((value) => !value)}
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '14px minmax(0, 1fr)',
          gap: 5,
          alignItems: 'center',
          padding: '4px 7px',
          paddingLeft: 7 + depth * 13,
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
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayNode.name}</span>
      </button>
      {open && (
        <div style={{
          marginLeft: 7 + depth * 13,
          borderLeft: depth >= 0 ? '1px solid #30363d88' : 'none',
          paddingLeft: 3,
        }}>
          {displayNode.children.map((child) => (
            <GitTreeRow key={child.path} node={child} depth={depth + 1} onReviewFile={onReviewFile} selectedPath={selectedPath} />
          ))}
        </div>
      )}
    </div>
  );
}

function GitTab({ onReviewFile, selectedPath }: { onReviewFile: (path: string) => void; selectedPath?: string }) {
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
                padding: '5px 4px',
                overflow: 'hidden',
              }}>
                {tree.length === 0 ? (
                  <div style={{ color: 'var(--t1)', fontSize: 12, padding: '8px 10px' }}>No changed files match.</div>
                ) : tree.map((node) => (
                  <GitTreeRow key={node.path} node={node} depth={0} onReviewFile={onReviewFile} selectedPath={selectedPath} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function instructionRoleLabel(file: EditableInstructionFile, provider: string): string {
  const scope = file.scope === 'global' ? 'global' : 'project';
  if (file.name === 'NIDAVELLIR.md') return 'Nidavellir runtime';
  if (file.name === 'PROJECT.md') return 'Project scoped';
  if (file.name === 'AGENTS.md') return provider === 'codex' ? `Codex ${scope} active` : `Codex ${scope}`;
  if (file.name === 'CLAUDE.md') return provider === 'claude' || provider === 'anthropic' ? `Claude ${scope} active` : `Claude ${scope}`;
  return 'Instruction';
}

function instructionStatus(file: EditableInstructionFile, data: ProjectInstructionResponse | null): { label: string; color: string } {
  if (!data) return { label: file.exists ? 'Found' : 'Missing', color: file.exists ? 'var(--t1)' : '#8b949e' };
  if (data.instructions.some((item) => item.path === file.path)) return { label: 'Active', color: 'var(--grn)' };
  const suppressed = data.suppressed.find((item) => item.path === file.path);
  if (suppressed?.reason === 'duplicate_content') return { label: 'Duplicate', color: 'var(--yel)' };
  if (suppressed?.reason === 'provider_mismatch') return { label: 'Inactive', color: 'var(--t1)' };
  return { label: file.exists ? 'Available' : 'Missing', color: file.exists ? 'var(--t1)' : '#8b949e' };
}

function PermissionGate({
  permission,
  onAllowOnce,
  onDeny,
  busy,
}: {
  permission: PermissionEvaluationResult;
  onAllowOnce: () => void;
  onDeny: () => void;
  busy?: boolean;
}) {
  return (
    <div
      role="alert"
      style={{
        border: '1px solid #f0b42966',
        borderRadius: 7,
        background: '#f0b42914',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
      }}
    >
      <div style={{ color: 'var(--t0)', fontSize: 12, fontWeight: 700 }}>Permission required</div>
      <div style={{ color: 'var(--t1)', fontSize: 12, lineHeight: 1.45 }}>
        {permission.reason}
        {permission.matched_rule && <span> ({permission.matched_rule})</span>}
      </div>
      {permission.normalized_path && (
        <code style={{
          color: 'var(--t1)',
          fontFamily: 'var(--mono)',
          fontSize: 11,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {permission.normalized_path}
        </code>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          onClick={onDeny}
          disabled={busy}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--t1)',
            cursor: busy ? 'not-allowed' : 'pointer',
            fontSize: 12,
          }}
        >
          Deny
        </button>
        <button
          type="button"
          onClick={onAllowOnce}
          disabled={busy}
          style={{
            border: '1px solid var(--bd)',
            borderRadius: 6,
            background: '#23863633',
            color: 'var(--t0)',
            cursor: busy ? 'not-allowed' : 'pointer',
            fontSize: 12,
            padding: '5px 10px',
            fontWeight: 650,
          }}
        >
          Allow once
        </button>
      </div>
    </div>
  );
}

function ProjectInstructionsTab() {
  const workingDirectory = useAgentStore((state) => state.workingDirectory);
  const selectedProvider = useAgentStore((state) => state.selectedProvider);
  const resourceRevision = useAgentStore((state) => state.resourceRevision);
  const markResourcesChanged = useAgentStore((state) => state.markResourcesChanged);
  const [data, setData] = useState<ProjectInstructionResponse | null>(null);
  const [selectedName, setSelectedName] = useState<string>('NIDAVELLIR.md');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PermissionEvaluationResult | null>(null);
  const [viewMode, setViewMode] = useState<InstructionViewMode>('edit');

  const selectedFile = data?.editableFiles.find((file) => file.name === selectedName) ?? data?.editableFiles[0] ?? null;

  const load = () => {
    if (!workingDirectory) {
      setData(null);
      setError(null);
      return;
    }
    const params = new URLSearchParams({ workspace: workingDirectory, provider: selectedProvider || 'claude' });
    setLoading(true);
    setError(null);
    fetch(`http://localhost:7430/api/project-instructions?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`project_instructions_${response.status}`);
        return response.json() as Promise<ProjectInstructionResponse>;
      })
      .then((body) => {
        setData(body);
        const current = body.editableFiles.find((file) => file.name === selectedName) ?? body.editableFiles[0] ?? null;
        if (current) {
          setSelectedName(current.name);
          setDraft(current.content);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'project_instructions_unavailable'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingDirectory, selectedProvider, resourceRevision]);

  useEffect(() => {
    if (selectedFile) setDraft(selectedFile.content);
  }, [selectedFile?.path]);

  const persist = (permissionOverride?: 'allow_once') => {
    if (!workingDirectory || !selectedFile) return;
    setSaving(true);
    setError(null);
    fetch('http://localhost:7430/api/project-instructions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace: workingDirectory,
        filename: selectedFile.name,
        path: selectedFile.path,
        content: draft,
        provider: selectedProvider || 'claude',
        permissionOverride,
      }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = body?.detail;
          throw new Error(typeof detail === 'string' ? detail : detail?.code ?? `project_instruction_save_${response.status}`);
        }
        return body as ProjectInstructionResponse;
      })
      .then((body) => {
        setPendingPermission(null);
        setData(body);
        const current = body.editableFiles.find((file) => file.name === selectedFile.name);
        if (current) setDraft(current.content);
        markResourcesChanged('Project instructions reloaded');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'project_instruction_save_failed'))
      .finally(() => setSaving(false));
  };

  const save = () => {
    if (!workingDirectory || !selectedFile) return;
    setSaving(true);
    setError(null);
    setPendingPermission(null);
    fetch('http://localhost:7430/api/permissions/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'file_write',
        actor: 'user',
        path: selectedFile.path,
        workspace: workingDirectory,
        metadata: { source: 'project_instructions.write', filename: selectedFile.name },
      }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`permission_evaluate_${response.status}`);
        return body as PermissionEvaluationResult;
      })
      .then((permission) => {
        if (permission.decision === 'ask') {
          setPendingPermission(permission);
          return;
        }
        if (permission.decision === 'deny') {
          setError(permission.reason || 'permission_denied');
          return;
        }
        persist();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'permission_evaluate_failed'))
      .finally(() => setSaving(false));
  };

  if (!workingDirectory) {
    return (
      <EmptySidebarTab
        title="Project Instructions"
        description="Set a working directory to inspect instruction files for this conversation."
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <SidebarSectionTitle>Project Instructions</SidebarSectionTitle>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          style={{
            border: '1px solid var(--bd)',
            borderRadius: 6,
            background: 'var(--bg2)',
            color: 'var(--t0)',
            cursor: loading ? 'not-allowed' : 'pointer',
            padding: '5px 8px',
            fontSize: 11,
          }}
        >
          Reload
        </button>
      </div>

      {error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div>}
      {loading && <div style={{ color: 'var(--t1)', fontSize: 12 }}>Loading instruction files...</div>}

      {data && (
        <>
          <div style={{
            border: '1px solid var(--bd)',
            borderRadius: 7,
            background: 'var(--bg0)',
            overflow: 'hidden',
          }}>
            {data.editableFiles.map((file) => {
              const selected = selectedName === file.name;
              const status = instructionStatus(file, data);
              return (
                <button
                  key={file.name}
                  type="button"
                  onClick={() => setSelectedName(file.name)}
                  style={{
                    width: '100%',
                    border: 'none',
                    borderTop: file.name === data.editableFiles[0].name ? 'none' : '1px solid #30363d55',
                    background: selected ? '#1f6feb18' : 'transparent',
                    color: 'var(--t0)',
                    cursor: 'pointer',
                    padding: '8px 10px',
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gap: 8,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {file.name}
                    </span>
                    <span style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginTop: 3 }}>
                      {instructionRoleLabel(file, selectedProvider)}
                    </span>
                  </span>
                  <span style={{ color: status.color, fontSize: 11, alignSelf: 'center' }}>{status.label}</span>
                </button>
              );
            })}
          </div>

          {selectedFile && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--t0)', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700 }}>{selectedFile.name}</div>
                  <div style={{ color: 'var(--t1)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedFile.path}</div>
                </div>
                <span style={{ color: instructionStatus(selectedFile, data).color, fontSize: 11 }}>
                  {instructionStatus(selectedFile, data).label}
                </span>
              </div>

              <div
                role="tablist"
                aria-label="Instruction view mode"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  border: '1px solid var(--bd)',
                  borderRadius: 7,
                  overflow: 'hidden',
                  background: 'var(--bg0)',
                }}
              >
                {(['edit', 'preview'] as InstructionViewMode[]).map((mode) => {
                  const active = viewMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setViewMode(mode)}
                      style={{
                        border: 'none',
                        borderLeft: mode === 'preview' ? '1px solid var(--bd)' : 'none',
                        background: active ? '#1f6feb22' : 'transparent',
                        color: active ? 'var(--t0)' : 'var(--t1)',
                        cursor: 'pointer',
                        padding: '6px 8px',
                        fontSize: 12,
                        fontWeight: active ? 700 : 500,
                      }}
                    >
                      {mode === 'edit' ? 'Edit Markdown' : 'Preview'}
                    </button>
                  );
                })}
              </div>

              {viewMode === 'edit' ? (
                <textarea
                  aria-label={`Edit ${selectedFile.name}`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    minHeight: 230,
                    resize: 'vertical',
                    border: '1px solid var(--bd)',
                    borderRadius: 7,
                    background: 'var(--bg0)',
                    color: 'var(--t0)',
                    padding: 10,
                    fontFamily: 'var(--mono)',
                    fontSize: 12,
                    lineHeight: 1.5,
                    outline: 'none',
                  }}
                />
              ) : (
                <div
                  aria-label={`Preview ${selectedFile.name}`}
                  style={{
                    minHeight: 230,
                    maxHeight: 420,
                    overflow: 'auto',
                    border: '1px solid var(--bd)',
                    borderRadius: 7,
                    background: 'var(--bg0)',
                    color: 'var(--t0)',
                    padding: 12,
                  }}
                >
                  {draft.trim() ? (
                    <MarkdownRenderer content={draft} />
                  ) : (
                    <div style={{ color: 'var(--t1)', fontSize: 12 }}>No markdown content to preview.</div>
                  )}
                </div>
              )}

              {pendingPermission && (
                <PermissionGate
                  permission={pendingPermission}
                  busy={saving}
                  onDeny={() => setPendingPermission(null)}
                  onAllowOnce={() => persist('allow_once')}
                />
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ color: 'var(--t1)', fontSize: 11 }}>
                  Effective tokens: {data.tokenEstimate}
                </span>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || draft === selectedFile.content}
                  style={{
                    border: '1px solid var(--bd)',
                    borderRadius: 6,
                    background: draft === selectedFile.content ? 'transparent' : '#23863633',
                    color: draft === selectedFile.content ? 'var(--t1)' : 'var(--t0)',
                    cursor: saving || draft === selectedFile.content ? 'not-allowed' : 'pointer',
                    padding: '6px 11px',
                    fontSize: 12,
                    fontWeight: 650,
                  }}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {data.suppressed.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <SidebarSectionTitle>Suppressed</SidebarSectionTitle>
              {data.suppressed.map((item) => (
                <div key={item.path} style={{ color: 'var(--t1)', fontSize: 11, lineHeight: 1.45 }}>
                  <span style={{ color: 'var(--t0)', fontFamily: 'var(--mono)' }}>{item.name}</span>
                  {' '}· {item.reason === 'duplicate_content' ? 'duplicate content' : 'provider mismatch'}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CommandRunCard({
  run,
  onToggleChatAttachment,
  onRerun,
}: {
  run: CommandRun;
  onToggleChatAttachment: (run: CommandRun) => void;
  onRerun: (run: CommandRun) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const running = run.exit_code === null && !run.timed_out;
  const ok = run.exit_code === 0 && !run.timed_out;
  const output = [run.stdout, run.stderr].filter(Boolean).join(run.stdout && run.stderr ? '\n' : '');
  const visibleOutput = filter.trim()
    ? output.split(/\r?\n/).filter((line) => line.toLowerCase().includes(filter.trim().toLowerCase())).join('\n')
    : output;
  const sendOutputToChat = () => {
    const content = [
      `Use this command output from \`${run.command}\`:`,
      '',
      '```',
      output || '(no output)',
      '```',
    ].join('\n');
    window.dispatchEvent(new CustomEvent('nid:command-output-to-chat', { detail: { content } }));
  };
  const copyOutput = () => {
    navigator.clipboard?.writeText(output || '').catch(() => {});
  };
  return (
    <div style={{ border: '1px solid var(--bd)', borderRadius: 7, background: 'var(--bg0)', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          width: '100%',
          border: 'none',
          background: 'transparent',
          color: 'var(--t0)',
          cursor: 'pointer',
          padding: '8px 10px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gap: 8,
          textAlign: 'left',
        }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {run.command}
          </span>
          <span style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginTop: 3 }}>
            {run.duration_ms}ms · {run.cwd}
          </span>
        </span>
        <span style={{ color: running ? 'var(--blu)' : ok ? 'var(--grn)' : 'var(--red)', fontSize: 11, alignSelf: 'center' }}>
          {running ? 'Running' : run.timed_out ? 'Timed out' : `Exit ${run.exit_code ?? '-'}`}
        </span>
      </button>
      {open && (
        <>
          <div style={{
            borderTop: '1px solid #30363d55',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto auto',
            gap: 8,
            padding: 8,
            background: 'var(--bg0)',
          }}>
            <input
              aria-label={`Filter output for ${run.command}`}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter output"
              style={{
                minWidth: 0,
                border: '1px solid var(--bd)',
                borderRadius: 5,
                background: '#0d1117',
                color: 'var(--t0)',
                padding: '5px 7px',
                fontSize: 11,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => onRerun(run)}
              style={{
                border: '1px solid var(--bd)',
                borderRadius: 5,
                background: 'var(--bg2)',
                color: 'var(--t0)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 650,
                padding: '5px 8px',
              }}
            >
              Rerun
            </button>
            <button
              type="button"
              onClick={copyOutput}
              style={{
                border: '1px solid var(--bd)',
                borderRadius: 5,
                background: 'var(--bg2)',
                color: 'var(--t0)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 650,
                padding: '5px 8px',
              }}
            >
              Copy
            </button>
          </div>
          <pre style={{
            margin: 0,
            maxHeight: 240,
            overflow: 'auto',
            background: '#0d1117',
            color: 'var(--t1)',
            padding: 10,
            fontFamily: 'var(--mono)',
            fontSize: 11,
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
          }}>{visibleOutput || (filter.trim() ? '(no matches)' : '(no output)')}</pre>
          <div style={{ borderTop: '1px solid #30363d55', padding: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => onToggleChatAttachment(run)}
              style={{
                border: '1px solid var(--bd)',
                borderRadius: 5,
                background: run.include_in_chat ? '#1f6feb22' : 'var(--bg2)',
                color: run.include_in_chat ? 'var(--blu)' : 'var(--t0)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 650,
                padding: '5px 8px',
                marginRight: 8,
              }}
            >
              {run.include_in_chat ? 'Attached to next turn' : 'Attach to next turn'}
            </button>
            <button
              type="button"
              onClick={sendOutputToChat}
              style={{
                border: '1px solid var(--bd)',
                borderRadius: 5,
                background: 'var(--bg2)',
                color: 'var(--t0)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 650,
                padding: '5px 8px',
              }}
            >
              Send output to chat
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CommandsTab() {
  const workingDirectory = useAgentStore((state) => state.workingDirectory);
  const activeConversationId = useAgentStore((state) => state.activeConversationId);
  const resourceRevision = useAgentStore((state) => state.resourceRevision);
  const [command, setCommand] = useState('');
  const [presets, setPresets] = useState<CommandPreset[]>([]);
  const [runs, setRuns] = useState<CommandRun[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PermissionEvaluationResult | null>(null);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);

  const loadRuns = () => {
    const params = new URLSearchParams();
    if (activeConversationId) params.set('conversationId', activeConversationId);
    fetch(`http://localhost:7430/api/commands/runs?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`commands_history_${response.status}`);
        return response.json() as Promise<CommandRun[]>;
      })
      .then(setRuns)
      .catch(() => {});
  };

  const loadPresets = () => {
    if (!workingDirectory) {
      setPresets([]);
      return;
    }
    const params = new URLSearchParams({ cwd: workingDirectory });
    fetch(`http://localhost:7430/api/commands/presets?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`command_presets_${response.status}`);
        return response.json() as Promise<CommandPreset[]>;
      })
      .then(setPresets)
      .catch(() => setPresets([]));
  };

  useEffect(() => {
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, resourceRevision]);

  useEffect(() => {
    loadPresets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingDirectory, resourceRevision]);

  useEffect(() => {
    const handleCommandEvent = (event: Event) => {
      const detail = (event as CustomEvent<CommandRunEvent>).detail;
      if (!detail?.run_id) return;
      if (detail.conversation_id && activeConversationId && detail.conversation_id !== activeConversationId) return;
      if (detail.type === 'started') {
        setRuns((items) => [
          {
            id: detail.run_id,
            conversation_id: detail.conversation_id,
            command: detail.command,
            cwd: detail.cwd,
            exit_code: null,
            stdout: '',
            stderr: '',
            timed_out: false,
            include_in_chat: false,
            added_to_working_set: false,
            duration_ms: 0,
            created_at: new Date().toISOString(),
          },
          ...items.filter((item) => item.id !== detail.run_id),
        ]);
      } else if (detail.type === 'output') {
        setRuns((items) => items.map((item) => {
          if (item.id !== detail.run_id) return item;
          if (detail.stream === 'stderr') return { ...item, stderr: item.stderr + (detail.content ?? '') };
          return { ...item, stdout: item.stdout + (detail.content ?? '') };
        }));
      } else if (detail.type === 'finished') {
        setRuns((items) => items.map((item) => item.id === detail.run_id ? {
          ...item,
          exit_code: detail.exit_code ?? null,
          timed_out: Boolean(detail.timed_out),
          duration_ms: detail.duration_ms ?? item.duration_ms,
        } : item));
      }
    };
    window.addEventListener('nid:command-event', handleCommandEvent);
    return () => window.removeEventListener('nid:command-event', handleCommandEvent);
  }, [activeConversationId]);

  const runCommand = (permissionOverride?: 'allow_once', explicitCommand?: string) => {
    if (!workingDirectory) {
      setError('working_directory_required');
      return;
    }
    const commandToRun = (explicitCommand ?? pendingCommand ?? command).trim();
    if (!commandToRun) {
      setError('command_required');
      return;
    }
    setRunning(true);
    setError(null);
    if (!permissionOverride) setPendingPermission(null);
    fetch('http://localhost:7430/api/commands/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: commandToRun,
        cwd: workingDirectory,
        conversationId: activeConversationId,
        permissionOverride,
      }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = body?.detail;
          if (detail?.code === 'permission_required' && detail.permission) {
            setPendingPermission(detail.permission as PermissionEvaluationResult);
            setPendingCommand(commandToRun);
            return null;
          }
          throw new Error(typeof detail === 'string' ? detail : detail?.code ?? `command_run_${response.status}`);
        }
        return body as CommandRun;
      })
      .then((run) => {
        if (!run) return;
        setPendingPermission(null);
        setPendingCommand(null);
        setRuns((items) => [run, ...items.filter((item) => item.id !== run.id)]);
        setCommand('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'command_run_failed'))
      .finally(() => setRunning(false));
  };

  const toggleChatAttachment = (run: CommandRun) => {
    fetch(`http://localhost:7430/api/commands/runs/${run.id}/chat-attachment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeInChat: !run.include_in_chat }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`command_attachment_${response.status}`);
        return response.json() as Promise<CommandRun>;
      })
      .then((updated) => {
        setRuns((items) => items.map((item) => item.id === updated.id ? updated : item));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'command_attachment_failed'));
  };

  const rerun = (run: CommandRun) => {
    setPendingPermission(null);
    setPendingCommand(run.command);
    setCommand(run.command);
    runCommand(undefined, run.command);
  };

  if (!workingDirectory) {
    return (
      <EmptySidebarTab
        title="Commands"
        description="Set a working directory to run commands for this conversation."
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
      <SidebarSectionTitle>Run Command</SidebarSectionTitle>
      <div style={{ color: 'var(--t1)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {workingDirectory}
      </div>
      <textarea
        aria-label="Command"
        placeholder="npm test"
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        spellCheck={false}
        style={{
          width: '100%',
          minHeight: 76,
          resize: 'vertical',
          border: '1px solid var(--bd)',
          borderRadius: 7,
          background: 'var(--bg0)',
          color: 'var(--t0)',
          padding: 10,
          fontFamily: 'var(--mono)',
          fontSize: 12,
          lineHeight: 1.45,
          outline: 'none',
        }}
      />

      {presets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.command}
              onClick={() => setCommand(preset.command)}
              style={{
                border: '1px solid var(--bd)',
                borderRadius: 999,
                background: 'var(--bg2)',
                color: 'var(--t0)',
                cursor: 'pointer',
                padding: '4px 8px',
                fontSize: 11,
                fontWeight: 650,
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      {pendingPermission && (
        <PermissionGate
          permission={pendingPermission}
          busy={running}
          onDeny={() => {
            setPendingPermission(null);
            setPendingCommand(null);
          }}
          onAllowOnce={() => runCommand('allow_once')}
        />
      )}

      {error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          onClick={() => runCommand()}
          disabled={running || !command.trim()}
          style={{
            border: '1px solid var(--bd)',
            borderRadius: 6,
            background: command.trim() ? '#23863633' : 'transparent',
            color: command.trim() ? 'var(--t0)' : 'var(--t1)',
            cursor: running || !command.trim() ? 'not-allowed' : 'pointer',
            padding: '6px 11px',
            fontSize: 12,
            fontWeight: 650,
          }}
        >
          {running ? 'Running...' : 'Run'}
        </button>
      </div>

      <SidebarSectionTitle>Recent Runs</SidebarSectionTitle>
      {runs.length === 0 ? (
        <div style={{ color: 'var(--t1)', fontSize: 12 }}>No command runs yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {runs.slice(0, 10).map((run) => (
            <CommandRunCard
              key={run.id}
              run={run}
              onToggleChatAttachment={toggleChatAttachment}
              onRerun={rerun}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function RightSidebar({ onClose }: RightSidebarProps) {
  const [activeTab, setActiveTab] = useState<RightSidebarTab>('working-set');
  const [reviewScope, setReviewScope] = useState<ReviewScope>('last-turn');
  const [selectedReviewRef, setSelectedReviewRef] = useState<CodeRef | undefined>();
  const [comments, setComments] = useState<LocalComment[]>([]);
  const messages = useAgentStore((state) => state.messages);
  const report = latestCompletionReport(messages);
  const reports = completionReports(messages);
  const latestMessage = latestAgentMessage(messages);
  const refreshWorkingSetFiles = useAgentStore((state) => state.refreshWorkingSetFiles);
  const markResourcesChanged = useAgentStore((state) => state.markResourcesChanged);
  const addComment = (comment: Omit<LocalComment, 'id'>) => {
    setComments((items) => [...items, { ...comment, id: `${Date.now()}-${items.length}` }]);
  };

  useEffect(() => {
    const onCodeRefOpen = (event: Event) => {
      const detail = (event as CustomEvent<CodeRef & { reviewScope?: ReviewScope }>).detail;
      if (!detail?.path) return;
      setSelectedReviewRef(detail);
      if (detail.reviewScope) setReviewScope(detail.reviewScope);
      setActiveTab('review');
    };
    const onWorkspaceTab = (event: Event) => {
      const detail = (event as CustomEvent<RightSidebarTab>).detail;
      if (!TABS.some((tab) => tab.id === detail)) return;
      setActiveTab(detail);
    };
    window.addEventListener('nid:code-ref-open', onCodeRefOpen);
    window.addEventListener('nid:workspace-tab', onWorkspaceTab);
    return () => {
      window.removeEventListener('nid:code-ref-open', onCodeRefOpen);
      window.removeEventListener('nid:workspace-tab', onWorkspaceTab);
    };
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            aria-label="Reload workspace resources"
            onClick={() => {
              markResourcesChanged('Workspace resources reloaded');
              refreshWorkingSetFiles().catch(() => {});
              window.dispatchEvent(new CustomEvent('nid:skills-changed'));
            }}
            style={{
              cursor: 'pointer',
              color: 'var(--t1)',
              fontSize: 12,
              lineHeight: 1,
              border: 'none',
              background: 'transparent',
              padding: 2,
            }}
          >
            ↻
          </button>
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
      </div>

      <div
        role="tablist"
        aria-label="Right sidebar sections"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
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
      {activeTab === 'summary' && <SummaryTab reports={reports} message={latestMessage} />}
      {activeTab === 'review' && (
        <ReviewTab
          report={report}
          scope={reviewScope}
          onScopeChange={setReviewScope}
          selectedRef={selectedReviewRef}
          comments={comments}
          onAddComment={addComment}
        />
      )}
      {activeTab === 'instructions' && <ProjectInstructionsTab />}
      {activeTab === 'commands' && <CommandsTab />}
      {activeTab === 'audit' && <AuditTab />}
      {activeTab === 'git' && <GitTab selectedPath={selectedReviewRef?.path} onReviewFile={(path) => {
        setSelectedReviewRef({ kind: 'code', path, label: path });
        setReviewScope('unstaged');
        setActiveTab('review');
      }} />}
    </aside>
  );
}
