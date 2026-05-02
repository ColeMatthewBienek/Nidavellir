import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { TopBar } from '../components/shared/TopBar';
import { Btn } from '../components/shared/Btn';
import { MarkdownRenderer } from '../components/chat/MarkdownRenderer';

const API = 'http://localhost:7430';

type SkillStatus = 'draft' | 'validated' | 'failed_import';
type UiStatus = 'enabled' | 'disabled' | 'needsreview' | 'importfailed';
type FilterStatus = 'all' | 'enabled' | 'disabled' | 'review';
type SkillScope = 'global' | 'project' | 'repo' | 'conversation' | 'agent_role';
type SkillActivationMode = 'automatic' | 'manual' | 'explicit_only';

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

type SkillUpdate = {
  name: string;
  slug: string;
  instructions: string;
  scope: SkillScope;
  activationMode: SkillActivationMode;
  triggers: SkillTrigger[];
};

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

const SCOPE_OPTIONS: SkillScope[] = ['global', 'project'];
const ACTIVATION_OPTIONS: SkillActivationMode[] = ['manual', 'automatic', 'explicit_only'];
const TRIGGER_TYPES = ['keyword', 'intent', 'explicit_user_request', 'file_pattern', 'repo', 'agent_role', 'conversation_context'];

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

function capabilityList(skill: SkillInventoryItem): string[] {
  return Object.entries(skill.requiredCapabilities ?? {})
    .filter(([, enabled]) => enabled)
    .map(([key]) => key.replace(/_/g, '-'));
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function activationLabel(value: string): string {
  if (value === 'explicit_only') return 'Explicit only';
  return titleCase(value);
}

function scopeLabel(value: string): string {
  return titleCase(value);
}

function truncateSummary(value: string, maxLength = 140): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}...`;
}

function stripMarkdownForSummary(value: string): string {
  return value
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/[_~]/g, '');
}

function frontmatterDescription(value: string): string | null {
  const match = value.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
  if (!match) return null;
  const description = match[1].match(/^description:\s*['"]?(.+?)['"]?\s*$/im);
  return description?.[1]?.trim() || null;
}

function skillSummary(skill: SkillInventoryItem): string {
  const explicit = skill.description?.trim();
  if (explicit) return truncateSummary(explicit);

  const core = skill.instructions.core ?? '';
  const frontmatter = frontmatterDescription(core);
  if (frontmatter) return truncateSummary(frontmatter);

  const firstUsefulLine = stripMarkdownForSummary(core)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('name:') && !line.startsWith('version:'));

  return firstUsefulLine ? truncateSummary(firstUsefulLine) : 'No summary available.';
}

function compactList(values: string[], limit = 3): string[] {
  if (values.length <= limit) return values;
  return [...values.slice(0, limit), `+${values.length - limit}`];
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  const triggers = compactList(skill.triggers.map((trigger) => `${titleCase(trigger.type)}: ${trigger.value}`), 2);
  const metadata = compactList([
    activationLabel(skill.activationMode),
    scopeLabel(skill.scope),
    titleCase(skill.source.format),
    ...capabilities,
  ], 4);
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
        padding: 12,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
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
              /{skill.slug}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t0)' }}>{skill.name}</span>
          </div>
          <p style={{
            fontSize: 11,
            color: 'var(--t1)',
            margin: 0,
            lineHeight: 1.45,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {skillSummary(skill)}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {triggers.length ? triggers.map((trigger) => <Tag key={trigger}>{trigger}</Tag>) : <Tag>No triggers</Tag>}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {metadata.map((item) => <Tag key={item}>{item}</Tag>)}
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
  onUpdateSkill,
  onDeleteSkill,
  onInvoke,
}: {
  skill: SkillInventoryItem;
  onClose: () => void;
  onToggleEnabled: (skill: SkillInventoryItem) => void;
  onToggleSlash: (skill: SkillInventoryItem) => void;
  onUpdateSkill: (skill: SkillInventoryItem, updates: SkillUpdate) => Promise<void>;
  onDeleteSkill: (skill: SkillInventoryItem) => Promise<void>;
  onInvoke: (skill: SkillInventoryItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(skill.name);
  const [slugDraft, setSlugDraft] = useState(skill.slug);
  const [scopeDraft, setScopeDraft] = useState<SkillScope>(skill.scope as SkillScope);
  const [activationDraft, setActivationDraft] = useState<SkillActivationMode>(skill.activationMode as SkillActivationMode);
  const [triggersDraft, setTriggersDraft] = useState<SkillTrigger[]>(skill.triggers);
  const [instructionDraft, setInstructionDraft] = useState(skill.instructions.core);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setNameDraft(skill.name);
    setSlugDraft(skill.slug);
    setScopeDraft(skill.scope as SkillScope);
    setActivationDraft(skill.activationMode as SkillActivationMode);
    setTriggersDraft(skill.triggers);
    setInstructionDraft(skill.instructions.core);
    setSaveError(null);
  }, [skill.id]);

  useEffect(() => {
    if (!editing) {
      setNameDraft(skill.name);
      setSlugDraft(skill.slug);
      setScopeDraft(skill.scope as SkillScope);
      setActivationDraft(skill.activationMode as SkillActivationMode);
      setTriggersDraft(skill.triggers);
      setInstructionDraft(skill.instructions.core);
    }
  }, [editing, skill.name, skill.slug, skill.scope, skill.activationMode, skill.triggers, skill.instructions.core]);

  const normalizedSlug = normalizeSlug(slugDraft);
  const cleanTriggers = triggersDraft
    .map((trigger) => ({ ...trigger, value: trigger.value.trim() }))
    .filter((trigger) => trigger.value);
  const changed =
    nameDraft.trim() !== skill.name ||
    normalizedSlug !== skill.slug ||
    scopeDraft !== skill.scope ||
    activationDraft !== skill.activationMode ||
    instructionDraft.trim() !== skill.instructions.core ||
    JSON.stringify(cleanTriggers) !== JSON.stringify(skill.triggers);
  const canSave = Boolean(changed && nameDraft.trim() && normalizedSlug && instructionDraft.trim() && !saving);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onUpdateSkill(skill, {
        name: nameDraft.trim(),
        slug: normalizedSlug,
        instructions: instructionDraft.trim(),
        scope: scopeDraft,
        activationMode: activationDraft,
        triggers: cleanTriggers,
      });
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update skill');
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside
      aria-label="Skill details"
      style={{
        width: editing ? 720 : 420,
        minWidth: 340,
        maxWidth: '72vw',
        resize: 'horizontal',
        overflow: 'auto',
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
            <div><span style={{ color: 'var(--t0)', fontWeight: 600 }}>Slash command:</span> /{skill.slug}</div>
            <div><span style={{ color: 'var(--t0)', fontWeight: 600 }}>Source:</span> {titleCase(skill.source.format)}</div>
            <div><span style={{ color: 'var(--t0)', fontWeight: 600 }}>Activation:</span> {activationLabel(skill.activationMode)}</div>
            <div><span style={{ color: 'var(--t0)', fontWeight: 600 }}>Slash menu:</span> {skill.showInSlash ? 'shown' : 'hidden'}</div>
            <div><span style={{ color: 'var(--t0)', fontWeight: 600 }}>Scope:</span> {scopeLabel(skill.scope)}</div>
          </div>
        </DrawerSection>

        <DrawerSection title={editing ? 'Edit Skill' : 'Instructions'}>
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, color: 'var(--t1)', fontSize: 10 }}>
                Skill name
                <input
                  aria-label="Skill name"
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  style={{
                    padding: '8px 10px',
                    background: 'var(--bg0)',
                    border: '1px solid var(--bd)',
                    borderRadius: 5,
                    color: 'var(--t0)',
                    fontSize: 12,
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, color: 'var(--t1)', fontSize: 10 }}>
                Slash command
                <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg0)', border: '1px solid var(--bd)', borderRadius: 5, overflow: 'hidden' }}>
                  <span style={{ paddingLeft: 10, color: 'var(--blu)', fontFamily: 'var(--mono)', fontSize: 12 }}>/</span>
                  <input
                    aria-label="Slash command"
                    value={slugDraft}
                    onChange={(event) => setSlugDraft(event.target.value.replace(/^\/+/, ''))}
                    style={{
                      flex: 1,
                      padding: '8px 10px 8px 2px',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--t0)',
                      fontFamily: 'var(--mono)',
                      fontSize: 12,
                      outline: 'none',
                    }}
                  />
                </div>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5, color: 'var(--t1)', fontSize: 10 }}>
                  Scope
                  <select
                    aria-label="Skill scope"
                    value={scopeDraft}
                    onChange={(event) => setScopeDraft(event.target.value as SkillScope)}
                    style={{
                      padding: '8px 10px',
                      background: 'var(--bg0)',
                      border: '1px solid var(--bd)',
                      borderRadius: 5,
                      color: 'var(--t0)',
                      fontSize: 12,
                    }}
                  >
                    {SCOPE_OPTIONS.map((scope) => (
                      <option key={scope} value={scope}>{scopeLabel(scope)}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5, color: 'var(--t1)', fontSize: 10 }}>
                  Activation
                  <select
                    aria-label="Activation mode"
                    value={activationDraft}
                    onChange={(event) => setActivationDraft(event.target.value as SkillActivationMode)}
                    style={{
                      padding: '8px 10px',
                      background: 'var(--bg0)',
                      border: '1px solid var(--bd)',
                      borderRadius: 5,
                      color: 'var(--t0)',
                      fontSize: 12,
                    }}
                  >
                    {ACTIVATION_OPTIONS.map((mode) => (
                      <option key={mode} value={mode}>{activationLabel(mode)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ color: 'var(--t1)', fontSize: 10 }}>Triggers</div>
                {triggersDraft.map((trigger, index) => (
                  <div key={`${index}-${trigger.type}`} style={{ display: 'grid', gridTemplateColumns: '108px 1fr 28px', gap: 6 }}>
                    <select
                      aria-label="Trigger type"
                      value={trigger.type}
                      onChange={(event) => {
                        const next = [...triggersDraft];
                        next[index] = { ...trigger, type: event.target.value };
                        setTriggersDraft(next);
                      }}
                      style={{ padding: '7px 8px', background: 'var(--bg0)', border: '1px solid var(--bd)', borderRadius: 5, color: 'var(--t0)', fontSize: 11 }}
                    >
                      {TRIGGER_TYPES.map((type) => (
                        <option key={type} value={type}>{titleCase(type)}</option>
                      ))}
                    </select>
                    <input
                      aria-label="Trigger value"
                      value={trigger.value}
                      onChange={(event) => {
                        const next = [...triggersDraft];
                        next[index] = { ...trigger, value: event.target.value };
                        setTriggersDraft(next);
                      }}
                      style={{ padding: '7px 8px', background: 'var(--bg0)', border: '1px solid var(--bd)', borderRadius: 5, color: 'var(--t0)', fontSize: 11 }}
                    />
                    <button
                      type="button"
                      aria-label="Remove trigger"
                      onClick={() => setTriggersDraft((current) => current.filter((_, triggerIndex) => triggerIndex !== index))}
                      style={{ border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg2)', color: 'var(--t1)', cursor: 'pointer' }}
                    >
                      x
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setTriggersDraft((current) => [...current, { type: 'keyword', value: '', weight: 1 }])}
                  style={{
                    padding: '7px 10px',
                    border: '1px solid var(--bd)',
                    borderRadius: 5,
                    background: 'var(--bg2)',
                    color: 'var(--t0)',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  Add Trigger
                </button>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, color: 'var(--t1)', fontSize: 10 }}>
                Skill text
                <textarea
                  aria-label="Skill text"
                  value={instructionDraft}
                  onChange={(event) => setInstructionDraft(event.target.value)}
                  rows={12}
                  style={{
                    padding: '8px 10px',
                    background: 'var(--bg0)',
                    border: '1px solid var(--bd)',
                    borderRadius: 5,
                    color: 'var(--t0)',
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    lineHeight: 1.5,
                    resize: 'vertical',
                  }}
                />
              </label>
              {saveError && <div style={{ color: 'var(--red)', fontSize: 11 }}>{saveError}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    border: '1px solid var(--bd)',
                    borderRadius: 5,
                    background: 'var(--bg2)',
                    color: 'var(--t0)',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!canSave}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    border: '1px solid var(--bd)',
                    borderRadius: 5,
                    background: canSave ? '#3fb95016' : 'var(--bg2)',
                    color: canSave ? 'var(--grn)' : 'var(--t1)',
                    cursor: canSave ? 'pointer' : 'not-allowed',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--t0)', lineHeight: 1.6, minWidth: 0, overflow: 'hidden' }}>
              <MarkdownRenderer content={skill.instructions.core} />
            </div>
          )}
        </DrawerSection>

        <DrawerSection title="Triggers">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {skill.triggers.length ? skill.triggers.map((trigger) => (
              <Tag key={`${trigger.type}-${trigger.value}`}>{titleCase(trigger.type)}: {trigger.value}</Tag>
            )) : <Tag>No configured triggers</Tag>}
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
          onClick={() => setEditing((value) => !value)}
          style={{
            padding: '8px 10px',
            border: '1px solid var(--bd)',
            borderRadius: 5,
            background: editing ? '#1f6feb18' : 'var(--bg2)',
            color: editing ? 'var(--blu)' : 'var(--t0)',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {editing ? 'Editing Skill' : 'Edit Skill'}
        </button>

        <button
          type="button"
          onClick={() => {
            const ok = window.confirm(`Delete skill "${skill.name}" (/${skill.slug})? This cannot be undone.`);
            if (ok) onDeleteSkill(skill).catch(() => setSaveError('Failed to delete skill'));
          }}
          style={{
            padding: '8px 10px',
            border: '1px solid #f8514944',
            borderRadius: 5,
            background: '#f8514915',
            color: 'var(--red)',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Delete Skill
        </button>

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
    window.dispatchEvent(new CustomEvent('nid:skills-changed'));
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
    window.dispatchEvent(new CustomEvent('nid:skills-changed'));
  };

  const updateSkill = async (skill: SkillInventoryItem, updates: SkillUpdate) => {
    const response = await fetch(`${API}/api/skills/${skill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error(`skill_update_${response.status}`);
    const updated = await response.json();
    setSkills((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelectedSkill(updated);
    window.dispatchEvent(new CustomEvent('nid:skills-changed'));
  };

  const deleteSkill = async (skill: SkillInventoryItem) => {
    const response = await fetch(`${API}/api/skills/${skill.id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error(`skill_delete_${response.status}`);
    setSkills((current) => current.filter((item) => item.id !== skill.id));
    setSelectedSkill(null);
    window.dispatchEvent(new CustomEvent('nid:skills-changed'));
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
            onUpdateSkill={updateSkill}
            onDeleteSkill={deleteSkill}
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
          window.dispatchEvent(new CustomEvent('nid:skills-changed'));
        }}
      />
    </div>
  );
}
