// SkillInventory.jsx — Standalone Skill Inventory component for integration
// React 18.3.1, standalone — copy into your screens/ folder

const { useState } = React;

// ─── SKILL DATA & CONSTANTS ──────────────────────────────────────────────────

const SKILL_DATA = [
  {
    id: '01',
    slug: 'spec-authoring',
    name: 'Agent Handoff Spec Authoring',
    status: 'enabled',
    sourceFormat: 'native',
    desc: 'Produces agent-ready implementation specs with strict TDD, file map, current state, tests-first plan, and acceptance criteria.',
    triggers: [
      { type: 'intent', val: 'implementation spec', weight: 0.9 },
      { type: 'keyword', val: 'TDD', weight: 0.8 },
    ],
    capabilities: ['file-read', 'file-write', 'code-exec'],
    providers: [
      { p: 'Claude', s: 'compatible' },
      { p: 'Codex', s: 'compatible' },
      { p: 'Gemini', s: 'degraded' },
      { p: 'Ollama', s: 'unsupported' },
    ],
    lastActivated: 'today',
    runs: 38,
    scope: 'Global',
  },
  {
    id: '02',
    slug: 'code-review',
    name: 'Severity-Rated Code Review',
    status: 'enabled',
    sourceFormat: 'claude_skill',
    desc: 'Reviews code for correctness, style, and completeness. Produces severity-rated feedback with actionable fixes.',
    triggers: [
      { type: 'keyword', val: 'review', weight: 0.7 },
      { type: 'keyword', val: 'audit', weight: 0.6 },
    ],
    capabilities: ['file-read', 'vision'],
    providers: [
      { p: 'Claude', s: 'compatible' },
      { p: 'Codex', s: 'compatible' },
      { p: 'Gemini', s: 'compatible' },
      { p: 'Ollama', s: 'degraded' },
    ],
    lastActivated: '1h ago',
    runs: 67,
    scope: 'Global',
  },
  {
    id: '03',
    slug: 'requirements-gathering',
    name: 'Structured Requirements Interviewer',
    status: 'needsreview',
    sourceFormat: 'imported_repo',
    desc: 'Gathers requirements through structured dialogue. Extracts intent, constraints, edge cases with clarifying questions.',
    triggers: [{ type: 'intent', val: 'requirements', weight: 0.8 }],
    capabilities: ['long-context'],
    providers: [
      { p: 'Claude', s: 'compatible' },
      { p: 'Codex', s: 'compatible' },
      { p: 'Gemini', s: 'compatible' },
      { p: 'Ollama', s: 'compatible' },
    ],
    lastActivated: '3h ago',
    runs: 21,
    scope: 'Project',
  },
  {
    id: '04',
    slug: 'task-dag-orchestrator',
    name: 'Task DAG Orchestrator',
    status: 'enabled',
    sourceFormat: 'native',
    desc: 'Decomposes specs into task DAGs, assigns agents, sequences work, and monitors completion with real-time status.',
    triggers: [
      { type: 'intent', val: 'plan', weight: 0.9 },
      { type: 'keyword', val: 'schedule', weight: 0.7 },
    ],
    capabilities: ['file-write', 'shell'],
    providers: [
      { p: 'Claude', s: 'compatible' },
      { p: 'Codex', s: 'degraded' },
      { p: 'Gemini', s: 'unsupported' },
      { p: 'Ollama', s: 'unsupported' },
    ],
    lastActivated: '2h ago',
    runs: 15,
    scope: 'Global',
  },
];

const STATUS_COLORS = {
  enabled: '#10b981',    // GRN
  disabled: '#808080',   // T1
  needsreview: '#f59e0b', // YEL
  importfailed: '#ef4444', // RED
};

const STATUS_LABELS = {
  enabled: 'Enabled',
  disabled: 'Disabled',
  needsreview: 'Needs Review',
  importfailed: 'Import Failed',
};

// Color variables (match Nidavellir theme)
const colors = {
  BG0: '#000000',
  BG1: '#0a0a0a',
  BG2: '#1a1a1a',
  T0: '#ffffff',
  T1: '#808080',
  BD: '#2a2a2a',
  GRN: '#10b981',
  YEL: '#f59e0b',
  RED: '#ef4444',
};

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

