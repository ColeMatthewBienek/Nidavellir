import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { TopBar } from '../components/shared/TopBar';
import { Btn } from '../components/shared/Btn';
import { MarkdownRenderer } from '../components/chat/MarkdownRenderer';

const API = 'http://localhost:7430';

type SkillStatus = 'draft' | 'validated' | 'failed_import';
type UiStatus = 'enabled' | 'disabled' | 'needsreview' | 'importfailed';
type FilterStatus = 'all' | 'enabled' | 'disabled' | 'review';

interface SkillTrigger {
  type: string;
  value: string;
  weight?: number;
}

interface SkillInventoryItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  scope: string;
  activationMode: string;
  triggers: SkillTrigger[];
  instructions: {
    core: string;
    constraints: string[];
    steps: string[];
    examples: Record<string, unknown>[];
    anti_patterns: string[];
  };
  requiredCapabilities: Record<string, boolean>;
  priority: number;
  enabled: boolean;
  showInSlash: boolean;
  version: number;
  status: SkillStatus;
  source: {
    format: string;
    origin?: string | null;
    import_path?: string | null;
    repository_url?: string | null;
  };
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface CompilePreview {
  prompt_fragment: string;
  injected_skill_ids: string[];
  suppressed: Array<{ skill_id: string; reason: string }>;
  estimated_tokens: number;
}

interface ImportReport {
  ok: boolean;
  importId: string;
  detectedFormat: string;
  skill?: SkillInventoryItem | null;
  warnings: string[];
  errors: string[];
}

const STATUS_LABELS: Record<UiStatus, string> = {
  enabled: 'Enabled',
  disabled: 'Disabled',
  needsreview: 'Needs Review',
  importfailed: 'Import Failed',
};

const STATUS_COLORS: Record<UiStatus, string> = {
  enabled: '#3fb950',
  disabled: '#8b949e',
  needsreview: '#d29922',
  importfailed: '#f85149',
};

const GROUP_ORDER: UiStatus[] = ['needsreview', 'enabled', 'disabled', 'importfailed'];

const FILTERS: Array<{ key: FilterStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'enabled', label: 'Enabled' },
  { key: 'disabled', label: 'Disabled' },
  { key: 'review', label: 'Needs Review' },
];

function uiStatus(skill: SkillInventoryItem): UiStatus {
  if (skill.status === 'failed_import') return 'importfailed';
  if (skill.enabled) return 'enabled';
  if (skill.source?.format && skill.source.format !== 'native') return 'needsreview';
  return 'disabled';
}

function statusForFilter(filter: FilterStatus): UiStatus | null {
  if (filter === 'review') return 'needsreview';
  if (filter === 'enabled' || filter === 'disabled') return filter;
  return null;
}

function compactId(skill: SkillInventoryItem): string {
  return skill.id.length > 12 ? skill.id.slice(0, 8) : skill.id;
}

function capabilityList(skill: SkillInventoryItem): string[] {
  return Object.entries(skill.requiredCapabilities ?? {})
    .filter(([, enabled]) => enabled)
    .map(([key]) => key.replace(/_/g, '-'));
}

async function fetchSkills(): Promise<SkillInventoryItem[]> {
  const response = await fetch(`${API}/api/skills`);
  if (!response.ok) throw new Error('Failed to load skills');
  return response.json();
}

function StatusBadge({ status }: { status: UiStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 4,
      background: `${color}22`,
      border: `1px solid ${color}44`,
      color,
      fontSize: 9,
      fontWeight: 700,
      flexShrink: 0,
    }}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span style={{
      fontSize: 9,
      padding: '2px 6px',
      background: 'var(--bg2)',
      border: '1px solid var(--bd)',
      borderRadius: 2,
      color: 'var(--t1)',
      fontFamily: 'var(--mono)',
    }}>
      {children}
    </span>
  );
}

