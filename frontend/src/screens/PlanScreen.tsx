import { useEffect, useMemo, useRef, useState } from 'react';
import { TopBar } from '../components/shared/TopBar';
import { Btn } from '../components/shared/Btn';
import { StreamRenderer } from '../components/chat/StreamRenderer';
import { AgentActivityTimeline } from '../components/chat/AgentActivityTimeline';
import { MarkdownRenderer } from '../components/chat/MarkdownRenderer';
import { useAgentModels } from '../hooks/useAgentModels';
import { formatAssistantAnswer } from '../lib/answerFormatting';
import type { AgentModelDef } from '../lib/types';
import type { StreamEvent } from '../lib/streamTypes';
import { getProviderTheme } from '../lib/providerTheme';

const API = 'http://localhost:7430';

const BOARD_COLUMNS = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'ready', label: 'Ready' },
  { id: 'running', label: 'Running' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'cancelled', label: 'Cancelled' },
];

const NODE_STATUSES = ['not_started', 'ready', 'running', 'blocked', 'failed', 'complete', 'skipped', 'cancelled'];
const STEP_TYPES = ['manual', 'agent', 'command', 'review', 'gate', 'artifact', 'handoff'];
const PROVIDER_ORDER = ['claude', 'codex', 'ollama', 'gemini'];

const STATUS_COLORS: Record<string, string> = {
  backlog: 'var(--t1)',
  ready: 'var(--blu)',
  running: 'var(--yel)',
  waiting_for_user: 'var(--yel)',
  review: 'var(--prp)',
  done: 'var(--grn)',
  blocked: 'var(--red)',
  cancelled: 'var(--t1)',
  not_started: 'var(--t1)',
  complete: 'var(--grn)',
  failed: 'var(--red)',
  clean: 'var(--grn)',
  dirty: 'var(--yel)',
  missing: 'var(--red)',
  removed: 'var(--t1)',
  error: 'var(--red)',
};

interface OrchestrationTaskSummary {
  id: string;
  title: string;
  description: string;
  status: string;
  priority?: number | null;
  labels: string[];
  conversation_id?: string | null;
  base_repo_path?: string | null;
  base_branch?: string | null;
  task_branch?: string | null;
  worktree_path?: string | null;
  archived?: number;
  deleted_at?: string | null;
  updated_at: string;
}

interface OrchestrationNode {
  id: string;
  task_id: string;
  title: string;
  description: string;
  status: string;
  provider?: string | null;
  model?: string | null;
  skill_ids: string[];
  position_x: number;
  position_y: number;
}

interface OrchestrationEdge {
  id: string;
  task_id: string;
  from_node_id: string;
  to_node_id: string;
}

interface OrchestrationStep {
  id: string;
  node_id: string;
  order_index: number;
  type: string;
  title: string;
  description: string;
  status: string;
  config: Record<string, unknown>;
  output_summary: string;
}

interface OrchestrationWorktree {
  id: string;
  task_id: string;
  node_id?: string | null;
  repo_path: string;
  worktree_path: string;
  kind: string;
  base_branch: string;
  branch_name: string;
  base_commit?: string | null;
  head_commit?: string | null;
  status: string;
  dirty_count: number;
  dirty_summary: Array<{ path: string; status: string }>;
}

interface WorktreeReview {
  ready_to_merge: boolean;
  commit_count: number;
  files: Array<{ path: string; status: string }>;
  commits: Array<{ sha: string; short_sha: string; subject: string }>;
  shortstat: string;
  status: string;
  dirty_count: number;
}

interface WorktreeIntegrationProposal {
  title: string;
  body: string;
  source_branch: string;
  target_branch: string;
  ready_to_merge: boolean;
  head_commit: string;
  review?: WorktreeReview;
}

interface WorktreeIntegrationPreflight {
  can_merge: boolean;
  message: string;
  target_ref: string;
  source_ref: string;
  commits_to_merge: number;
  target_ahead_count: number;
  files: Array<{ path: string; status: string }>;
  conflicts: Array<{ path: string; message: string }>;
}

interface StagedIntegration {
  branch_name: string;
  worktree_path: string;
  head_commit?: string | null;
  merged: boolean;
  status: string;
}

interface OrchestrationReadiness {
  runnable: Array<{ node_id: string; step_id: string; step_type: string }>;
  blocked: Array<{ node_id: string; blocked_by: string[] }>;
}

interface OrchestrationTaskDetail extends OrchestrationTaskSummary {
  nodes: OrchestrationNode[];
  edges: OrchestrationEdge[];
  steps: OrchestrationStep[];
  worktrees: OrchestrationWorktree[];
  readiness: OrchestrationReadiness;
}

