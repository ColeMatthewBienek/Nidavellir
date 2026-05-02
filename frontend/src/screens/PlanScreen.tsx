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
  output_summary: string;
}

interface OrchestrationReadiness {
  runnable: Array<{ node_id: string; step_id: string; step_type: string }>;
  blocked: Array<{ node_id: string; blocked_by: string[] }>;
}

interface OrchestrationTaskDetail extends OrchestrationTaskSummary {
  nodes: OrchestrationNode[];
  edges: OrchestrationEdge[];
  steps: OrchestrationStep[];
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
  onAddStep,
  onCompleteStep,
}: {
  task: OrchestrationTaskDetail;
  events: OrchestrationEvent[];
  selectedNodeId?: string | null;
  onSelectNode: (nodeId: string) => void;
  onAddNode: () => void;
  onAddStep: (nodeId: string) => void;
  onCompleteStep: (stepId: string) => void;
}) {
  const selectedNode = task.nodes.find((node) => node.id === selectedNodeId) ?? task.nodes[0] ?? null;
  const selectedSteps = selectedNode
    ? task.steps.filter((step) => step.node_id === selectedNode.id).sort((a, b) => a.order_index - b.order_index)
    : [];
  const nodeIsRunnable = selectedNode ? task.readiness.runnable.some((item) => item.node_id === selectedNode.id) : false;

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
            <SectionTitle>DAG</SectionTitle>
            <Btn small onClick={onAddNode}>+ Node</Btn>
          </div>
          <DagView task={task} selectedNodeId={selectedNode?.id} onSelectNode={onSelectNode} />
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
            <SectionTitle>Node Flow</SectionTitle>
            {selectedNode && <Btn small onClick={() => onAddStep(selectedNode.id)}>+ Step</Btn>}
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
                    {step.output_summary && <div style={{ color: 'var(--t1)', fontSize: 11, marginTop: 6 }}>{step.output_summary}</div>}
                  </div>
                  {step.status === 'complete' ? (
                    <StatusPill status="complete" />
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

export function PlanScreen() {
  const [tasks, setTasks] = useState<OrchestrationTaskSummary[]>([]);
  const [selectedTask, setSelectedTask] = useState<OrchestrationTaskDetail | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [events, setEvents] = useState<OrchestrationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  const addNode = () => {
    if (!selectedTask) return;
    const title = window.prompt('Node title');
    if (!title?.trim()) return;
    fetch(`${API}/api/orchestration/tasks/${selectedTask.id}/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim() }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_node_${response.status}`);
        return response.json() as Promise<OrchestrationNode>;
      })
      .then((node) => {
        loadTasks();
        loadTask(node.task_id);
        setSelectedNodeId(node.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_node_failed'));
  };

  const addStep = (nodeId: string) => {
    const title = window.prompt('Step title');
    if (!title?.trim()) return;
    fetch(`${API}/api/orchestration/nodes/${nodeId}/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), type: 'manual' }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`orchestration_step_${response.status}`);
        return response.json() as Promise<OrchestrationStep>;
      })
      .then(() => {
        if (selectedTask) {
          loadTasks();
          loadTask(selectedTask.id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'orchestration_step_failed'));
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

  const runningCount = tasks.filter((task) => task.status === 'running').length;
  const readyCount = tasks.filter((task) => task.status === 'ready').length;

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', background: 'var(--bg0)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <TopBar title="Plan" sub={`${tasks.length} tasks · ${readyCount} ready · ${runningCount} running`}>
          <Btn small onClick={loadTasks} disabled={loading}>Reload</Btn>
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
          onAddNode={addNode}
          onAddStep={addStep}
          onCompleteStep={completeStep}
        />
      )}

      {creating && (
        <NewTaskModal
          onClose={() => setCreating(false)}
          onCreate={createTask}
        />
      )}
    </div>
  );
}