function ProviderChip({ p, s }) {
  const compatColors = {
    compatible: colors.GRN,
    degraded: colors.YEL,
    unsupported: colors.RED,
    unknown: colors.T1,
  };

  const compatSymbols = {
    compatible: '✓',
    degraded: '⚠',
    unsupported: '✕',
    unknown: '?',
  };

  const col = compatColors[s] || colors.T1;
  const sym = compatSymbols[s] || '?';

  return (
    <span
      title={`${p}: ${s}`}
      style={{
        fontSize: '9px',
        padding: '2px 6px',
        background: colors.BG2,
        border: `1px solid ${col}33`,
        borderRadius: '3px',
        color: col,
        fontFamily: "'Monaco', monospace",
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
      }}
    >
      {p} <span style={{ fontSize: '8px' }}>{sym}</span>
    </span>
  );
}

function SkillCard({ skill, isSelected, onSelect }) {
  return (
    <div
      onClick={() => onSelect(isSelected ? null : skill)}
      style={{
        background: colors.BG1,
        border: `1px solid ${isSelected ? colors.GRN : colors.BD}`,
        borderRadius: '6px',
        padding: '14px',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {/* Header Row: ID + Name + Status Badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '10px',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '4px',
            }}
          >
            <span
              style={{
                fontFamily: "'Monaco', monospace",
                fontSize: '10px',
                color: colors.T1,
              }}
            >
              {skill.id}
            </span>
            <span
              style={{
                fontSize: '13px',
                fontWeight: '600',
                color: colors.T0,
              }}
            >
              {skill.name}
            </span>
          </div>
          <p
            style={{
              fontSize: '11px',
              color: colors.T1,
              margin: '0',
              lineHeight: '1.6',
            }}
          >
            {skill.desc}
          </p>
        </div>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: '4px',
            background: `${STATUS_COLORS[skill.status]}22`,
            border: `1px solid ${STATUS_COLORS[skill.status]}44`,
            fontSize: '9px',
            fontWeight: '600',
            color: STATUS_COLORS[skill.status],
            textTransform: 'capitalize',
            flexShrink: 0,
          }}
        >
          {STATUS_LABELS[skill.status]}
        </span>
      </div>

      {/* Triggers Row */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {skill.triggers.map((t, i) => (
          <span
            key={i}
            style={{
              fontSize: '9px',
              padding: '2px 6px',
              background: colors.BG2,
              border: `1px solid ${colors.BD}`,
              borderRadius: '2px',
              color: colors.T1,
              fontFamily: "'Monaco', monospace",
            }}
          >
            {t.type}: {t.val}
          </span>
        ))}
      </div>

      {/* Providers Row */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {skill.providers.map((prov, i) => (
          <ProviderChip key={i} p={prov.p} s={prov.s} />
        ))}
      </div>

      {/* Footer Stats */}
      <div
        style={{
          fontSize: '10px',
          color: colors.T1,
          display: 'flex',
          gap: '16px',
        }}
      >
        <span>Last: {skill.lastActivated || 'never'}</span>
        <span>{skill.runs} runs</span>
        <span>Scope: {skill.scope}</span>
      </div>
    </div>
  );
}

function DetailDrawer({ skill, onClose }) {
  if (!skill) return null;

  return (
    <div
      style={{
        width: '300px',
        borderLeft: `1px solid ${colors.BD}`,
        background: colors.BG1,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: `1px solid ${colors.BD}`,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: '600', color: colors.T0 }}>
          {skill.name}
        </span>
        <span
          onClick={onClose}
          style={{ cursor: 'pointer', color: colors.T1, fontSize: '14px' }}
        >
          ✕
        </span>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          padding: '12px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {/* Overview Section */}
        <div>
          <div
            style={{
              fontSize: '9px',
              color: colors.T1,
              marginBottom: '6px',
              textTransform: 'uppercase',
              fontWeight: '600',
            }}
          >
            Overview
          </div>
          <div
            style={{
              fontSize: '10px',
              color: colors.T1,
              lineHeight: '1.6',
            }}
          >
            <div>
              <span style={{ color: colors.T0, fontWeight: '500' }}>Status:</span>{' '}
              {STATUS_LABELS[skill.status]}
            </div>
            <div>
              <span style={{ color: colors.T0, fontWeight: '500' }}>Source:</span>{' '}
              {skill.sourceFormat}
            </div>
            <div>
              <span style={{ color: colors.T0, fontWeight: '500' }}>Scope:</span>{' '}
              {skill.scope}
            </div>
          </div>
        </div>

        {/* Triggers Section */}
        <div>
          <div
            style={{
              fontSize: '9px',
              color: colors.T1,
              marginBottom: '6px',
              textTransform: 'uppercase',
              fontWeight: '600',
            }}
          >
            Triggers
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {skill.triggers.map((t, i) => (
              <div
                key={i}
                style={{
                  fontSize: '9px',
                  color: colors.T1,
                  padding: '4px 6px',
                  background: colors.BG0,
                  borderRadius: '2px',
                  fontFamily: "'Monaco', monospace",
                }}
              >
                <span style={{ color: colors.GRN }}>{t.type}:</span> {t.val}
              </div>
            ))}
          </div>
        </div>

        {/* Capabilities Section */}
        <div>
          <div
            style={{
              fontSize: '9px',
              color: colors.T1,
              marginBottom: '6px',
              textTransform: 'uppercase',
              fontWeight: '600',
            }}
          >
            Capabilities
          </div>
          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
            {skill.capabilities.map((c) => (
              <span
                key={c}
                style={{
                  fontSize: '8px',
                  padding: '2px 5px',
                  background: colors.BG0,
                  border: `1px solid ${colors.BD}`,
                  borderRadius: '2px',
                  color: colors.T1,
                  fontFamily: "'Monaco', monospace",
                }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Compatibility Section */}
        <div>
          <div
            style={{
              fontSize: '9px',
              color: colors.T1,
              marginBottom: '6px',
              textTransform: 'uppercase',
              fontWeight: '600',
            }}
          >
            Compatibility
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {skill.providers.map((prov, i) => (
              <ProviderChip key={i} p={prov.p} s={prov.s} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportSkillModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#00000088',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 30,
      }}
    >
      <div
        style={{
          background: colors.BG1,
          border: `1px solid ${colors.BD}`,
          borderRadius: '8px',
          width: '500px',
          maxHeight: '80vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${colors.BD}`,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: '14px', fontWeight: '600', color: colors.T0 }}>
            Import Skill
          </span>
          <span
            onClick={onClose}
            style={{ cursor: 'pointer', fontSize: '16px', color: colors.T1 }}
          >
            ✕
          </span>
        </div>

        {/* Content */}
        <div style={{ padding: '20px', flex: 1 }}>
          {/* Source Selection */}
          <div style={{ marginBottom: '16px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: '600',
                color: colors.T1,
                marginBottom: '8px',
                textTransform: 'uppercase',
              }}
            >
              Select Source
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {['Upload Skill Package', 'Paste Markdown', 'Local Folder'].map((opt) => (
                <div
                  key={opt}
                  onClick={() => {}}
                  style={{
                    padding: '10px 12px',
                    background: colors.BG2,
                    border: `1px solid ${colors.BD}`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: colors.T0,
                  }}
                >
                  {opt}
                </div>
              ))}
            </div>
          </div>

          {/* Security Notice */}
          <div
            style={{
              padding: '12px',
              background: `${colors.YEL}12`,
              border: `1px solid ${colors.YEL}33`,
              borderRadius: '4px',
              marginBottom: '16px',
            }}
          >
            <div
              style={{
                fontSize: '10px',
                color: colors.YEL,
                fontWeight: '600',
                marginBottom: '4px',
              }}
            >
              Security Notice
            </div>
            <div style={{ fontSize: '9px', color: colors.YEL, lineHeight: '1.5' }}>
              Imported skills are disabled until reviewed. Nidavellir never executes imported
              skill files or scripts.
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: `1px solid ${colors.BD}`,
                background: colors.BG2,
                color: colors.T0,
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Cancel
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: `1px solid ${colors.GRN}`,
                background: colors.GRN,
                color: colors.BG1,
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
              }}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────

export function SkillInventory() {
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [showImportModal, setShowImportModal] = useState(false);

  const enabled = SKILL_DATA.filter((s) => s.status === 'enabled').length;
  const needsReview = SKILL_DATA.filter((s) => s.status === 'needsreview').length;

  // Filter skills
  const filtered =
    filterStatus === 'all'
      ? SKILL_DATA
      : SKILL_DATA.filter((s) => {
          if (filterStatus === 'enabled') return s.status === 'enabled';
          if (filterStatus === 'disabled') return s.status === 'disabled';
          if (filterStatus === 'review') return s.status === 'needsreview';
          return true;
        });

  // Group filtered skills by status
  const grouped = {
    needsreview: [],
    enabled: [],
    disabled: [],
    importfailed: [],
  };
  filtered.forEach((s) => {
    if (s.status === 'needsreview') grouped.needsreview.push(s);
    else if (s.status === 'enabled') grouped.enabled.push(s);
    else if (s.status === 'disabled') grouped.disabled.push(s);
    else grouped.importfailed.push(s);
  });

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        overflow: 'hidden',
        background: colors.BG0,
      }}
    >
      {/* Main List Area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: `1px solid ${colors.BD}`,
            background: colors.BG1,
            flexShrink: 0,
          }}
        >
          <div style={{ marginBottom: '8px' }}>
            <h2 style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: '600', color: colors.T0 }}>
              Skill Inventory
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: '12px',
                color: colors.T1,
              }}
            >
              {SKILL_DATA.length} loaded · {enabled} enabled · {needsReview} needs review
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowImportModal(true)}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: `1px solid ${colors.BD}`,
                background: colors.BG2,
                color: colors.T0,
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              + Import Skill
            </button>
            <button
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: `1px solid ${colors.BD}`,
                background: colors.BG2,
                color: colors.T0,
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Compile Preview
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div
          style={{
            padding: '10px 20px',
            borderBottom: `1px solid ${colors.BD}`,
            background: colors.BG1,
            display: 'flex',
            gap: '7px',
            flexShrink: 0,
          }}
        >
          {[
            { key: 'all', label: 'All' },
            { key: 'enabled', label: 'Enabled' },
            { key: 'disabled', label: 'Disabled' },
            { key: 'review', label: 'Needs Review' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setFilterStatus(key);
                setSelectedSkill(null); // Close drawer when filter changes
              }}
              style={{
                padding: '4px 12px',
                borderRadius: '20px',
                border: `1px solid ${filterStatus === key ? colors.GRN : colors.BD}`,
                background: filterStatus === key ? `${colors.GRN}16` : colors.BG2,
                fontSize: '11px',
                color: filterStatus === key ? colors.GRN : colors.T1,
                cursor: 'pointer',
                transition: 'all 0.15s',
                textTransform: 'capitalize',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Skills List */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '20px',
          }}
        >
          {Object.entries(grouped).map(([group, skills]) =>
            skills.length > 0 ? (
              <div key={group} style={{ marginBottom: '28px' }}>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: '600',
                    color: colors.T1,
                    textTransform: 'uppercase',
                    letterSpacing: '0.7px',
                    marginBottom: '10px',
                  }}
                >
                  {group === 'needsreview'
                    ? 'Needs Review'
                    : group.charAt(0).toUpperCase() + group.slice(1)}{' '}
                  ({skills.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {skills.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      isSelected={selectedSkill?.id === skill.id}
                      onSelect={setSelectedSkill}
                    />
                  ))}
                </div>
              </div>
            ) : null
          )}
        </div>
      </div>

      {/* Detail Drawer */}
      {selectedSkill && (
        <DetailDrawer skill={selectedSkill} onClose={() => setSelectedSkill(null)} />
      )}

      {/* Import Modal */}
      <ImportSkillModal isOpen={showImportModal} onClose={() => setShowImportModal(false)} />
    </div>
  );
}

// Export for use in other components
Object.assign(window, { SkillInventory });