interface OrchestrationEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface PlanInboxItem {
  id: string;
  raw_plan: string;
  repo_path?: string | null;
  base_branch?: string | null;
  provider?: string | null;
  model?: string | null;
  automation_mode: string;
  max_concurrency: number;
  priority?: number | null;
  source: string;
  constraints: string[];
  acceptance_criteria: string[];
  status: string;
  locked_by?: string | null;
  locked_at?: string | null;
  final_spec_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface PlannerDiscussionMessage {
  id: string;
  plan_inbox_item_id: string;
  role: string;
  kind: string;
  content: string;
  linked_artifact_id?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface PlanningCheckpoint {
  id: string;
  plan_inbox_item_id: string;
  key: string;
  title: string;
  status: string;
  summary: string;
  source_message_ids: string[];
  blocking_question?: string | null;
  created_at: string;
  updated_at: string;
}

interface AgenticSpec {
  id: string;
  plan_inbox_item_id: string;
  version: number;
  content: string;
  metadata: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
}

const CHECKPOINT_REQUIREMENTS: Record<string, string[]> = {
  intake: [
    'Raw goal captured',
    'Initial constraints or acceptance notes recorded',
  ],
  repo_target: [
    'Repo path selected or new-project setup requested',
    'Base branch or baseline strategy known',
  ],
  scope: [
    'In-scope outcomes agreed',
    'Non-goals and deferrals called out',
  ],
  acceptance: [
    'Testable acceptance criteria listed',
    'User-visible success condition defined',
  ],
  verification: [
    'Commands or checks identified',
    'Manual review expectations defined',
  ],
  risks: [
    'Dependencies and ordering risks noted',
    'Autonomy guardrails agreed',
  ],
  spec_draft: [
    'Agentic-forward Markdown spec generated',
    'Spec uses decomposer-ready structure',
  ],
  spec_approved: [
    'User explicitly approves the spec',
    'Ready to send to decomposition',
  ],
};

interface PlanInboxDetail extends PlanInboxItem {
  discussion_messages: PlannerDiscussionMessage[];
  planning_checkpoints: PlanningCheckpoint[];
  specs: AgenticSpec[];
}

function plannerStreamEvents(message: PlannerDiscussionMessage): StreamEvent[] {
  const events = message.metadata?.events;
  return Array.isArray(events) ? (events as StreamEvent[]) : [];
}

function plannerMessageStreaming(message: PlannerDiscussionMessage): boolean {
  return message.metadata?.streaming === true;
}

function plannerHasActivity(events: StreamEvent[]): boolean {
  return events.some((event) => event.type !== 'answer_delta' && event.type !== 'text' && event.type !== 'done');
}

interface TaskInboxItem {
  id: string;
  plan_inbox_item_id?: string | null;
  decomposition_run_id?: string | null;
  candidate_task_id?: string | null;
  title: string;
  objective: string;
  payload: Record<string, unknown>;
  dependencies: string[];
  status: string;
  priority?: number | null;
  locked_by?: string | null;
  locked_at?: string | null;
  materialized_task_id?: string | null;
  materialized_node_id?: string | null;
  created_at: string;
  updated_at: string;
}

function priorityLabel(priority?: number | null) {
  if (priority === null || priority === undefined) return 'No priority';
  if (priority <= 1) return 'P1';
  if (priority === 2) return 'P2';
  return `P${priority}`;
}

function StatusPill({ status }: { status: string }) {
  return (
    <span style={{
      border: `1px solid ${STATUS_COLORS[status] ?? 'var(--bd)'}55`,
      borderRadius: 999,
      color: STATUS_COLORS[status] ?? 'var(--t1)',
      background: `${STATUS_COLORS[status] ?? '#8b949e'}16`,
      fontSize: 10,
      fontWeight: 700,
      padding: '2px 7px',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function preferredPlannerModel(models: AgentModelDef[]) {
  const available = models.filter((model) => model.available);
  return available.find((model) => model.provider_id === 'claude')
    ?? available.find((model) => model.provider_id === 'codex')
    ?? available[0]
    ?? models.find((model) => model.provider_id === 'claude')
    ?? models.find((model) => model.provider_id === 'codex')
    ?? models[0]
    ?? null;
}

function ProviderModelSelector({
  models,
  provider,
  model,
  onChange,
  disabled,
}: {
  models: AgentModelDef[];
  provider: string;
  model: string;
  onChange: (values: { provider: string; model: string }) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const providers = Array.from(new Set(models.map((item) => item.provider_id))).sort((a, b) => {
    const aIndex = PROVIDER_ORDER.indexOf(a);
    const bIndex = PROVIDER_ORDER.indexOf(b);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex) || a.localeCompare(b);
  });
  const activeModel = models.find((item) => item.provider_id === provider && item.model_id === model);
  const activeTheme = getProviderTheme(provider);
  const buttonLabel = activeModel?.model_id
    .replace(/^claude-/, '')
    .replace(/-(\d+)-(\d+)$/, ' $1.$2')
    ?? activeTheme.shortName;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setDropPos({ top: rect.bottom + 6, left: rect.left });
    setOpen((current) => !current);
  };

  const dropdown = open && dropPos && (
    <div
      ref={dropdownRef}
      data-testid="planner-provider-dropdown"
      style={{
        position: 'fixed',
        top: dropPos.top,
        left: dropPos.left,
        zIndex: 9999,
        width: 252,
        background: 'var(--bg1)',
        border: '1px solid var(--bd)',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
        overflow: 'hidden',
      }}
    >
      {providers.length === 0 ? (
        <div style={{ padding: '10px 12px', color: 'var(--t1)', fontSize: 11 }}>No models available</div>
      ) : providers.map((providerId) => {
        const theme = getProviderTheme(providerId);
        return (
          <div key={providerId}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px 4px' }}>
              <span style={{ fontSize: 11, color: theme.color }}>{theme.icon}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: theme.color, textTransform: 'uppercase' }}>
                {theme.shortName}
              </span>
            </div>
            {models.filter((item) => item.provider_id === providerId).map((item) => {
              const isActive = item.provider_id === provider && item.model_id === model;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!item.available}
                  onClick={() => {
                    onChange({ provider: item.provider_id, model: item.model_id });
                    setOpen(false);
                  }}
                  style={{
                    width: '100%',
                    border: 'none',
                    borderLeft: isActive ? `2px solid ${theme.color}` : '2px solid transparent',
                    background: isActive ? '#1f6feb18' : 'transparent',
                    color: item.available ? 'var(--t0)' : 'var(--t1)',
                    opacity: item.available ? 1 : 0.45,
                    cursor: item.available ? 'pointer' : 'not-allowed',
                    padding: '8px 12px',
                    textAlign: 'left',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                    {item.display_name}
                  </span>
                  {isActive && <span style={{ color: theme.color, fontSize: 10 }}>active</span>}
                </button>
              );
            })}
            <div style={{ height: 1, background: '#21262d', margin: '4px 8px' }} />
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Planner model selector"
        disabled={disabled || models.length === 0}
        onClick={toggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          background: 'var(--bg2)',
          border: `1px solid ${activeTheme.color}66`,
          borderRadius: 5,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 12,
          color: activeTheme.color,
          outline: 'none',
          fontFamily: 'var(--mono)',
          opacity: disabled ? 0.55 : 1,
          maxWidth: 150,
        }}
      >
        <span style={{ fontSize: 12 }}>{activeTheme.icon}</span>
        <span style={{ maxWidth: 104, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{buttonLabel}</span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
      </button>
      {dropdown}
    </>
  );
}

function PlanInboxPanel({
  items,
  selectedItemId,
  plannerProvider,
  plannerModel,
  onSelect,
  onOpenPm,
  onCreate,
  loading,
}: {
  items: PlanInboxItem[];
  selectedItemId?: string | null;
  plannerProvider: string;
  plannerModel: string;
  onSelect: (itemId: string) => void;
  onOpenPm: (itemId: string) => void;
  onCreate: (values: { rawPlan: string; repoPath: string; baseBranch: string; acceptanceCriteria: string; provider: string; model: string }) => void;
  loading: boolean;
}) {
  const [rawPlan, setRawPlan] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const disabled = !rawPlan.trim() || loading;
  const repoPickerAvailable = Boolean(window.nidavellir?.pickDirectory);

  const pickRepoPath = async () => {
    const picked = await window.nidavellir?.pickDirectory?.();
    if (picked) setRepoPath(picked);
  };

  return (
    <section style={{ border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg1)', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ borderBottom: '1px solid var(--bd)', padding: '9px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--t0)', fontSize: 12, fontWeight: 750 }}>Plan Inbox</span>
        <span style={{ color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--mono)' }}>{items.length}</span>
      </div>
      <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, alignItems: 'start' }}>
        <textarea
          aria-label="Plan inbox raw plan"
          value={rawPlan}
          onChange={(event) => setRawPlan(event.target.value)}
          placeholder="Start with a spec, idea, or rough plan..."
          style={{ width: '100%', boxSizing: 'border-box', minHeight: 74, border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8, resize: 'vertical', fontSize: 12 }}
        />
        <textarea
          aria-label="Plan acceptance criteria"
          value={acceptanceCriteria}
          onChange={(event) => setAcceptanceCriteria(event.target.value)}
          placeholder="Acceptance criteria, one per line"
          style={{ width: '100%', boxSizing: 'border-box', minHeight: 74, border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8, resize: 'vertical', fontSize: 12 }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 6 }}>
            <input
              aria-label="Plan repo path"
              value={repoPath}
              onChange={(event) => setRepoPath(event.target.value)}
              placeholder="Repo path"
              style={{ minWidth: 0, width: '100%', boxSizing: 'border-box', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 7, fontSize: 12 }}
            />
            <Btn
              small
              disabled={!repoPickerAvailable}
              onClick={pickRepoPath}
              title={repoPickerAvailable ? 'Choose repository path' : 'Repository picker is available in the desktop app'}
            >
              Browse
            </Btn>
          </div>
          <input
            aria-label="Plan base branch"
            value={baseBranch}
            onChange={(event) => setBaseBranch(event.target.value)}
            placeholder="Base branch"
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 7, fontSize: 12 }}
          />
        </div>
        <Btn
          small
          primary
          disabled={disabled}
          onClick={() => {
            onCreate({ rawPlan: rawPlan.trim(), repoPath: repoPath.trim(), baseBranch: baseBranch.trim(), acceptanceCriteria, provider: plannerProvider, model: plannerModel });
            setRawPlan('');
            setAcceptanceCriteria('');
          }}
        >
          Start PM Chat
        </Btn>
      </div>
      <div style={{ borderTop: '1px solid var(--bd)', padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8, maxHeight: 160, overflow: 'auto' }}>
        {items.length === 0 ? (
          <div style={{ color: 'var(--t1)', fontSize: 12 }}>No intake items yet.</div>
        ) : items.slice(0, 6).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onSelect(item.id);
              onOpenPm(item.id);
            }}
            style={{
              border: `1px solid ${selectedItemId === item.id ? 'var(--blu)' : 'var(--bd)'}`,
              borderRadius: 7,
              background: selectedItemId === item.id ? '#1f6feb18' : 'var(--bg0)',
              color: 'inherit',
              padding: 9,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              textAlign: 'left',
              cursor: 'pointer',
              minWidth: 0,
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ color: 'var(--t0)', fontSize: 12, fontWeight: 700, lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>
                {item.raw_plan}
              </div>
              <StatusPill status={item.status} />
            </div>
            <div style={{ color: 'var(--t1)', fontSize: 10, fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.repo_path || 'repo not set'} · {item.base_branch || 'branch not set'}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function CheckpointRail({
  checkpoints,
}: {
  checkpoints: PlanningCheckpoint[];
}) {
  return (
    <aside style={{ borderLeft: '1px solid var(--bd)', background: 'var(--bg1)', display: 'flex', flexDirection: 'column', minWidth: 300, minHeight: 0 }}>
      <div style={{ borderBottom: '1px solid var(--bd)', padding: 12 }}>
        <div style={{ color: 'var(--t0)', fontSize: 12, fontWeight: 800 }}>Checkpoints</div>
        <div style={{ color: 'var(--t1)', fontSize: 11, lineHeight: 1.4, marginTop: 3 }}>Autosaved requirements for spec generation.</div>
      </div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', minHeight: 0 }}>
        {checkpoints.length === 0 ? (
          <div style={{ color: 'var(--t1)', fontSize: 12, lineHeight: 1.45 }}>
            Loading checkpoint requirements...
          </div>
        ) : checkpoints.map((checkpoint) => {
          const complete = checkpoint.status === 'agreed';
          const blocked = checkpoint.status === 'blocked';
          const proposed = checkpoint.status === 'proposed';
          const requirements = CHECKPOINT_REQUIREMENTS[checkpoint.key] ?? ['Requirement defined by PM'];
          return (
          <div key={checkpoint.key} style={{ border: `1px solid ${complete ? '#3fb95066' : blocked ? '#f8514966' : proposed ? '#d2992266' : 'var(--bd)'}`, borderRadius: 7, background: complete ? '#23863614' : 'var(--bg0)', padding: 9, display: 'flex', flexDirection: 'column', gap: 7, height: 116, boxSizing: 'border-box', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ color: complete ? 'var(--t1)' : 'var(--t0)', fontSize: 12, fontWeight: 700, lineHeight: 1.35, display: 'flex', gap: 8, alignItems: 'flex-start', textDecoration: complete ? 'line-through' : 'none', minWidth: 0 }}>
                <span aria-hidden="true" style={{ color: complete ? 'var(--grn)' : blocked ? 'var(--red)' : proposed ? 'var(--ylw)' : 'var(--t1)', fontFamily: 'var(--mono)', flex: '0 0 auto' }}>
                  {complete ? '[x]' : blocked ? '[!]' : proposed ? '[~]' : '[ ]'}
                </span>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{checkpoint.title}</span>
              </div>
              <StatusPill status={checkpoint.status} />
            </div>
            <div style={{ minHeight: 0, overflowY: 'auto', paddingRight: 3 }}>
              <ul style={{ margin: 0, paddingLeft: 24, color: 'var(--t1)', fontSize: 11, lineHeight: 1.45 }}>
                {requirements.map((requirement) => (
                  <li key={requirement} style={{ textDecoration: complete ? 'line-through' : 'none' }}>{requirement}</li>
                ))}
              </ul>
            </div>
            <div style={{ color: 'var(--t1)', fontSize: 10, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 'auto' }}>
              {complete ? 'Satisfied by saved planning state.' : blocked ? 'Blocked by unresolved planning state.' : 'Waiting for PM/spec analysis.'}
            </div>
          </div>
        );
        })}
      </div>
    </aside>
  );
}

function PlannerDiscussionPanel({
  item,
  models,
  plannerProvider,
  plannerModel,
  onPlannerModelChange,
  onSend,
  onViewSpec,
  loading,
}: {
  item: PlanInboxDetail | null;
  models: AgentModelDef[];
  plannerProvider: string;
  plannerModel: string;
  onPlannerModelChange: (values: { provider: string; model: string }) => void;
  onSend: (content: string) => void;
  onViewSpec: () => void;
  loading: boolean;
}) {
  const [content, setContent] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const disabled = !item || !content.trim() || loading;
  const send = () => {
    if (disabled) return;
    onSend(content.trim());
    setContent('');
  };
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [item?.discussion_messages.length, item?.discussion_messages.at(-1)?.content]);

  return (
    <section style={{ background: 'var(--bg1)', minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr) auto', flex: 1 }}>
      <div style={{ borderBottom: '1px solid var(--bd)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: 'var(--t0)', fontSize: 14, fontWeight: 800 }}>Nidavellir PM</div>
          <div style={{ color: 'var(--t1)', fontSize: 11, lineHeight: 1.35, marginTop: 2 }}>
            Refine the plan until it is ready to become an agentic-forward spec.
          </div>
        </div>
        {item ? <StatusPill status={item.status} /> : <StatusPill status="blocked" />}
      </div>
      <div style={{ borderBottom: '1px solid var(--bd)', padding: '8px 12px' }}>
        <ProviderModelSelector
          models={models}
          provider={plannerProvider}
          model={plannerModel}
          onChange={onPlannerModelChange}
          disabled={loading}
        />
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflow: 'hidden' }}>
        {!item ? (
          <div style={{ color: 'var(--t1)', fontSize: 13, lineHeight: 1.5 }}>Select or create a Plan Inbox item to start a planning conversation with Nidavellir PM.</div>
        ) : (
          <>
            <div style={{ border: '1px solid var(--bd)', borderRadius: 7, background: 'var(--bg0)', padding: 10, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'start', flex: '0 0 auto' }}>
              <div style={{ color: 'var(--t1)', fontSize: 12, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>
                {item.raw_plan}
              </div>
              <Btn small onClick={onViewSpec}>View Spec</Btn>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 4 }}>
              {item.discussion_messages.length === 0 ? (
                <div style={{ color: 'var(--t1)', fontSize: 12 }}>No discussion yet.</div>
              ) : item.discussion_messages.map((message) => {
                const streamEvents = plannerStreamEvents(message);
                const streaming = plannerMessageStreaming(message);
                return (
                  <div key={message.id} style={{ border: '1px solid var(--bd)', borderRadius: 7, background: message.role === 'user' ? '#1f6feb14' : 'var(--bg0)', padding: 10, maxWidth: message.role === 'user' ? '86%' : '94%', alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                      <span style={{ color: message.role === 'user' ? 'var(--blu)' : 'var(--grn)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>
                        {message.role === 'user' ? 'You' : 'Nidavellir PM'} · {message.kind}
                      </span>
                      <span style={{ color: 'var(--t1)', fontSize: 10, fontFamily: 'var(--mono)' }}>
                        {new Date(message.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    {message.role === 'planner' && streamEvents.length > 0 ? (
                      <div style={{ color: 'var(--t0)', fontSize: 13, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                        <StreamRenderer events={streamEvents} streaming={streaming} providerId={plannerProvider} />
                        {plannerHasActivity(streamEvents) && (
                          <AgentActivityTimeline
                            events={streamEvents}
                            streaming={streaming}
                            startedAt={new Date(message.created_at)}
                          />
                        )}
                      </div>
                    ) : (
                      <div style={{ color: 'var(--t0)', fontSize: 13, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                        {message.role === 'planner' ? (
                          <MarkdownRenderer content={formatAssistantAnswer(message.content)} />
                        ) : (
                          <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={bottomRef} style={{ height: 1 }} />
            </div>
          </>
        )}
      </div>
      <div style={{ borderTop: '1px solid var(--bd)', padding: 12, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'end', background: 'var(--bg1)' }}>
        <textarea
          aria-label="Message Nidavellir PM"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Reply to the PM, clarify scope, or approve the refined direction..."
          style={{ minWidth: 0, boxSizing: 'border-box', height: 86, maxHeight: 120, border: '1px solid var(--bd)', borderRadius: 7, background: 'var(--bg0)', color: 'var(--t0)', padding: 10, resize: 'vertical', fontSize: 13, lineHeight: 1.45 }}
        />
        <Btn
          ariaLabel="Send message to Nidavellir PM"
          disabled={disabled}
          onClick={send}
        >
          Send
        </Btn>
      </div>
    </section>
  );
}

function PlannerModal({
  item,
  models,
  plannerProvider,
  plannerModel,
  onPlannerModelChange,
  onSend,
  onViewSpec,
  onClose,
  loading,
}: {
  item: PlanInboxDetail | null;
  models: AgentModelDef[];
  plannerProvider: string;
  plannerModel: string;
  onPlannerModelChange: (values: { provider: string; model: string }) => void;
  onSend: (content: string) => void;
  onViewSpec: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="planner-modal-title" style={{
      position: 'fixed',
      inset: 0,
      zIndex: 60,
      background: '#00000099',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 12,
      boxSizing: 'border-box',
    }}>
      <div style={{ width: 'min(1180px, 100%)', height: 'calc(100vh - 24px)', maxHeight: 820, border: '1px solid var(--bd)', borderRadius: 9, background: 'var(--bg1)', overflow: 'hidden', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', minHeight: 0 }}>
        <div style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 44, borderBottom: '1px solid var(--bd)', padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'var(--bg1)' }}>
            <div id="planner-modal-title" style={{ color: 'var(--t0)', fontSize: 13, fontWeight: 800 }}>PM Planning Session</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: 'var(--t1)', fontSize: 11 }}>Autosaved</span>
              <Btn small onClick={onClose} title="Close this session. Messages and checkpoint changes are already saved.">Close</Btn>
            </div>
          </div>
          <PlannerDiscussionPanel
            item={item}
            models={models}
            plannerProvider={plannerProvider}
            plannerModel={plannerModel}
            onPlannerModelChange={onPlannerModelChange}
            onSend={onSend}
            onViewSpec={onViewSpec}
            loading={loading}
          />
        </div>
        <CheckpointRail checkpoints={item?.planning_checkpoints ?? []} />
      </div>
    </div>
  );
}

function SpecViewerModal({
  item,
  onClose,
}: {
  item: PlanInboxDetail | null;
  onClose: () => void;
}) {
  if (!item) return null;
  const latestSpec = item.specs?.[0] ?? null;
  const approved = item.planning_checkpoints.filter((checkpoint) => checkpoint.status === 'agreed').map((checkpoint) => checkpoint.title);
  const pending = item.planning_checkpoints.filter((checkpoint) => checkpoint.status !== 'agreed').map((checkpoint) => `${checkpoint.title}: ${checkpoint.status}`);
  const fallbackContent = `# Working Spec Snapshot

## Intake
${item.raw_plan}

## Acceptance Criteria
${item.acceptance_criteria.length ? item.acceptance_criteria.map((criterion) => `- ${criterion}`).join('\n') : '- Not captured yet'}

## Satisfied Gates
${approved.length ? approved.map((title) => `- ${title}`).join('\n') : '- None yet'}

## Pending Gates
${pending.length ? pending.map((title) => `- ${title}`).join('\n') : '- None'}
`;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="spec-viewer-title" style={{ position: 'fixed', inset: 0, zIndex: 70, background: '#000000aa', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, boxSizing: 'border-box' }}>
      <div style={{ width: 'min(760px, 100%)', maxHeight: 'calc(100vh - 36px)', border: '1px solid var(--bd)', borderRadius: 9, background: 'var(--bg1)', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
        <div style={{ height: 44, borderBottom: '1px solid var(--bd)', padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div id="spec-viewer-title" style={{ color: 'var(--t0)', fontSize: 13, fontWeight: 800 }}>{latestSpec ? `Spec Draft v${latestSpec.version}` : 'Spec Snapshot'}</div>
          <Btn small onClick={onClose}>Close</Btn>
        </div>
        <div style={{ overflow: 'auto', padding: 14 }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--t0)', fontSize: 12, lineHeight: 1.55, fontFamily: 'var(--mono)' }}>
{latestSpec?.content ?? fallbackContent}
          </pre>
        </div>
      </div>
    </div>
  );
}

function TaskInboxPanel({ items }: { items: TaskInboxItem[] }) {
  return (
    <section style={{ border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg1)', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ borderBottom: '1px solid var(--bd)', padding: '9px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--t0)', fontSize: 12, fontWeight: 750 }}>Task Inbox</span>
        <span style={{ color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--mono)' }}>{items.length}</span>
      </div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 246, overflow: 'auto' }}>
        {items.length === 0 ? (
          <div style={{ color: 'var(--t1)', fontSize: 12 }}>No decomposed tasks yet.</div>
        ) : items.slice(0, 7).map((item) => (
          <div key={item.id} style={{ border: '1px solid var(--bd)', borderRadius: 7, background: 'var(--bg0)', padding: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ color: 'var(--t0)', fontSize: 12, fontWeight: 700, lineHeight: 1.35 }}>{item.title}</div>
              <StatusPill status={item.status} />
            </div>
            {item.objective && (
              <div style={{ color: 'var(--t1)', fontSize: 11, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                {item.objective}
              </div>
            )}
            <div style={{ color: 'var(--t1)', fontSize: 10, fontFamily: 'var(--mono)' }}>
              {item.dependencies.length} deps · {item.materialized_task_id ? 'materialized' : 'not materialized'}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  selected,
  onSelect,
  onMove,
  onArchive,
}: {
  task: OrchestrationTaskSummary;
  selected: boolean;
  onSelect: () => void;
  onMove: (status: string) => void;
  onArchive: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      style={{
        width: '100%',
        border: `1px solid ${selected ? 'var(--blu)' : 'var(--bd)'}`,
        borderRadius: 7,
        background: selected ? '#1f6feb18' : 'var(--bg1)',
        color: 'var(--t0)',
        cursor: 'pointer',
        padding: 10,
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35 }}>{task.title}</div>
        <span style={{ color: 'var(--t1)', fontSize: 10, fontFamily: 'var(--mono)' }}>{priorityLabel(task.priority)}</span>
      </div>
      {task.description && (
        <div style={{
          color: 'var(--t1)',
          fontSize: 11,
          lineHeight: 1.45,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {task.description}
        </div>
      )}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {task.labels.slice(0, 3).map((label) => (
          <span key={label} style={{
            border: '1px solid var(--bd)',
            borderRadius: 4,
            color: 'var(--t1)',
            fontSize: 10,
            padding: '1px 5px',
          }}>
            {label}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ color: task.worktree_path ? 'var(--grn)' : 'var(--t1)', fontSize: 10 }}>
          {task.worktree_path ? 'worktree linked' : 'no worktree'}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {task.status === 'cancelled' && (
            <Btn
              small
              ariaLabel={`Remove ${task.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onArchive();
              }}
              title="Archive this cancelled task and hide it from the board"
            >
              Remove
            </Btn>
          )}
          <select
            aria-label={`Move ${task.title}`}
            value={task.status}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onMove(event.target.value)}
            style={{
              maxWidth: 86,
              border: '1px solid var(--bd)',
              borderRadius: 5,
              background: 'var(--bg0)',
              color: 'var(--t0)',
              fontSize: 10,
              padding: '3px 5px',
            }}
          >
            {BOARD_COLUMNS.map((column) => (
              <option key={column.id} value={column.id}>{column.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function DagView({
  task,
  selectedNodeId,
  onSelectNode,
}: {
  task: OrchestrationTaskDetail;
  selectedNodeId?: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const positionedNodes = task.nodes.map((node, index) => ({
    ...node,
    x: node.position_x || 40 + (index % 3) * 210,
    y: node.position_y || 32 + Math.floor(index / 3) * 96,
    w: 164,
    h: 48,
  }));
  const byId = new Map(positionedNodes.map((node) => [node.id, node]));

  if (task.nodes.length === 0) {
    return (
      <div style={{ border: '1px dashed var(--bd)', borderRadius: 7, padding: 18, color: 'var(--t1)', fontSize: 12 }}>
        No DAG nodes yet. Add a node to define a stream of work.
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--bd)', borderRadius: 7, background: 'var(--bg0)', overflow: 'auto' }}>
      <svg width={720} height={Math.max(220, 96 + Math.ceil(positionedNodes.length / 3) * 96)}>
        <defs>
          <marker id="orchArrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
            <path d="M0 0 L0 6 L6 3 z" fill="#8b949e" />
          </marker>
        </defs>
        {task.edges.map((edge) => {
          const from = byId.get(edge.from_node_id);
          const to = byId.get(edge.to_node_id);
          if (!from || !to) return null;
          const x1 = from.x + from.w;
          const y1 = from.y + from.h / 2;
          const x2 = to.x;
          const y2 = to.y + to.h / 2;
          return (
            <path
              key={edge.id}
              d={`M${x1} ${y1} C${x1 + 36} ${y1} ${x2 - 36} ${y2} ${x2} ${y2}`}
              fill="none"
              stroke="#8b949e"
              strokeWidth={1.3}
              markerEnd="url(#orchArrow)"
            />
          );
        })}
        {positionedNodes.map((node) => {
          const selected = node.id === selectedNodeId;
          const color = STATUS_COLORS[node.status] ?? 'var(--bd)';
          return (
            <g key={node.id} onClick={() => onSelectNode(node.id)} style={{ cursor: 'pointer' }}>
              <rect
                x={node.x}
                y={node.y}
                width={node.w}
                height={node.h}
                rx={6}
                fill={selected ? '#1f6feb22' : '#21262d'}
                stroke={selected ? 'var(--blu)' : color}
                strokeWidth={selected ? 2 : 1.2}
              />
              <text x={node.x + 12} y={node.y + 20} fontSize={12} fontWeight={700} fill="#e6edf3">
                {node.title.slice(0, 22)}
              </text>
              <text x={node.x + 12} y={node.y + 36} fontSize={10} fill={color}>
                {node.status.replace(/_/g, ' ')}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function TaskDetail({
  task,
  events,
  selectedNodeId,
  onSelectNode,
  onAddNode,
  onEditNode,
  onNudgeNode,
  onAddEdge,
  onDeleteEdge,
  onCreateWorktree,
  onRefreshWorktree,
  onCheckpointWorktree,
  onReviewWorktree,
  onProposeIntegration,
  onPreflightIntegration,
  onStageIntegration,
  onRemoveWorktree,
  onAddStep,
  onCompleteStep,
  onRunCommandStep,
  onRunAgentStep,
  worktreeReviews,
  worktreeProposals,
  worktreePreflights,
  stagedIntegrations,
}: {
  task: OrchestrationTaskDetail;
  events: OrchestrationEvent[];
  selectedNodeId?: string | null;
  onSelectNode: (nodeId: string) => void;
  onAddNode: () => void;
  onEditNode: (node: OrchestrationNode) => void;
  onNudgeNode: (node: OrchestrationNode, dx: number, dy: number) => void;
  onAddEdge: (fromNodeId: string, toNodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onCreateWorktree: (nodeId?: string | null) => void;
  onRefreshWorktree: (worktreeId: string) => void;
  onCheckpointWorktree: (worktreeId: string) => void;
  onReviewWorktree: (worktreeId: string) => void;
  onProposeIntegration: (worktreeId: string) => void;
  onPreflightIntegration: (worktreeId: string) => void;
  onStageIntegration: (worktreeId: string) => void;
  onRemoveWorktree: (worktreeId: string) => void;
  onAddStep: (nodeId: string) => void;
  onCompleteStep: (stepId: string) => void;
  onRunCommandStep: (stepId: string) => void;
  onRunAgentStep: (stepId: string) => void;
  worktreeReviews: Record<string, WorktreeReview>;
  worktreeProposals: Record<string, WorktreeIntegrationProposal>;
  worktreePreflights: Record<string, WorktreeIntegrationPreflight>;
  stagedIntegrations: Record<string, StagedIntegration>;
}) {
  const selectedNode = task.nodes.find((node) => node.id === selectedNodeId) ?? task.nodes[0] ?? null;
  const selectedSteps = selectedNode
    ? task.steps.filter((step) => step.node_id === selectedNode.id).sort((a, b) => a.order_index - b.order_index)
    : [];
  const nodeIsRunnable = selectedNode ? task.readiness.runnable.some((item) => item.node_id === selectedNode.id) : false;
  const taskWorktree = task.worktrees.find((worktree) => worktree.kind === 'task' || (!worktree.kind && !worktree.node_id));
  const selectedNodeWorktree = selectedNode ? task.worktrees.find((worktree) => worktree.node_id === selectedNode.id && worktree.kind === 'execution') : null;
  const integrationWorktrees = task.worktrees.filter((worktree) => worktree.kind === 'integration');
  const waitingSteps = task.steps.filter((step) => step.status === 'waiting_for_user');
  const [edgeFrom, setEdgeFrom] = useState('');
  const [edgeTo, setEdgeTo] = useState('');

  useEffect(() => {
    if (!edgeFrom && task.nodes[0]) setEdgeFrom(task.nodes[0].id);
    if (!edgeTo && task.nodes[1]) setEdgeTo(task.nodes[1].id);
  }, [edgeFrom, edgeTo, task.nodes]);

  return (
    <aside style={{
      width: 470,
      flexShrink: 0,
      borderLeft: '1px solid var(--bd)',
      background: 'var(--bg1)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{ padding: 14, borderBottom: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--t0)', fontSize: 15, fontWeight: 750 }}>{task.title}</div>
            <div style={{ color: 'var(--t1)', fontSize: 11, marginTop: 3 }}>{priorityLabel(task.priority)} · {task.nodes.length} nodes · {task.steps.length} steps</div>
          </div>
          <StatusPill status={task.status} />
        </div>
        {task.description && <div style={{ color: 'var(--t1)', fontSize: 12, lineHeight: 1.5 }}>{task.description}</div>}
        <div style={{ color: 'var(--t1)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.worktree_path || task.base_repo_path || 'No worktree linked yet'}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {waitingSteps.length > 0 && (
          <section style={{
            border: '1px solid #d2992255',
            borderRadius: 7,
            background: '#d2992214',
            padding: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: 'var(--yel)', fontSize: 12, fontWeight: 750 }}>Waiting for approval</div>
              <div style={{ color: 'var(--t1)', fontSize: 11, marginTop: 3 }}>
                {waitingSteps.length} orchestration step{waitingSteps.length === 1 ? '' : 's'} paused on mediated tool results.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('nid:navigate', { detail: 'chat' }));
                window.dispatchEvent(new CustomEvent('nid:workspace-tab', { detail: 'approvals' }));
              }}
              style={{ border: '1px solid #d2992255', borderRadius: 5, background: 'var(--bg0)', color: 'var(--yel)', cursor: 'pointer', fontSize: 11, padding: '5px 8px', fontWeight: 700, whiteSpace: 'nowrap' }}
            >
              Open Approvals
            </button>
          </section>
        )}

        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
            <SectionTitle>Worktrees</SectionTitle>
            <Btn small onClick={() => onCreateWorktree(null)}>{taskWorktree ? 'New Task Worktree' : '+ Task Worktree'}</Btn>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {taskWorktree ? (
              <WorktreeCard worktree={taskWorktree} label="Task branch" review={worktreeReviews[taskWorktree.id]} proposal={worktreeProposals[taskWorktree.id]} preflight={worktreePreflights[taskWorktree.id]} stagedIntegration={stagedIntegrations[taskWorktree.id]} onRefresh={onRefreshWorktree} onCheckpoint={onCheckpointWorktree} onReview={onReviewWorktree} onProposeIntegration={onProposeIntegration} onPreflightIntegration={onPreflightIntegration} onStageIntegration={onStageIntegration} onRemove={onRemoveWorktree} />
            ) : (
              <div style={{ border: '1px dashed var(--bd)', borderRadius: 7, padding: 10, color: 'var(--t1)', fontSize: 12 }}>
                No task worktree yet. Node worktrees can still be created directly from the base repo.
              </div>
            )}
            {selectedNode && (
              selectedNodeWorktree ? (
                <WorktreeCard worktree={selectedNodeWorktree} label={`${selectedNode.title} branch`} review={worktreeReviews[selectedNodeWorktree.id]} proposal={worktreeProposals[selectedNodeWorktree.id]} preflight={worktreePreflights[selectedNodeWorktree.id]} stagedIntegration={stagedIntegrations[selectedNodeWorktree.id]} onRefresh={onRefreshWorktree} onCheckpoint={onCheckpointWorktree} onReview={onReviewWorktree} onProposeIntegration={onProposeIntegration} onPreflightIntegration={onPreflightIntegration} onStageIntegration={onStageIntegration} onRemove={onRemoveWorktree} />
              ) : (
                <button
                  type="button"
                  onClick={() => onCreateWorktree(selectedNode.id)}
                  style={{ border: '1px solid var(--bd)', borderRadius: 7, background: 'var(--bg0)', color: 'var(--t0)', cursor: 'pointer', padding: 10, textAlign: 'left', fontSize: 12 }}
                >
                  + Create worktree for {selectedNode.title}
                </button>
              )
            )}
            {integrationWorktrees.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ color: 'var(--t1)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0 }}>
                  Staged integrations
                </div>
                {integrationWorktrees.map((item) => (
                  <WorktreeCard
                    key={item.id}
                    worktree={item}
                    label="Integration branch"
                    review={worktreeReviews[item.id]}
                    proposal={worktreeProposals[item.id]}
                    preflight={worktreePreflights[item.id]}
                    stagedIntegration={stagedIntegrations[item.id]}
                    onRefresh={onRefreshWorktree}
                    onCheckpoint={onCheckpointWorktree}
                    onReview={onReviewWorktree}
                    onProposeIntegration={onProposeIntegration}
                    onPreflightIntegration={onPreflightIntegration}
                    onStageIntegration={onStageIntegration}
                    onRemove={onRemoveWorktree}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
            <SectionTitle>DAG</SectionTitle>
            <Btn small onClick={onAddNode}>+ Node</Btn>
          </div>
          <DagView task={task} selectedNodeId={selectedNode?.id} onSelectNode={onSelectNode} />
        </section>

        <section>
          <SectionTitle>Dependencies</SectionTitle>
          <div style={{ border: '1px solid var(--bd)', borderRadius: 7, padding: 10, background: 'var(--bg0)', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 9 }}>
            {task.nodes.length >= 2 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
                <select
                  aria-label="Dependency source"
                  value={edgeFrom}
                  onChange={(event) => setEdgeFrom(event.target.value)}
                  style={{ minWidth: 0, border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg1)', color: 'var(--t0)', fontSize: 11, padding: 6 }}
                >
                  {task.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
                </select>
                <select
                  aria-label="Dependency target"
                  value={edgeTo}
                  onChange={(event) => setEdgeTo(event.target.value)}
                  style={{ minWidth: 0, border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg1)', color: 'var(--t0)', fontSize: 11, padding: 6 }}
                >
                  {task.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => onAddEdge(edgeFrom, edgeTo)}
                  disabled={!edgeFrom || !edgeTo || edgeFrom === edgeTo}
                  style={{
                    border: '1px solid var(--bd)',
                    borderRadius: 5,
                    background: '#1f6feb22',
                    color: 'var(--blu)',
                    cursor: edgeFrom && edgeTo && edgeFrom !== edgeTo ? 'pointer' : 'not-allowed',
                    fontSize: 11,
                    padding: '4px 8px',
                    fontWeight: 700,
                  }}
                >
                  Add
                </button>
              </div>
            )}
            {task.edges.length === 0 ? (
              <div style={{ color: 'var(--t1)', fontSize: 12 }}>No dependencies yet. Nodes can run in parallel until an edge is added.</div>
            ) : task.edges.map((edge) => {
              const from = task.nodes.find((node) => node.id === edge.from_node_id);
              const to = task.nodes.find((node) => node.id === edge.to_node_id);
              return (
                <div key={edge.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
                  <div style={{ color: 'var(--t1)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--t0)' }}>{from?.title ?? 'Unknown'}</span> before <span style={{ color: 'var(--t0)' }}>{to?.title ?? 'Unknown'}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove dependency ${from?.title ?? 'source'} to ${to?.title ?? 'target'}`}
                    onClick={() => onDeleteEdge(edge.id)}
                    style={{ border: '1px solid var(--bd)', borderRadius: 5, background: '#f8514918', color: 'var(--red)', cursor: 'pointer', fontSize: 11, padding: '3px 7px' }}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
            <SectionTitle>Node Flow</SectionTitle>
            <div style={{ display: 'flex', gap: 6 }}>
              {selectedNode && <Btn small onClick={() => onEditNode(selectedNode)}>Edit Node</Btn>}
              {selectedNode && <Btn small onClick={() => onAddStep(selectedNode.id)}>+ Step</Btn>}
            </div>
          </div>
          {!selectedNode ? (
            <div style={{ color: 'var(--t1)', fontSize: 12 }}>Select or add a node to define its linear flow.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ border: '1px solid var(--bd)', borderRadius: 7, padding: 10, background: 'var(--bg0)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ color: 'var(--t0)', fontSize: 13, fontWeight: 700 }}>{selectedNode.title}</div>
                  <StatusPill status={selectedNode.status} />
                </div>
                <div style={{ color: nodeIsRunnable ? 'var(--grn)' : 'var(--t1)', fontSize: 11, marginTop: 6 }}>
                  {nodeIsRunnable ? 'Runnable now' : 'Waiting for dependencies or steps'}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {[
                    ['Left', -40, 0],
                    ['Right', 40, 0],
                    ['Up', 0, -40],
                    ['Down', 0, 40],
                  ].map(([label, dx, dy]) => (
                    <button
                      key={label}
                      type="button"
                      aria-label={`Move node ${label}`}
                      onClick={() => onNudgeNode(selectedNode, Number(dx), Number(dy))}
                      style={{ border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg1)', color: 'var(--t1)', cursor: 'pointer', fontSize: 10, padding: '3px 7px' }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {selectedSteps.length === 0 ? (
                <div style={{ border: '1px dashed var(--bd)', borderRadius: 7, padding: 12, color: 'var(--t1)', fontSize: 12 }}>
                  No steps yet. Add a manual step to start shaping this node.
                </div>
              ) : selectedSteps.map((step, index) => (
                <div key={step.id} style={{
                  border: '1px solid var(--bd)',
                  borderRadius: 7,
                  padding: 10,
                  background: 'var(--bg0)',
                  display: 'grid',
                  gridTemplateColumns: '24px minmax(0, 1fr) auto',
                  gap: 9,
                  alignItems: 'center',
                }}>
                  <div style={{ color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--mono)' }}>{index + 1}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: 'var(--t0)', fontSize: 12, fontWeight: 700 }}>{step.title}</div>
                    <div style={{ color: 'var(--t1)', fontSize: 10, marginTop: 3 }}>{step.type}</div>
                    {step.type === 'command' && typeof step.config.command === 'string' && (
                      <div style={{ color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--mono)', marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {step.config.command}
                      </div>
                    )}
                    {step.type === 'agent' && typeof step.config.prompt === 'string' && (
                      <div style={{ color: 'var(--t1)', fontSize: 11, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {step.config.prompt}
                      </div>
                    )}
                    {step.output_summary && <div style={{ color: 'var(--t1)', fontSize: 11, marginTop: 6 }}>{step.output_summary}</div>}
                  </div>
                  {step.status === 'complete' || step.status === 'waiting_for_user' ? (
                    <StatusPill status={step.status} />
                  ) : step.type === 'command' || step.type === 'agent' ? (
                    <button
                      type="button"
                      onClick={() => step.type === 'command' ? onRunCommandStep(step.id) : onRunAgentStep(step.id)}
                      disabled={!selectedNodeWorktree && !taskWorktree}
                      style={{
                        border: '1px solid var(--bd)',
                        borderRadius: 5,
                        background: '#1f6feb22',
                        color: !selectedNodeWorktree && !taskWorktree ? 'var(--t1)' : 'var(--blu)',
                        cursor: !selectedNodeWorktree && !taskWorktree ? 'not-allowed' : 'pointer',
                        fontSize: 11,
                        padding: '4px 7px',
                        fontWeight: 700,
                      }}
                    >
                      Run
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onCompleteStep(step.id)}
                      style={{
                        border: '1px solid var(--bd)',
                        borderRadius: 5,
                        background: '#23863622',
                        color: 'var(--grn)',
                        cursor: 'pointer',
                        fontSize: 11,
                        padding: '4px 7px',
                        fontWeight: 700,
                      }}
                    >
                      Complete
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionTitle>Recent Events</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 9 }}>
            {events.slice(0, 8).map((event) => (
              <div key={event.id} style={{ color: 'var(--t1)', fontSize: 11, lineHeight: 1.45 }}>
                <span style={{ color: 'var(--t0)', fontFamily: 'var(--mono)' }}>{event.type}</span>
                {' '}· {new Date(event.created_at).toLocaleTimeString()}
              </div>
            ))}
            {events.length === 0 && <div style={{ color: 'var(--t1)', fontSize: 12 }}>No events yet.</div>}
          </div>
        </section>
      </div>
    </aside>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div style={{ color: 'var(--t1)', fontSize: 11, fontWeight: 750, textTransform: 'uppercase', letterSpacing: 0 }}>
      {children}
    </div>
  );
}

function WorktreeCard({
  worktree,
  label,
  review,
  proposal,
  preflight,
  stagedIntegration,
  onRefresh,
  onCheckpoint,
  onReview,
  onProposeIntegration,
  onPreflightIntegration,
  onStageIntegration,
  onRemove,
}: {
  worktree: OrchestrationWorktree;
  label: string;
  review?: WorktreeReview;
  proposal?: WorktreeIntegrationProposal;
  preflight?: WorktreeIntegrationPreflight;
  stagedIntegration?: StagedIntegration;
  onRefresh: (worktreeId: string) => void;
  onCheckpoint: (worktreeId: string) => void;
  onReview: (worktreeId: string) => void;
  onProposeIntegration: (worktreeId: string) => void;
  onPreflightIntegration: (worktreeId: string) => void;
  onStageIntegration: (worktreeId: string) => void;
  onRemove: (worktreeId: string) => void;
}) {
  const canCheckpoint = worktree.status !== 'removed' && worktree.dirty_count > 0;
  return (
    <div style={{ border: '1px solid var(--bd)', borderRadius: 7, padding: 10, background: 'var(--bg0)', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ color: 'var(--t0)', fontSize: 12, fontWeight: 700 }}>{label}</div>
        <StatusPill status={worktree.status} />
      </div>
      <div style={{ color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {worktree.kind} / {worktree.branch_name}
      </div>
      <div style={{ color: 'var(--t1)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {worktree.worktree_path}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ color: worktree.dirty_count ? 'var(--yel)' : 'var(--grn)', fontSize: 11 }}>
          {worktree.dirty_count ? `${worktree.dirty_count} changed files` : 'clean'}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {canCheckpoint && (
            <button
              type="button"
              onClick={() => onCheckpoint(worktree.id)}
              style={{ border: '1px solid #2f8f46', borderRadius: 5, background: '#2ea04320', color: 'var(--grn)', cursor: 'pointer', fontSize: 10, padding: '3px 7px' }}
            >
              Checkpoint
            </button>
          )}
          <button
            type="button"
            onClick={() => onRefresh(worktree.id)}
            style={{ border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg1)', color: 'var(--t1)', cursor: 'pointer', fontSize: 10, padding: '3px 7px' }}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => onReview(worktree.id)}
            style={{ border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg1)', color: 'var(--t1)', cursor: 'pointer', fontSize: 10, padding: '3px 7px' }}
          >
            Review
          </button>
          <button
            type="button"
            onClick={() => onProposeIntegration(worktree.id)}
            style={{ border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg1)', color: 'var(--t1)', cursor: 'pointer', fontSize: 10, padding: '3px 7px' }}
          >
            Propose
          </button>
          <button
            type="button"
            onClick={() => onPreflightIntegration(worktree.id)}
            style={{ border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg1)', color: 'var(--t1)', cursor: 'pointer', fontSize: 10, padding: '3px 7px' }}
          >
            Preflight
          </button>
          <button
            type="button"
            onClick={() => onStageIntegration(worktree.id)}
            style={{ border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg1)', color: 'var(--t1)', cursor: 'pointer', fontSize: 10, padding: '3px 7px' }}
          >
            Stage
          </button>
          <button
            type="button"
            onClick={() => onRemove(worktree.id)}
            style={{ border: '1px solid var(--bd)', borderRadius: 5, background: '#f8514918', color: 'var(--red)', cursor: 'pointer', fontSize: 10, padding: '3px 7px' }}
          >
            Remove
          </button>
        </div>
      </div>
      {review && (
        <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 7, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ color: review.ready_to_merge ? 'var(--grn)' : 'var(--yel)', fontSize: 11, fontWeight: 700 }}>
            {review.ready_to_merge ? 'Ready to merge' : 'Needs attention'} - {review.commit_count} commits - {review.files.length} files
          </div>
          {review.shortstat && (
            <div style={{ color: 'var(--t1)', fontSize: 11 }}>{review.shortstat}</div>
          )}
          {review.commits[0] && (
            <div style={{ color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {review.commits[0].short_sha} {review.commits[0].subject}
            </div>
          )}
        </div>
      )}
      {proposal && (
        <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 7, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ color: 'var(--t0)', fontSize: 11, fontWeight: 700 }}>
            {proposal.title}
          </div>
          <div style={{ color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--mono)' }}>
            {proposal.source_branch} -&gt; {proposal.target_branch}
          </div>
          <pre style={{ margin: 0, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap', color: 'var(--t1)', fontSize: 10, fontFamily: 'var(--mono)' }}>
            {proposal.body}
          </pre>
        </div>
      )}
      {preflight && (
        <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 7, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ color: preflight.can_merge ? 'var(--grn)' : 'var(--red)', fontSize: 11, fontWeight: 700 }}>
            {preflight.can_merge ? 'Merge preflight passed' : 'Merge preflight blocked'}
          </div>
          <div style={{ color: 'var(--t1)', fontSize: 11 }}>
            {preflight.message}
          </div>
          <div style={{ color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--mono)' }}>
            {preflight.source_ref} -&gt; {preflight.target_ref} - {preflight.commits_to_merge} commits
          </div>
          {preflight.conflicts[0] && (
            <div style={{ color: 'var(--red)', fontSize: 11 }}>
              {preflight.conflicts.length} conflicts
            </div>
          )}
        </div>
      )}
      {stagedIntegration && (
        <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 7, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ color: stagedIntegration.merged ? 'var(--grn)' : 'var(--yel)', fontSize: 11, fontWeight: 700 }}>
            {stagedIntegration.merged ? 'Integration branch staged' : 'Integration branch needs review'}
          </div>
          <div style={{ color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {stagedIntegration.branch_name}
          </div>
          <div style={{ color: 'var(--t1)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {stagedIntegration.worktree_path}
          </div>
        </div>
      )}
    </div>
  );
}

function NewTaskModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (title: string, description: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="new-orchestration-task-title" style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      background: '#00000088',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ width: 440, border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg1)', padding: 18 }}>
        <div id="new-orchestration-task-title" style={{ color: 'var(--t0)', fontSize: 16, fontWeight: 750, marginBottom: 12 }}>
          New orchestration task
        </div>
        <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Title</label>
        <input
          aria-label="Task title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
          style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8, marginBottom: 12 }}
        />
        <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Description</label>
        <textarea
          aria-label="Task description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          style={{ width: '100%', minHeight: 96, border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary disabled={!title.trim()} onClick={() => onCreate(title.trim(), description.trim())}>Create</Btn>
        </div>
      </div>
    </div>
  );
}

function NodeModal({
  node,
  onClose,
  onSave,
}: {
  node?: OrchestrationNode | null;
  onClose: () => void;
  onSave: (values: {
    title: string;
    description: string;
    status: string;
    provider: string;
    model: string;
    positionX: number;
    positionY: number;
  }) => void;
}) {
  const [title, setTitle] = useState(node?.title ?? '');
  const [description, setDescription] = useState(node?.description ?? '');
  const [status, setStatus] = useState(node?.status ?? 'not_started');
  const [provider, setProvider] = useState(node?.provider ?? '');
  const [model, setModel] = useState(node?.model ?? '');
  const [positionX, setPositionX] = useState(String(Math.round(node?.position_x ?? 0)));
  const [positionY, setPositionY] = useState(String(Math.round(node?.position_y ?? 0)));

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="orchestration-node-title" style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      background: '#00000088',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ width: 520, border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg1)', padding: 18 }}>
        <div id="orchestration-node-title" style={{ color: 'var(--t0)', fontSize: 16, fontWeight: 750, marginBottom: 12 }}>
          {node ? 'Edit DAG node' : 'New DAG node'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 10 }}>
          <div>
            <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Title</label>
            <input
              aria-label="Node title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
              style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8 }}
            />
          </div>
          <div>
            <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Status</label>
            <select
              aria-label="Node status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8 }}
            >
              {NODE_STATUSES.map((item) => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </div>
        <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, margin: '12px 0 5px' }}>Description</label>
        <textarea
          aria-label="Node description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          style={{ width: '100%', minHeight: 82, border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8, resize: 'vertical' }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px 90px', gap: 10, marginTop: 12 }}>
          <div>
            <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Provider</label>
            <input aria-label="Node provider" value={provider} onChange={(event) => setProvider(event.target.value)} style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8 }} />
          </div>
          <div>
            <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Model</label>
            <input aria-label="Node model" value={model} onChange={(event) => setModel(event.target.value)} style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8 }} />
          </div>
          <div>
            <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>X</label>
            <input aria-label="Node x" type="number" value={positionX} onChange={(event) => setPositionX(event.target.value)} style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8 }} />
          </div>
          <div>
            <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Y</label>
            <input aria-label="Node y" type="number" value={positionY} onChange={(event) => setPositionY(event.target.value)} style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8 }} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary disabled={!title.trim()} onClick={() => onSave({
            title: title.trim(),
            description: description.trim(),
            status,
            provider: provider.trim(),
            model: model.trim(),
            positionX: Number(positionX) || 0,
            positionY: Number(positionY) || 0,
          })}>
            Save Node
          </Btn>
        </div>
      </div>
    </div>
  );
}

function StepModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (values: { title: string; description: string; type: string; command: string; prompt: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('manual');
  const [command, setCommand] = useState('');
  const [prompt, setPrompt] = useState('');

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="orchestration-step-title" style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      background: '#00000088',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ width: 440, border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg1)', padding: 18 }}>
        <div id="orchestration-step-title" style={{ color: 'var(--t0)', fontSize: 16, fontWeight: 750, marginBottom: 12 }}>
          New node step
        </div>
        <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Title</label>
        <input
          aria-label="Step title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
          style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8, marginBottom: 12 }}
        />
        <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Type</label>
        <select
          aria-label="Step type"
          value={type}
          onChange={(event) => setType(event.target.value)}
          style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8, marginBottom: 12 }}
        >
          {STEP_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        {type === 'command' && (
          <>
            <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Command</label>
            <input
              aria-label="Step command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8, marginBottom: 12, fontFamily: 'var(--mono)' }}
            />
          </>
        )}
        {type === 'agent' && (
          <>
            <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Agent prompt</label>
            <textarea
              aria-label="Agent prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              style={{ width: '100%', minHeight: 90, border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8, marginBottom: 12, resize: 'vertical' }}
            />
          </>
        )}
        <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Description</label>
        <textarea
          aria-label="Step description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          style={{ width: '100%', minHeight: 82, border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary disabled={!title.trim() || (type === 'command' && !command.trim()) || (type === 'agent' && !prompt.trim())} onClick={() => onCreate({
            title: title.trim(),
            description: description.trim(),
            type,
            command: command.trim(),
            prompt: prompt.trim(),
          })}>Create Step</Btn>
        </div>
      </div>
    </div>
  );
}

function WorktreeModal({
  task,
  node,
  onClose,
  onCreate,
}: {
  task: OrchestrationTaskDetail;
  node?: OrchestrationNode | null;
  onClose: () => void;
  onCreate: (values: { repoPath: string; baseBranch: string; branchName: string; worktreePath: string }) => void;
}) {
  const [repoPath, setRepoPath] = useState(task.base_repo_path ?? '');
  const [baseBranch, setBaseBranch] = useState(task.task_branch ?? task.base_branch ?? 'main');
  const [branchName, setBranchName] = useState('');
  const [worktreePath, setWorktreePath] = useState('');

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="orchestration-worktree-title" style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      background: '#00000088',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ width: 540, border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg1)', padding: 18 }}>
        <div id="orchestration-worktree-title" style={{ color: 'var(--t0)', fontSize: 16, fontWeight: 750, marginBottom: 6 }}>
          Create {node ? 'node' : 'task'} worktree
        </div>
        <div style={{ color: 'var(--t1)', fontSize: 12, marginBottom: 12 }}>
          {node ? node.title : task.title}
        </div>
        <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Repository path</label>
        <input
          aria-label="Repository path"
          value={repoPath}
          onChange={(event) => setRepoPath(event.target.value)}
          autoFocus
          style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8, marginBottom: 12 }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Base branch/ref</label>
            <input aria-label="Base branch" value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8 }} />
          </div>
          <div>
            <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, marginBottom: 5 }}>Branch name</label>
            <input aria-label="Branch name" placeholder="auto-generated" value={branchName} onChange={(event) => setBranchName(event.target.value)} style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8 }} />
          </div>
        </div>
        <label style={{ display: 'block', color: 'var(--t1)', fontSize: 11, margin: '12px 0 5px' }}>Worktree path</label>
        <input
          aria-label="Worktree path"
          placeholder="auto-generated"
          value={worktreePath}
          onChange={(event) => setWorktreePath(event.target.value)}
          style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg0)', color: 'var(--t0)', padding: 8 }}
        />
        <div style={{ color: 'var(--t1)', fontSize: 11, lineHeight: 1.45, marginTop: 10 }}>
          Nidavellir creates the branch and worktree, then records clean/dirty status for provider handoff.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary disabled={!repoPath.trim() || !baseBranch.trim()} onClick={() => onCreate({
            repoPath: repoPath.trim(),
            baseBranch: baseBranch.trim(),
            branchName: branchName.trim(),
            worktreePath: worktreePath.trim(),
          })}>
            Create Worktree
          </Btn>
        </div>
      </div>
    </div>
  );
}

export function PlanScreen() {
  const { agentModels } = useAgentModels();
  const preferredModel = useMemo(() => preferredPlannerModel(agentModels), [agentModels]);
  const [plannerProvider, setPlannerProvider] = useState('claude');
  const [plannerModel, setPlannerModel] = useState('claude-sonnet-4-6');
  const [tasks, setTasks] = useState<OrchestrationTaskSummary[]>([]);
  const [planInboxItems, setPlanInboxItems] = useState<PlanInboxItem[]>([]);
  const [taskInboxItems, setTaskInboxItems] = useState<TaskInboxItem[]>([]);
  const [selectedPlanInboxId, setSelectedPlanInboxId] = useState<string | null>(null);
  const [selectedPlanInboxItem, setSelectedPlanInboxItem] = useState<PlanInboxDetail | null>(null);
  const [plannerModalOpen, setPlannerModalOpen] = useState(false);
  const [specViewerOpen, setSpecViewerOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<OrchestrationTaskDetail | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [events, setEvents] = useState<OrchestrationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingNode, setEditingNode] = useState<OrchestrationNode | null | undefined>(undefined);
  const [addingStepNodeId, setAddingStepNodeId] = useState<string | null>(null);
  const [creatingWorktreeNodeId, setCreatingWorktreeNodeId] = useState<string | null | undefined>(undefined);
  const [worktreeReviews, setWorktreeReviews] = useState<Record<string, WorktreeReview>>({});
  const [worktreeProposals, setWorktreeProposals] = useState<Record<string, WorktreeIntegrationProposal>>({});
  const [worktreePreflights, setWorktreePreflights] = useState<Record<string, WorktreeIntegrationPreflight>>({});
  const [stagedIntegrations, setStagedIntegrations] = useState<Record<string, StagedIntegration>>({});

  const grouped = useMemo(() => {
    const groups: Record<string, OrchestrationTaskSummary[]> = {};
    for (const column of BOARD_COLUMNS) groups[column.id] = [];
    for (const task of tasks) (groups[task.status] ?? groups.backlog).push(task);
    return groups;
  }, [tasks]);

  useEffect(() => {
    if (!preferredModel) return;
    setPlannerProvider((currentProvider) => {
      if (currentProvider && agentModels.some((item) => item.provider_id === currentProvider && item.available)) return currentProvider;
      return preferredModel.provider_id;
    });
    setPlannerModel((currentModel) => {
      if (currentModel && agentModels.some((item) => item.provider_id === plannerProvider && item.model_id === currentModel && item.available)) return currentModel;
      return preferredModel.model_id;
    });
  }, [agentModels, plannerProvider, preferredModel]);

  const updatePlannerModel = (values: { provider: string; model: string }) => {
    setPlannerProvider(values.provider);
    setPlannerModel(values.model);
  };

  const loadInboxes = () => {
    if (typeof fetch !== 'function') return;
    const currentSelectedPlanId = selectedPlanInboxId;
    Promise.all([
      fetch(`${API}/api/orchestration/plan-inbox`).then(async (response) => {
        if (!response.ok) throw new Error(`plan_inbox_${response.status}`);
        return response.json() as Promise<PlanInboxItem[]>;
      }),
      fetch(`${API}/api/orchestration/task-inbox`).then(async (response) => {
        if (!response.ok) throw new Error(`task_inbox_${response.status}`);
        return response.json() as Promise<TaskInboxItem[]>;
      }),
    ])
      .then(([plans, taskItems]) => {
        setPlanInboxItems(plans);
        setTaskInboxItems(taskItems);
        const nextSelectedId = currentSelectedPlanId && plans.some((item) => item.id === currentSelectedPlanId)
          ? currentSelectedPlanId
          : plans[0]?.id ?? null;
        setSelectedPlanInboxId(nextSelectedId);
        if (nextSelectedId) loadPlanInboxDetail(nextSelectedId);
        else setSelectedPlanInboxItem(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_inbox_failed'));
  };

  const loadTasks = () => {
    if (typeof fetch !== 'function') return;
    setLoading(true);
    setError(null);
    fetch(`${API}/api/orchestration/tasks`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_tasks_${response.status}`);
        return response.json() as Promise<OrchestrationTaskSummary[]>;
      })
      .then((items) => {
        setTasks(items);
        if (!selectedTask && items[0]) loadTask(items[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_tasks_failed'))
      .finally(() => setLoading(false));
  };

  const reloadAll = () => {
    loadInboxes();
    loadTasks();
  };

  const loadPlanInboxDetail = (itemId: string) => {
    if (typeof fetch !== 'function') return;
    fetch(`${API}/api/orchestration/plan-inbox/${itemId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`plan_inbox_detail_${response.status}`);
        return response.json() as Promise<PlanInboxDetail>;
      })
      .then((item) => {
        setSelectedPlanInboxId(item.id);
        setSelectedPlanInboxItem(item);
        setPlanInboxItems((current) => [item, ...current.filter((existing) => existing.id !== item.id)]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'plan_inbox_detail_failed'));
  };

  const openPlannerModal = (itemId: string) => {
    setPlannerModalOpen(true);
    loadPlanInboxDetail(itemId);
  };

  const loadTask = (taskId: string) => {
    if (typeof fetch !== 'function') return;
    Promise.all([
      fetch(`${API}/api/orchestration/tasks/${taskId}`).then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_task_${response.status}`);
        return response.json() as Promise<OrchestrationTaskDetail>;
      }),
      fetch(`${API}/api/orchestration/tasks/${taskId}/events`).then(async (response) => {
        if (!response.ok) return [];
        return response.json() as Promise<OrchestrationEvent[]>;
      }),
    ])
      .then(([task, nextEvents]) => {
        setSelectedTask(task);
        setSelectedNodeId((current) => current && task.nodes.some((node) => node.id === current) ? current : task.nodes[0]?.id ?? null);
        setEvents(nextEvents);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_task_failed'));
  };

  useEffect(() => {
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createPlanInboxItem = (values: { rawPlan: string; repoPath: string; baseBranch: string; acceptanceCriteria: string; provider: string; model: string }) => {
    const acceptanceCriteria = values.acceptanceCriteria
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    fetch(`${API}/api/orchestration/plan-inbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawPlan: values.rawPlan,
        repoPath: values.repoPath || null,
        baseBranch: values.baseBranch || null,
        provider: values.provider || null,
        model: values.model || null,
        automationMode: 'supervised',
        maxConcurrency: 1,
        acceptanceCriteria,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`plan_inbox_create_${response.status}`);
        return response.json() as Promise<PlanInboxItem>;
      })
      .then((item) => {
        setPlanInboxItems((current) => [item, ...current.filter((existing) => existing.id !== item.id)]);
        loadPlanInboxDetail(item.id);
        setPlannerModalOpen(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'plan_inbox_create_failed'));
  };

  const createPlannerDiscussionMessage = (content: string) => {
    if (!selectedPlanInboxId) return;
    const userTempId = `pm-user-${Date.now()}`;
    const plannerTempId = `pm-planner-${Date.now()}`;
    const now = new Date().toISOString();
    setSelectedPlanInboxItem((current) => current ? {
      ...current,
      discussion_messages: [
        ...current.discussion_messages,
        {
          id: userTempId,
          plan_inbox_item_id: current.id,
          role: 'user',
          kind: 'message',
          content,
          linked_artifact_id: null,
          metadata: { optimistic: true },
          created_at: now,
        },
        {
          id: plannerTempId,
          plan_inbox_item_id: current.id,
          role: 'planner',
          kind: 'message',
          content: '',
          linked_artifact_id: null,
          metadata: { streaming: true },
          created_at: now,
        },
      ],
    } : current);
    setLoading(true);
    fetch(`${API}/api/orchestration/plan-inbox/${selectedPlanInboxId}/pm-turn/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, provider: plannerProvider || null, model: plannerModel || null }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`planner_pm_turn_${response.status}`);
        if (!response.body) {
          return response.json() as Promise<{ messages: PlannerDiscussionMessage[]; plan: PlanInboxDetail }>;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = '';
        let finalResult: { messages: PlannerDiscussionMessage[]; plan: PlanInboxDetail } | null = null;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          const lines = buffered.split('\n');
          buffered = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as { type: string; content?: string; result?: { messages: PlannerDiscussionMessage[]; plan: PlanInboxDetail } };
            if (event.type === 'chunk' && event.content) {
              const chunk = event.content;
              setSelectedPlanInboxItem((current) => current ? {
                ...current,
                discussion_messages: current.discussion_messages.map((message) => (
                  message.id === plannerTempId ? {
                    ...message,
                    content: `${message.content}${chunk}`,
                    metadata: {
                      ...message.metadata,
                      events: [
                        ...plannerStreamEvents(message),
                        { type: 'answer_delta', content: chunk, provider: plannerProvider } satisfies StreamEvent,
                      ],
                    },
                  } : message
                )),
              } : current);
            } else if (event.type === 'activity' && 'event' in event) {
              const activityEvent = (event as { event: StreamEvent }).event;
              setSelectedPlanInboxItem((current) => current ? {
                ...current,
                discussion_messages: current.discussion_messages.map((message) => (
                  message.id === plannerTempId ? {
                    ...message,
                    metadata: {
                      ...message.metadata,
                      events: [...plannerStreamEvents(message), activityEvent],
                    },
                  } : message
                )),
              } : current);
            } else if (event.type === 'result' && event.result) {
              finalResult = event.result;
            }
          }
        }
        if (buffered.trim()) {
          const event = JSON.parse(buffered) as { type: string; result?: { messages: PlannerDiscussionMessage[]; plan: PlanInboxDetail } };
          if (event.type === 'result' && event.result) finalResult = event.result;
        }
        if (!finalResult) throw new Error('planner_pm_turn_missing_result');
        return finalResult;
      })
      .then((result) => {
        setSelectedPlanInboxItem(result.plan);
        setPlanInboxItems((current) => [result.plan, ...current.filter((item) => item.id !== result.plan.id)]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'planner_pm_turn_failed'))
      .finally(() => setLoading(false));
  };

  const createTask = (title: string, description: string) => {
    fetch(`${API}/api/orchestration/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, status: 'backlog' }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_create_${response.status}`);
        return response.json() as Promise<OrchestrationTaskDetail>;
      })
      .then((task) => {
        setCreating(false);
        setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
        setSelectedTask(task);
        setSelectedNodeId(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_create_failed'));
  };

  const moveTask = (task: OrchestrationTaskSummary, status: string) => {
    fetch(`${API}/api/orchestration/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_move_${response.status}`);
        return response.json() as Promise<OrchestrationTaskDetail>;
      })
      .then((updated) => {
        setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
        if (selectedTask?.id === updated.id) setSelectedTask(updated);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_move_failed'));
  };

  const archiveTask = (task: OrchestrationTaskSummary) => {
    fetch(`${API}/api/orchestration/tasks/${task.id}/archive`, { method: 'POST' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_archive_${response.status}`);
        return response.json() as Promise<OrchestrationTaskDetail>;
      })
      .then((archived) => {
        setTasks((current) => current.filter((item) => item.id !== archived.id));
        if (selectedTask?.id === archived.id) {
          setSelectedTask(null);
          setSelectedNodeId(null);
          setEvents([]);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_archive_failed'));
  };

  const addNode = (values: {
    title: string;
    description: string;
    status: string;
    provider: string;
    model: string;
    positionX: number;
    positionY: number;
  }) => {
    if (!selectedTask) return;
    fetch(`${API}/api/orchestration/tasks/${selectedTask.id}/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: values.title,
        description: values.description,
        status: values.status,
        provider: values.provider || null,
        model: values.model || null,
        positionX: values.positionX,
        positionY: values.positionY,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_node_${response.status}`);
        return response.json() as Promise<OrchestrationNode>;
      })
      .then((node) => {
        setEditingNode(undefined);
        loadTasks();
        loadTask(node.task_id);
        setSelectedNodeId(node.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_node_failed'));
  };

  const updateNode = (node: OrchestrationNode, values: {
    title: string;
    description: string;
    status: string;
    provider: string;
    model: string;
    positionX: number;
    positionY: number;
  }) => {
    fetch(`${API}/api/orchestration/nodes/${node.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: values.title,
        description: values.description,
        status: values.status,
        provider: values.provider || null,
        model: values.model || null,
        positionX: values.positionX,
        positionY: values.positionY,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_node_update_${response.status}`);
        return response.json() as Promise<OrchestrationNode>;
      })
      .then((updated) => {
        setEditingNode(undefined);
        if (selectedTask) {
          loadTasks();
          loadTask(selectedTask.id);
        }
        setSelectedNodeId(updated.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_node_update_failed'));
  };

  const nudgeNode = (node: OrchestrationNode, dx: number, dy: number) => {
    updateNode(node, {
      title: node.title,
      description: node.description,
      status: node.status,
      provider: node.provider ?? '',
      model: node.model ?? '',
      positionX: Math.max(0, Math.round((node.position_x || 0) + dx)),
      positionY: Math.max(0, Math.round((node.position_y || 0) + dy)),
    });
  };

  const addEdge = (fromNodeId: string, toNodeId: string) => {
    if (!selectedTask || !fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
    fetch(`${API}/api/orchestration/tasks/${selectedTask.id}/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromNodeId, toNodeId }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_edge_${response.status}`);
        return response.json() as Promise<OrchestrationEdge>;
      })
      .then(() => {
        loadTasks();
        loadTask(selectedTask.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_edge_failed'));
  };

  const deleteEdge = (edgeId: string) => {
    if (!selectedTask) return;
    fetch(`${API}/api/orchestration/edges/${edgeId}`, { method: 'DELETE' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_edge_delete_${response.status}`);
      })
      .then(() => {
        loadTasks();
        loadTask(selectedTask.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_edge_delete_failed'));
  };

  const addStep = (nodeId: string, values: { title: string; description: string; type: string; command: string; prompt: string }) => {
    fetch(`${API}/api/orchestration/nodes/${nodeId}/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: values.title,
        description: values.description,
        type: values.type,
        config: values.type === 'command'
          ? { command: values.command }
          : values.type === 'agent'
            ? { prompt: values.prompt }
            : {},
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_step_${response.status}`);
        return response.json() as Promise<OrchestrationStep>;
      })
      .then(() => {
        setAddingStepNodeId(null);
        if (selectedTask) {
          loadTasks();
          loadTask(selectedTask.id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_step_failed'));
  };

  const runCommandStep = (stepId: string) => {
    if (!selectedTask) return;
    fetch(`${API}/api/orchestration/steps/${stepId}/run-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: selectedTask.conversation_id ?? null }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_command_step_${response.status}`);
        return response.json();
      })
      .then(() => {
        loadTasks();
        loadTask(selectedTask.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_command_step_failed'));
  };

  const runAgentStep = (stepId: string) => {
    if (!selectedTask) return;
    fetch(`${API}/api/orchestration/steps/${stepId}/run-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: selectedTask.conversation_id ?? null }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_agent_step_${response.status}`);
        return response.json();
      })
      .then(() => {
        loadTasks();
        loadTask(selectedTask.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_agent_step_failed'));
  };

  const completeStep = (stepId: string) => {
    fetch(`${API}/api/orchestration/steps/${stepId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'complete', outputSummary: 'Completed manually from Plan board.' }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_step_status_${response.status}`);
        return response.json() as Promise<OrchestrationStep>;
      })
      .then(() => {
        if (selectedTask) {
          loadTasks();
          loadTask(selectedTask.id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_step_status_failed'));
  };

  const createWorktree = (nodeId: string | null | undefined, values: { repoPath: string; baseBranch: string; branchName: string; worktreePath: string }) => {
    if (!selectedTask) return;
    fetch(`${API}/api/orchestration/tasks/${selectedTask.id}/worktrees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: nodeId || null,
        repoPath: values.repoPath,
        baseBranch: values.baseBranch,
        branchName: values.branchName || null,
        worktreePath: values.worktreePath || null,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_worktree_${response.status}`);
        return response.json() as Promise<OrchestrationWorktree>;
      })
      .then(() => {
        setCreatingWorktreeNodeId(undefined);
        loadTasks();
        loadTask(selectedTask.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_worktree_failed'));
  };

  const refreshWorktree = (worktreeId: string) => {
    if (!selectedTask) return;
    fetch(`${API}/api/orchestration/worktrees/${worktreeId}/refresh`, { method: 'POST' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_worktree_refresh_${response.status}`);
        return response.json() as Promise<OrchestrationWorktree>;
      })
      .then(() => {
        loadTasks();
        loadTask(selectedTask.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_worktree_refresh_failed'));
  };

  const checkpointWorktree = (worktreeId: string) => {
    if (!selectedTask) return;
    fetch(`${API}/api/orchestration/worktrees/${worktreeId}/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_worktree_checkpoint_${response.status}`);
        return response.json();
      })
      .then(() => {
        loadTasks();
        loadTask(selectedTask.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_worktree_checkpoint_failed'));
  };

  const reviewWorktree = (worktreeId: string) => {
    if (!selectedTask) return;
    fetch(`${API}/api/orchestration/worktrees/${worktreeId}/review`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_worktree_review_${response.status}`);
        return response.json() as Promise<{ worktree: OrchestrationWorktree; review: WorktreeReview }>;
      })
      .then((result) => {
        setWorktreeReviews((current) => ({ ...current, [worktreeId]: result.review }));
        loadTasks();
        loadTask(selectedTask.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_worktree_review_failed'));
  };

  const proposeIntegration = (worktreeId: string) => {
    if (!selectedTask) return;
    fetch(`${API}/api/orchestration/worktrees/${worktreeId}/integration-proposal`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_worktree_proposal_${response.status}`);
        return response.json() as Promise<{ worktree: OrchestrationWorktree; proposal: WorktreeIntegrationProposal }>;
      })
      .then((result) => {
        setWorktreeProposals((current) => ({ ...current, [worktreeId]: result.proposal }));
        if (result.proposal.review) {
          setWorktreeReviews((current) => ({ ...current, [worktreeId]: result.proposal.review as WorktreeReview }));
        }
        loadTasks();
        loadTask(selectedTask.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_worktree_proposal_failed'));
  };

  const preflightIntegration = (worktreeId: string) => {
    if (!selectedTask) return;
    fetch(`${API}/api/orchestration/worktrees/${worktreeId}/integration-preflight`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_worktree_preflight_${response.status}`);
        return response.json() as Promise<{ worktree: OrchestrationWorktree; preflight: WorktreeIntegrationPreflight }>;
      })
      .then((result) => {
        setWorktreePreflights((current) => ({ ...current, [worktreeId]: result.preflight }));
        loadTasks();
        loadTask(selectedTask.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_worktree_preflight_failed'));
  };

  const stageIntegration = (worktreeId: string) => {
    if (!selectedTask) return;
    fetch(`${API}/api/orchestration/worktrees/${worktreeId}/integration-worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_worktree_stage_${response.status}`);
        return response.json() as Promise<{ source_worktree: OrchestrationWorktree; integration: StagedIntegration }>;
      })
      .then((result) => {
        setStagedIntegrations((current) => ({ ...current, [worktreeId]: result.integration }));
        loadTasks();
        loadTask(selectedTask.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_worktree_stage_failed'));
  };

  const removeWorktree = (worktreeId: string) => {
    if (!selectedTask) return;
    fetch(`${API}/api/orchestration/worktrees/${worktreeId}`, { method: 'DELETE' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_worktree_remove_${response.status}`);
        return response.json() as Promise<OrchestrationWorktree>;
      })
      .then(() => {
        loadTasks();
        loadTask(selectedTask.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_worktree_remove_failed'));
  };

  const runReadySteps = () => {
    if (!selectedTask) return;
    fetch(`${API}/api/orchestration/tasks/${selectedTask.id}/run-ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: selectedTask.conversation_id ?? null,
        maxSteps: 10,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_run_ready_${response.status}`);
        return response.json();
      })
      .then((result) => {
        loadTasks();
        if (result.task?.id) {
          setSelectedTask(result.task);
          loadTask(result.task.id);
        } else {
          loadTask(selectedTask.id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_run_ready_failed'));
  };

  const runningCount = tasks.filter((task) => task.status === 'running').length;
  const readyCount = tasks.filter((task) => task.status === 'ready').length;

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', background: 'var(--bg0)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <TopBar title="Plan" sub={`${tasks.length} tasks · ${readyCount} ready · ${runningCount} running`}>
          <Btn small onClick={reloadAll} disabled={loading}>Reload</Btn>
          {selectedTask && <Btn small onClick={runReadySteps}>Run Ready</Btn>}
          <Btn small primary onClick={() => setCreating(true)}>+ New Task</Btn>
        </TopBar>

        {error && (
          <div style={{ color: 'var(--red)', fontSize: 12, padding: '8px 20px', borderBottom: '1px solid var(--bd)', background: '#f8514911' }}>
            {error}
          </div>
        )}

        <div style={{
          borderBottom: '1px solid var(--bd)',
          padding: 14,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          overflow: 'auto',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 420px) minmax(260px, 360px)', gap: 12, minWidth: 'min(100%, 700px)', alignItems: 'start' }}>
            <PlanInboxPanel
              items={planInboxItems}
              selectedItemId={selectedPlanInboxId}
              plannerProvider={plannerProvider}
              plannerModel={plannerModel}
              onSelect={loadPlanInboxDetail}
              onOpenPm={openPlannerModal}
              onCreate={createPlanInboxItem}
              loading={loading}
            />
            <TaskInboxPanel items={taskInboxItems} />
          </div>
        </div>

        {plannerModalOpen && (
          <PlannerModal
            item={selectedPlanInboxItem}
            models={agentModels}
            plannerProvider={plannerProvider}
            plannerModel={plannerModel}
            onPlannerModelChange={updatePlannerModel}
            onSend={createPlannerDiscussionMessage}
            onViewSpec={() => setSpecViewerOpen(true)}
            onClose={() => setPlannerModalOpen(false)}
            loading={loading}
          />
        )}

        {specViewerOpen && (
          <SpecViewerModal
            item={selectedPlanInboxItem}
            onClose={() => setSpecViewerOpen(false)}
          />
        )}

        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: 16,
          display: 'grid',
          gridTemplateColumns: `repeat(${BOARD_COLUMNS.length}, minmax(210px, 1fr))`,
          gap: 12,
          alignItems: 'start',
        }}>
          {BOARD_COLUMNS.map((column) => (
            <section key={column.id} style={{
              minHeight: 220,
              border: '1px solid var(--bd)',
              borderRadius: 8,
              background: 'var(--bg1)',
              overflow: 'hidden',
            }}>
              <div style={{
                borderBottom: '1px solid var(--bd)',
                padding: '9px 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}>
                <span style={{ color: 'var(--t0)', fontSize: 12, fontWeight: 750 }}>{column.label}</span>
                <span style={{ color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--mono)' }}>{grouped[column.id]?.length ?? 0}</span>
              </div>
              <div style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 9 }}>
                {(grouped[column.id] ?? []).map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    selected={selectedTask?.id === task.id}
                    onSelect={() => loadTask(task.id)}
                    onMove={(status) => moveTask(task, status)}
                    onArchive={() => archiveTask(task)}
                  />
                ))}
                {(grouped[column.id] ?? []).length === 0 && (
                  <div style={{ border: '1px dashed var(--bd)', borderRadius: 7, padding: 12, color: 'var(--t1)', fontSize: 11, textAlign: 'center' }}>
                    No tasks
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>

      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          events={events}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onAddNode={() => setEditingNode(null)}
          onEditNode={(node) => setEditingNode(node)}
          onNudgeNode={nudgeNode}
          onAddEdge={addEdge}
          onDeleteEdge={deleteEdge}
          onCreateWorktree={(nodeId) => setCreatingWorktreeNodeId(nodeId ?? null)}
          onRefreshWorktree={refreshWorktree}
          onCheckpointWorktree={checkpointWorktree}
          onReviewWorktree={reviewWorktree}
          onProposeIntegration={proposeIntegration}
          onPreflightIntegration={preflightIntegration}
          onStageIntegration={stageIntegration}
          onRemoveWorktree={removeWorktree}
          onAddStep={(nodeId) => setAddingStepNodeId(nodeId)}
          onCompleteStep={completeStep}
          onRunCommandStep={runCommandStep}
          onRunAgentStep={runAgentStep}
          worktreeReviews={worktreeReviews}
          worktreeProposals={worktreeProposals}
          worktreePreflights={worktreePreflights}
          stagedIntegrations={stagedIntegrations}
        />
      )}

      {creating && (
        <NewTaskModal
          onClose={() => setCreating(false)}
          onCreate={createTask}
        />
      )}

      {editingNode !== undefined && (
        <NodeModal
          node={editingNode}
          onClose={() => setEditingNode(undefined)}
          onSave={(values) => {
            if (editingNode) updateNode(editingNode, values);
            else addNode(values);
          }}
        />
      )}

      {addingStepNodeId && (
        <StepModal
          onClose={() => setAddingStepNodeId(null)}
          onCreate={(values) => addStep(addingStepNodeId, values)}
        />
      )}

      {creatingWorktreeNodeId !== undefined && selectedTask && (
        <WorktreeModal
          task={selectedTask}
          node={creatingWorktreeNodeId ? selectedTask.nodes.find((node) => node.id === creatingWorktreeNodeId) : null}
          onClose={() => setCreatingWorktreeNodeId(undefined)}
          onCreate={(values) => createWorktree(creatingWorktreeNodeId, values)}
        />
      )}
    </div>
  );
}
