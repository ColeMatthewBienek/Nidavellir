import { useEffect, useMemo, useState } from 'react';
import { TopBar } from '../components/shared/TopBar';
import { Btn } from '../components/shared/Btn';

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

const STATUS_COLORS: Record<string, string> = {
  backlog: 'var(--t1)',
  ready: 'var(--blu)',
  running: 'var(--yel)',
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

function TaskCard({
  task,
  selected,
  onSelect,
  onMove,
}: {
  task: OrchestrationTaskSummary;
  selected: boolean;
  onSelect: () => void;
  onMove: (status: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
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
    </button>
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
  onRemoveWorktree,
  onAddStep,
  onCompleteStep,
  onRunCommandStep,
  onRunAgentStep,
  worktreeReviews,
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
  onRemoveWorktree: (worktreeId: string) => void;
  onAddStep: (nodeId: string) => void;
  onCompleteStep: (stepId: string) => void;
  onRunCommandStep: (stepId: string) => void;
  onRunAgentStep: (stepId: string) => void;
  worktreeReviews: Record<string, WorktreeReview>;
}) {
  const selectedNode = task.nodes.find((node) => node.id === selectedNodeId) ?? task.nodes[0] ?? null;
  const selectedSteps = selectedNode
    ? task.steps.filter((step) => step.node_id === selectedNode.id).sort((a, b) => a.order_index - b.order_index)
    : [];
  const nodeIsRunnable = selectedNode ? task.readiness.runnable.some((item) => item.node_id === selectedNode.id) : false;
  const taskWorktree = task.worktrees.find((worktree) => !worktree.node_id);
  const selectedNodeWorktree = selectedNode ? task.worktrees.find((worktree) => worktree.node_id === selectedNode.id) : null;
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
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
            <SectionTitle>Worktrees</SectionTitle>
            <Btn small onClick={() => onCreateWorktree(null)}>{taskWorktree ? 'New Task Worktree' : '+ Task Worktree'}</Btn>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {taskWorktree ? (
              <WorktreeCard worktree={taskWorktree} label="Task branch" review={worktreeReviews[taskWorktree.id]} onRefresh={onRefreshWorktree} onCheckpoint={onCheckpointWorktree} onReview={onReviewWorktree} onRemove={onRemoveWorktree} />
            ) : (
              <div style={{ border: '1px dashed var(--bd)', borderRadius: 7, padding: 10, color: 'var(--t1)', fontSize: 12 }}>
                No task worktree yet. Node worktrees can still be created directly from the base repo.
              </div>
            )}
            {selectedNode && (
              selectedNodeWorktree ? (
                <WorktreeCard worktree={selectedNodeWorktree} label={`${selectedNode.title} branch`} review={worktreeReviews[selectedNodeWorktree.id]} onRefresh={onRefreshWorktree} onCheckpoint={onCheckpointWorktree} onReview={onReviewWorktree} onRemove={onRemoveWorktree} />
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
                  {step.status === 'complete' ? (
                    <StatusPill status="complete" />
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
  onRefresh,
  onCheckpoint,
  onReview,
  onRemove,
}: {
  worktree: OrchestrationWorktree;
  label: string;
  review?: WorktreeReview;
  onRefresh: (worktreeId: string) => void;
  onCheckpoint: (worktreeId: string) => void;
  onReview: (worktreeId: string) => void;
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
        {worktree.branch_name}
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
  const [tasks, setTasks] = useState<OrchestrationTaskSummary[]>([]);
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

  const grouped = useMemo(() => {
    const groups: Record<string, OrchestrationTaskSummary[]> = {};
    for (const column of BOARD_COLUMNS) groups[column.id] = [];
    for (const task of tasks) (groups[task.status] ?? groups.backlog).push(task);
    return groups;
  }, [tasks]);

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
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <Btn small onClick={loadTasks} disabled={loading}>Reload</Btn>
          {selectedTask && <Btn small onClick={runReadySteps}>Run Ready</Btn>}
          <Btn small primary onClick={() => setCreating(true)}>+ New Task</Btn>
        </TopBar>

        {error && (
          <div style={{ color: 'var(--red)', fontSize: 12, padding: '8px 20px', borderBottom: '1px solid var(--bd)', background: '#f8514911' }}>
            {error}
          </div>
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
          onRemoveWorktree={removeWorktree}
          onAddStep={(nodeId) => setAddingStepNodeId(nodeId)}
          onCompleteStep={completeStep}
          onRunCommandStep={runCommandStep}
          onRunAgentStep={runAgentStep}
          worktreeReviews={worktreeReviews}
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
