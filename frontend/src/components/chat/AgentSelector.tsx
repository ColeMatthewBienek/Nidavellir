import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/store/agentStore";
import { sendNewSession, sendSessionSwitch } from "@/lib/agentSocket";
import { useAgentModels } from "@/hooks/useAgentModels";
import { getProviderTheme, TIER_THEME } from "@/lib/providerTheme";
import type { AgentModelDef } from "@/lib/types";
import { HandoffModal } from "./HandoffModal";
import { ToastBar } from "./ToastBar";

// ── Design tokens (match /Design/nidavellir-screens.jsx) ─────────────────────
const BG1  = '#161b22';
const BD   = '#30363d';
const T1   = '#8b949e';
const T0   = '#e6edf3';

function getTierKey(modelId: string): string | null {
  if (modelId.includes("opus"))   return "opus";
  if (modelId.includes("sonnet")) return "sonnet";
  if (modelId.includes("haiku"))  return "haiku";
  if (modelId.includes("qwen"))   return "qwen";
  return null;
}

function ModelRow({
  model,
  isActive,
  onSelect,
  testId,
}: {
  model:    AgentModelDef;
  isActive: boolean;
  onSelect: (m: AgentModelDef) => void;
  testId:   string;
}) {
  const theme   = getProviderTheme(model.provider_id);
  const tierKey = getTierKey(model.model_id);
  const tier    = tierKey ? TIER_THEME[tierKey] : null;

  return (
    <button
      data-testid={testId}
      onClick={() => onSelect(model)}
      disabled={!model.available}
      title={model.description}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        textAlign: 'left',
        background: isActive ? '#1f6feb18' : 'transparent',
        border: 'none',
        borderLeft: isActive ? `2px solid ${theme.color}` : '2px solid transparent',
        cursor: model.available ? 'pointer' : 'not-allowed',
        opacity: model.available ? 1 : 0.4,
        transition: 'background 0.12s',
        color: T0,
      }}
      onMouseEnter={(e) => {
        if (model.available && !isActive)
          (e.currentTarget as HTMLButtonElement).style.background = '#21262d';
      }}
      onMouseLeave={(e) => {
        if (!isActive)
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span style={{
          fontSize: 12,
          fontWeight: 500,
          color: isActive ? theme.color : T0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {model.display_name}
        </span>
        <span style={{ fontSize: 10, color: T1, whiteSpace: 'nowrap' }}>
          {model.cost_tier === "local" ? "local · free" : model.model_id}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
        {tier && (
          <span className={cn("text-[9px] font-mono px-1 py-0.5 rounded border", tier.colorClass, tier.borderClass)}>
            {tier.label}
          </span>
        )}
        {isActive && (
          <span style={{ fontSize: 10, color: theme.color }}>✓</span>
        )}
        {!model.available && (
          <span style={{ fontSize: 9, color: T1 }}>not found</span>
        )}
      </div>
    </button>
  );
}

const PROVIDER_ORDER = ["claude", "codex", "ollama", "gemini"];

interface AgentSelectorProps {
  compact?: boolean;
}

interface DropPos { top: number; left: number; }

export function AgentSelector({ compact = false }: AgentSelectorProps) {
  const selectedModel    = useAgentStore((s) => s.selectedModel);
  const selectedProvider = useAgentStore((s) => s.selectedProvider);
  const setSelectedModel = useAgentStore((s) => s.setSelectedModel);
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const conversationId   = useAgentStore((s) => s.conversationId);
  const messages         = useAgentStore((s) => s.messages);
  const handoffPending   = useAgentStore((s) => s.handoffPending);
  const handoffProvider  = useAgentStore((s) => s.handoffProvider);
  const handoffSummary   = useAgentStore((s) => s.handoffSummary);
  const toastMessage     = useAgentStore((s) => s.toastMessage);
  const setHandoffPending  = useAgentStore((s) => s.setHandoffPending);
  const setHandoffSummary  = useAgentStore((s) => s.setHandoffSummary);
  const setToastMessage    = useAgentStore((s) => s.setToastMessage);
  const { byProvider, loading } = useAgentModels();

  const [open, setOpen]             = useState(false);
  const [dropPos, setDropPos]       = useState<DropPos | null>(null);
  const [pendingModel, setPendingModel] = useState<AgentModelDef | null>(null);

  const wrapRef   = useRef<HTMLDivElement>(null);
  const btnRef    = useRef<HTMLButtonElement>(null);
  const dropRef   = useRef<HTMLDivElement>(null);

  // Outside-click: close when clicking outside both the button wrapper AND the dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !dropRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close on scroll or resize to prevent stale positioning
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const handleToggle = useCallback(() => {
    setOpen((o) => {
      if (!o && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setDropPos({ top: r.bottom + 4, left: r.left });
      }
      return !o;
    });
  }, []);

  const handleSelect = (model: AgentModelDef) => {
    if (!model.available) return;
    setOpen(false);
    // Only show handoff modal when there are visible messages in the current chat.
    // contextTokens alone is too broad — it reflects historical data from the dashboard.
    const hasMeaningfulContext = messages.length > 0;
    if (hasMeaningfulContext) {
      // Show handoff modal before committing to the switch
      setPendingModel(model);
      setHandoffPending(true, model.provider_id);
    } else {
      // No context — switch immediately
      setSelectedModel(model.id);
      sendNewSession(model.provider_id, model.model_id, conversationId);
    }
  };

  const handleHandoffContinue = () => {
    if (!pendingModel) return;
    setSelectedModel(pendingModel.id);
    sendSessionSwitch(pendingModel.provider_id, pendingModel.model_id, "continue", conversationId);
    setHandoffPending(false);
    setPendingModel(null);
  };

  const handleHandoffClean = () => {
    if (!pendingModel) return;
    setSelectedModel(pendingModel.id);
    sendSessionSwitch(pendingModel.provider_id, pendingModel.model_id, "clean", conversationId);
    setHandoffPending(false);
    setPendingModel(null);
  };

  const handleHandoffReview = async () => {
    if (!pendingModel || !conversationId) return;
    try {
      const resp = await fetch(`http://localhost:7430/api/sessions/${conversationId}/snapshot`);
      if (resp.ok) {
        const snap = await resp.json();
        setHandoffSummary(snap.summary ?? null);
      }
    } catch {
      // show modal without summary
    }
    // Summary is now loaded (or not) — modal stays open, user sees it and picks Continue/Clean
  };

  const dotColor =
    connectionStatus === "connected"  ? "#3fb950" :
    connectionStatus === "connecting" ? "#d29922" :
    connectionStatus === "error"      ? "#f85149" :
                                        "#8b949e";

  const activeTheme = getProviderTheme(selectedProvider);

  const buttonLabel = selectedModel
    ? selectedModel.split(":").slice(1).join(":")
        .replace(/^claude-/, "")
        .replace(/-(\d+)-(\d+)$/, " $1.$2")
    : activeTheme.shortName;

  const providerGroups = PROVIDER_ORDER
    .filter((pid) => byProvider[pid]?.length)
    .map((pid) => ({ pid, models: byProvider[pid] }));

  // ── Dropdown — rendered with position:fixed to escape overflow:hidden parents
  const dropdownPanel = open && !loading && dropPos && (
    <div
      ref={dropRef}
      data-testid="provider-dropdown"
      style={{
        position: 'fixed',
        top:  dropPos.top,
        left: dropPos.left,
        zIndex: 9999,
        width: 240,
        background: BG1,
        border: `1px solid ${BD}`,
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
        overflow: 'hidden',
      }}
    >
      {providerGroups.length === 0 ? (
        <div style={{ padding: '10px 12px', fontSize: 11, color: T1 }}>
          No agents available
        </div>
      ) : (
        providerGroups.map(({ pid, models }) => {
          const theme = getProviderTheme(pid);
          return (
            <div key={pid}>
              {/* Provider section header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 12px 4px',
              }}>
                <span style={{ fontSize: 11, color: theme.color }}>{theme.icon}</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, color: theme.color,
                  textTransform: 'uppercase', letterSpacing: '0.7px',
                }}>
                  {theme.shortName}
                </span>
              </div>
              {models.map((m) => (
                <ModelRow
                  key={m.id}
                  model={m}
                  isActive={m.id === selectedModel}
                  onSelect={handleSelect}
                  testId={`provider-option-${m.id}`}
                />
              ))}
              {/* Section divider */}
              <div style={{ height: 1, background: '#21262d', margin: '4px 8px' }} />
            </div>
          );
        })
      )}
    </div>
  );

  // ── Picker button (shared between compact and full mode) ──────────────────
  const pickerButton = (
    <button
      ref={btnRef}
      data-testid="provider-btn"
      onClick={handleToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        background: 'var(--bg2)',
        border: `1px solid ${activeTheme.color}66`,
        borderRadius: 5,
        cursor: 'pointer',
        fontSize: 12,
        color: activeTheme.color,
        outline: 'none',
        fontFamily: 'var(--mono)',
        transition: 'border-color 0.15s',
      }}
    >
      <span style={{ fontSize: 12 }}>{activeTheme.icon}</span>
      <span style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {buttonLabel}
      </span>
      <span style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
    </button>
  );

  // ── Compact mode — button only (dropdown renders fixed into viewport) ───────
  if (compact) {
    return (
      <>
        <div ref={wrapRef} data-testid="agent-selector" style={{ position: 'relative' }}>
          {pickerButton}
        </div>
        {dropdownPanel}
      </>
    );
  }

  // ── Full mode — complete bar with status dot, agent name, status pill ─────
  const statusPillColor =
    connectionStatus === "connected"  ? { border: '#3fb95040', text: '#3fb950', bg: '#3fb95018' } :
    connectionStatus === "connecting" ? { border: '#d2992240', text: '#d29922', bg: '#d2992218' } :
                                        { border: '#8b949e40', text: '#8b949e', bg: '#8b949e18' };

  return (
    <>
      <div
        ref={wrapRef}
        data-testid="agent-selector"
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px',
          borderBottom: `1px solid ${BD}`,
          background: BG1,
        }}
      >
        <span
          data-testid="ws-status-dot"
          style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }}
        />
        <div style={{ position: 'relative' }}>
          {pickerButton}
        </div>
        <span
          data-testid="connection-status"
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 20,
            border: `1px solid ${statusPillColor.border}`,
            color: statusPillColor.text,
            background: statusPillColor.bg,
            fontWeight: 500,
          }}
        >
          {connectionStatus}
        </span>
      </div>
      {dropdownPanel}
      <HandoffModal
        visible={handoffPending}
        newProvider={handoffProvider}
        summary={handoffSummary ?? undefined}
        onContinue={handleHandoffContinue}
        onClean={handleHandoffClean}
        onReview={handleHandoffReview}
        onCancel={() => { setHandoffPending(false); setPendingModel(null); setHandoffSummary(null); }}
      />
      <ToastBar
        message={toastMessage}
        onDismiss={() => setToastMessage("")}
      />
    </>
  );
}