function SkillCard({
  skill,
  selected,
  onSelect,
}: {
  skill: SkillInventoryItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = uiStatus(skill);
  const capabilities = capabilityList(skill);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        width: '100%',
        textAlign: 'left',
        background: 'var(--bg1)',
        border: `1px solid ${selected ? 'var(--grn)' : 'var(--bd)'}`,
        borderRadius: 6,
        padding: 14,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              fontFamily: 'var(--mono)',
              fontSize: 10,
              color: 'var(--t1)',
              background: 'var(--bg2)',
              padding: '2px 8px',
              borderRadius: 4,
            }}>
              {compactId(skill)}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t0)' }}>{skill.name}</span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--t1)', margin: 0, lineHeight: 1.6 }}>{skill.description || skill.instructions.core}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {skill.triggers.length ? skill.triggers.map((trigger) => (
          <Tag key={`${trigger.type}-${trigger.value}`}>{trigger.type}: {trigger.value}</Tag>
        )) : <Tag>{skill.activationMode}</Tag>}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <Tag>{skill.source.format}</Tag>
        {capabilities.length ? capabilities.map((capability) => <Tag key={capability}>{capability}</Tag>) : <Tag>no special capability</Tag>}
      </div>

      <div style={{ fontSize: 10, color: 'var(--t1)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span>Version: {skill.version}</span>
        <span>Priority: {skill.priority}</span>
        <span>Scope: {skill.scope}</span>
      </div>
    </button>
  );
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div style={{ fontSize: 9, color: 'var(--t1)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function DetailDrawer({
  skill,
  onClose,
  onToggleEnabled,
  onToggleSlash,
  onInvoke,
}: {
  skill: SkillInventoryItem;
  onClose: () => void;
  onToggleEnabled: (skill: SkillInventoryItem) => void;
  onToggleSlash: (skill: SkillInventoryItem) => void;
  onInvoke: (skill: SkillInventoryItem) => void;
}) {
  return (
    <aside
      aria-label="Skill details"
      style={{
        width: 340,
        borderLeft: '1px solid var(--bd)',
        background: 'var(--bg1)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t0)' }}>{skill.name}</span>
        <button type="button" aria-label="Close skill details" onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--t1)', cursor: 'pointer', fontSize: 14 }}>
          x
        </button>
      </div>

      <div style={{ flex: 1, padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <DrawerSection title="Overview">
          <div style={{ fontSize: 10, color: 'var(--t1)', lineHeight: 1.8 }}>
            <div><span style={{ color: 'var(--t0)', fontWeight: 600 }}>Status:</span> {STATUS_LABELS[uiStatus(skill)]}</div>
            <div><span style={{ color: 'var(--t0)', fontWeight: 600 }}>Source:</span> {skill.source.format}</div>
            <div><span style={{ color: 'var(--t0)', fontWeight: 600 }}>Activation:</span> {skill.activationMode}</div>
            <div><span style={{ color: 'var(--t0)', fontWeight: 600 }}>Slash menu:</span> {skill.showInSlash ? 'shown' : 'hidden'}</div>
            <div><span style={{ color: 'var(--t0)', fontWeight: 600 }}>Scope:</span> {skill.scope}</div>
          </div>
        </DrawerSection>

        <DrawerSection title="Instructions">
          <div style={{ fontSize: 11, color: 'var(--t0)', lineHeight: 1.6, minWidth: 0, overflow: 'hidden' }}>
            <MarkdownRenderer content={skill.instructions.core} />
          </div>
        </DrawerSection>

        <DrawerSection title="Triggers">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {skill.triggers.length ? skill.triggers.map((trigger) => (
              <Tag key={`${trigger.type}-${trigger.value}`}>{trigger.type}: {trigger.value}</Tag>
            )) : <Tag>manual activation</Tag>}
          </div>
        </DrawerSection>

        <DrawerSection title="Capabilities">
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {capabilityList(skill).length ? capabilityList(skill).map((capability) => <Tag key={capability}>{capability}</Tag>) : <Tag>none</Tag>}
          </div>
        </DrawerSection>

        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          border: '1px solid var(--bd)',
          borderRadius: 5,
          background: 'var(--bg0)',
          color: skill.enabled ? 'var(--t0)' : 'var(--t1)',
          fontSize: 12,
          cursor: skill.enabled ? 'pointer' : 'not-allowed',
        }}>
          <input
            type="checkbox"
            checked={skill.showInSlash}
            disabled={!skill.enabled}
            onChange={() => onToggleSlash(skill)}
          />
          Show in / menu
        </label>

        <button
          type="button"
          onClick={() => onToggleEnabled(skill)}
          style={{
            padding: '8px 10px',
            border: '1px solid var(--bd)',
            borderRadius: 5,
            background: skill.enabled ? '#f8514915' : '#3fb95016',
            color: skill.enabled ? 'var(--red)' : 'var(--grn)',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {skill.enabled ? 'Disable Skill' : 'Enable Skill'}
        </button>
        <button
          type="button"
          onClick={() => onInvoke(skill)}
          disabled={!skill.enabled}
          style={{
            padding: '8px 10px',
            border: '1px solid var(--bd)',
            borderRadius: 5,
            background: skill.enabled ? '#1f6feb18' : 'var(--bg2)',
            color: skill.enabled ? 'var(--blu)' : 'var(--t1)',
            cursor: skill.enabled ? 'pointer' : 'not-allowed',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Invoke Skill
        </button>
      </div>
    </aside>
  );
}

function ImportSkillModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (report: ImportReport) => void;
}) {
  const [source, setSource] = useState<'upload' | 'markdown' | 'local'>('upload');
  const [localPath, setLocalPath] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (open) {
      setReport(null);
      setLocalPath('');
      setMarkdown('');
      setUploadFile(null);
      setSource('upload');
      setImporting(false);
    }
  }, [open]);

  if (!open) return null;

  const runImport = async () => {
    setImporting(true);
    try {
      let response: Response;
      if (source === 'local') {
        response = await fetch(`${API}/api/skills/import/local`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: localPath }),
        });
      } else if (source === 'markdown') {
        response = await fetch(`${API}/api/skills/import/markdown`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown }),
        });
      } else {
        if (!uploadFile) return;
        const form = new FormData();
        form.append('file', uploadFile);
        response = await fetch(`${API}/api/skills/import/upload`, {
          method: 'POST',
          body: form,
        });
      }
      const body = await response.json();
      setReport(body);
      onImported(body);
    } finally {
      setImporting(false);
    }
  };

  const browseLocalPath = async () => {
    const picked = await window.nidavellir?.pickSkillPath?.();
    if (picked) setLocalPath(picked);
  };

  const canImport =
    !importing &&
    ((source === 'local' && localPath.trim()) ||
      (source === 'markdown' && markdown.trim()) ||
      (source === 'upload' && uploadFile));

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30 }}>
      <div role="dialog" aria-modal="true" aria-label="Import Skill" style={{ width: 520, maxWidth: 'calc(100vw - 40px)', maxHeight: '80vh', overflow: 'auto', background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 8 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t0)' }}>Import Skill</span>
          <button type="button" aria-label="Close import skill" onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--t1)', cursor: 'pointer', fontSize: 16 }}>x</button>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t1)', marginBottom: 8, textTransform: 'uppercase' }}>Select Source</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                ['upload', 'Upload Skill Package'],
                ['markdown', 'Paste Markdown'],
                ['local', 'Local Folder'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSource(key as 'upload' | 'markdown' | 'local')}
                  style={{
                    padding: '10px 12px',
                    background: source === key ? '#1f6feb18' : 'var(--bg2)',
                    border: `1px solid ${source === key ? 'var(--blu)' : 'var(--bd)'}`,
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12,
                    color: 'var(--t0)',
                    textAlign: 'left',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {source === 'local' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, fontSize: 10, color: 'var(--t1)' }}>
                Local skill path
                <input
                  aria-label="Local skill path"
                  value={localPath}
                  onChange={(event) => setLocalPath(event.target.value)}
                  placeholder="/path/to/SKILL.md"
                  style={{ padding: '8px 10px', background: 'var(--bg0)', border: '1px solid var(--bd)', borderRadius: 4, color: 'var(--t0)', fontFamily: 'var(--mono)', fontSize: 11 }}
                />
              </label>
              <button
                type="button"
                onClick={browseLocalPath}
                style={{ padding: '8px 10px', background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 4, color: 'var(--t0)', cursor: 'pointer', fontSize: 11 }}
              >
                Browse
              </button>
            </div>
          )}

          {source === 'markdown' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16, fontSize: 10, color: 'var(--t1)' }}>
              Pasted skill markdown
              <textarea
                aria-label="Pasted skill markdown"
                value={markdown}
                onChange={(event) => setMarkdown(event.target.value)}
                placeholder="# Skill Name&#10;&#10;Skill instructions..."
                rows={8}
                style={{ padding: '8px 10px', background: 'var(--bg0)', border: '1px solid var(--bd)', borderRadius: 4, color: 'var(--t0)', fontFamily: 'var(--mono)', fontSize: 11, resize: 'vertical' }}
              />
            </label>
          )}

          {source === 'upload' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16, fontSize: 10, color: 'var(--t1)' }}>
              Skill package file
              <input
                aria-label="Skill package file"
                type="file"
                accept=".md,.zip,.yaml,.yml"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                style={{ padding: '8px 10px', background: 'var(--bg0)', border: '1px solid var(--bd)', borderRadius: 4, color: 'var(--t0)', fontSize: 11 }}
              />
            </label>
          )}

          <div style={{ padding: 12, background: '#d2992212', border: '1px solid #d2992233', borderRadius: 4, marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: 'var(--yel)', fontWeight: 700, marginBottom: 4 }}>Security Notice</div>
            <div style={{ fontSize: 9, color: 'var(--yel)', lineHeight: 1.5 }}>
              Imported skills are disabled until reviewed. Nidavellir never executes imported skill files or scripts.
            </div>
          </div>

          {report && (
            <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...report.warnings, ...report.errors].map((message) => (
                <div key={message} style={{ fontSize: 10, color: report.ok ? 'var(--yel)' : 'var(--red)' }}>{message}</div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <Btn small onClick={onClose}>Cancel</Btn>
            <Btn small primary onClick={runImport} disabled={!canImport}>{importing ? 'Importing...' : 'Import'}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkillsScreen() {
  const [skills, setSkills] = useState<SkillInventoryItem[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillInventoryItem | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [showImportModal, setShowImportModal] = useState(false);
  const [preview, setPreview] = useState<CompilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSkills = async () => {
    try {
      setError(null);
      setSkills(await fetchSkills());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skills');
      setSkills([]);
    }
  };

  useEffect(() => {
    loadSkills();
  }, []);

  const enabledCount = skills.filter((skill) => uiStatus(skill) === 'enabled').length;
  const needsReviewCount = skills.filter((skill) => uiStatus(skill) === 'needsreview').length;

  const grouped = useMemo(() => {
    const targetStatus = statusForFilter(filterStatus);
    const filtered = targetStatus ? skills.filter((skill) => uiStatus(skill) === targetStatus) : skills;
    return GROUP_ORDER.reduce<Record<UiStatus, SkillInventoryItem[]>>((acc, status) => {
      acc[status] = filtered.filter((skill) => uiStatus(skill) === status);
      return acc;
    }, {
      needsreview: [],
      enabled: [],
      disabled: [],
      importfailed: [],
    });
  }, [skills, filterStatus]);

  const toggleEnabled = async (skill: SkillInventoryItem) => {
    const response = await fetch(`${API}/api/skills/${skill.id}/enabled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !skill.enabled }),
    });
    const updated = await response.json();
    setSkills((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelectedSkill(updated);
  };

  const toggleSlash = async (skill: SkillInventoryItem) => {
    const response = await fetch(`${API}/api/skills/${skill.id}/slash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showInSlash: !skill.showInSlash }),
    });
    const updated = await response.json();
    setSkills((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelectedSkill(updated);
  };

  const runCompilePreview = async () => {
    const response = await fetch(`${API}/api/skills/compile-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'codex', model: 'gpt-5.5', user_message: 'review implementation' }),
    });
    setPreview(await response.json());
  };

  const invokeSkill = (skill: SkillInventoryItem) => {
    window.dispatchEvent(new CustomEvent('nid:invoke-skill', { detail: { slug: skill.slug } }));
    window.dispatchEvent(new CustomEvent('nid:navigate', { detail: 'chat' }));
  };

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', background: 'var(--bg0)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <TopBar
          title="Skill Inventory"
          sub={`${skills.length} loaded · ${enabledCount} enabled · ${needsReviewCount} needs review`}
        >
          <Btn small onClick={() => setShowImportModal(true)}>+ Import Skill</Btn>
          <Btn small onClick={runCompilePreview}>Compile Preview</Btn>
        </TopBar>

        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--bd)', background: 'var(--bg1)', display: 'flex', gap: 7, flexShrink: 0 }}>
          {FILTERS.map((filter) => {
            const active = filterStatus === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => {
                  setFilterStatus(filter.key);
                  setSelectedSkill(null);
                }}
                style={{
                  padding: '4px 12px',
                  borderRadius: 20,
                  border: `1px solid ${active ? 'var(--grn)' : 'var(--bd)'}`,
                  background: active ? '#3fb95016' : 'var(--bg2)',
                  fontSize: 11,
                  color: active ? 'var(--grn)' : 'var(--t1)',
                  cursor: 'pointer',
                }}
              >
                {filter.label}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{error}</div>}

          {preview && (
            <section style={{ background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 6, padding: 14, marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t0)' }}>Compile Preview</span>
                <span style={{ fontSize: 10, color: 'var(--t1)', fontFamily: 'var(--mono)' }}>{preview.estimated_tokens} tokens</span>
              </div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--t0)', fontSize: 11, lineHeight: 1.6, fontFamily: 'var(--mono)' }}>{preview.prompt_fragment}</pre>
            </section>
          )}

          {GROUP_ORDER.map((status) => {
            const group = grouped[status];
            if (group.length === 0) return null;
            return (
              <section key={status} style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t1)', textTransform: 'uppercase', letterSpacing: 0, marginBottom: 10 }}>
                  {STATUS_LABELS[status]} ({group.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {group.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      selected={selectedSkill?.id === skill.id}
                      onSelect={() => setSelectedSkill(selectedSkill?.id === skill.id ? null : skill)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>

        {selectedSkill && (
          <DetailDrawer
            skill={selectedSkill}
            onClose={() => setSelectedSkill(null)}
            onToggleEnabled={toggleEnabled}
            onToggleSlash={toggleSlash}
            onInvoke={invokeSkill}
          />
        )}
      <ImportSkillModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={(report) => {
          if (report.skill) {
            setSkills((current) => [report.skill!, ...current.filter((item) => item.id !== report.skill!.id)]);
          } else {
            loadSkills();
          }
        }}
      />
    </div>
  );
}
