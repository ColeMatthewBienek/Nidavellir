import { type ChangeEvent, type ClipboardEvent, type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { TopBar } from '../components/shared/TopBar';
import { Btn } from '../components/shared/Btn';
import { SlashMenu, SLASH_CMDS, type SlashCommand } from '../components/chat/SlashMenu';
import { ContextPanel } from '../components/chat/ContextPanel';
import { MessageList } from '../components/chat/MessageList';
import { AgentSelector } from '../components/chat/AgentSelector';
import { useAgentStore } from '../store/agentStore';
import { sendCancel, sendMessage, sendRedirectSteer, sendSteer } from '../lib/agentSocket';
import type { ProviderInfo } from '../lib/types';
import { buildCompletionReport } from '../lib/completionReport';

type PendingAttachmentKind = 'text' | 'image' | 'unsupported';
type PendingAttachment = {
  id: string;
  file: File;
  fileName: string;
  kind: PendingAttachmentKind;
  source: 'drag_drop' | 'clipboard_paste';
  estimatedTokens?: number;
  lineCount?: number;
  reason?: string;
};

type SlashSkill = {
  slug: string;
  name: string;
  enabled: boolean;
  showInSlash: boolean;
};

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif']);
const UNSUPPORTED_EXTENSIONS = new Set(['.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.exe', '.dll']);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

function classifyFile(file: File): PendingAttachmentKind {
  const ext = extensionOf(file.name);
  if (UNSUPPORTED_EXTENSIONS.has(ext)) return 'unsupported';
  if (IMAGE_EXTENSIONS.has(ext) || file.type.startsWith('image/')) return 'image';
  return 'text';
}

function clipboardFileName(file: File, index: number): string {
  if (file.name.trim()) return file.name;
  const extension =
    file.type === 'image/jpeg' ? '.jpg' :
    file.type === 'image/webp' ? '.webp' :
    file.type === 'image/gif'  ? '.gif' :
    '.png';
  return index === 0 ? `clipboard-screenshot${extension}` : `clipboard-screenshot-${index + 1}${extension}`;
}

function fileWithName(file: File, fileName: string): File {
  if (file.name === fileName) return file;
  return new File([file], fileName, { type: file.type, lastModified: file.lastModified });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.includes(',') ? result.split(',', 2)[1] : result);
    };
    reader.readAsDataURL(file);
  });
}

function parseCwdCommand(value: string): { isCwd: boolean; path: string | null } {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/cwd')) return { isCwd: false, path: null };
  if (trimmed !== '/cwd' && !trimmed.startsWith('/cwd ')) return { isCwd: false, path: null };
  const raw = trimmed.slice(4).trim();
  if (!raw) return { isCwd: true, path: null };
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return { isCwd: true, path: raw.slice(1, -1) };
  }
  return { isCwd: true, path: raw };
}

function exportConversationAuditBundle(conversationId: string) {
  window.location.href = `http://localhost:7430/api/conversations/${conversationId}/audit-bundle`;
}

function parseSkillCommand(value: string): { isSkill: boolean; slug: string | null; prompt: string | null } {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/skill')) return { isSkill: false, slug: null, prompt: null };
  if (trimmed !== '/skill' && !trimmed.startsWith('/skill ')) return { isSkill: false, slug: null, prompt: null };
  const rest = trimmed.slice('/skill'.length).trim();
  if (!rest) return { isSkill: true, slug: null, prompt: null };
  const [slug, ...promptParts] = rest.split(/\s+/);
  const prompt = promptParts.join(' ').trim();
  return { isSkill: true, slug, prompt: prompt || null };
}

function steeringCapabilities(providers: ProviderInfo[], selectedModel: string) {
  const providerId = selectedModel.split(':')[0] || 'claude';
  const provider = providers.find((item) => item.id === providerId);
  const supportsLive = provider?.supports_live_steering ?? false;
  return {
    supportsLive,
    supportsQueued: provider?.supports_queued_steering ?? true,
    supportsRedirect: provider?.supports_redirect_steering ?? true,
    label: provider?.steering_label || (supportsLive ? 'Steer' : 'Queue note'),
  };
}

export function ChatScreen() {
  const addMessage    = useAgentStore((s) => s.addMessage);
  const clearMessages = useAgentStore((s) => s.clearMessages);
  const messages      = useAgentStore((s) => s.messages);
  const isStreaming   = useAgentStore((s) => s.isStreaming);
  const conversations = useAgentStore((s) => s.conversations);
  const activeConversationId = useAgentStore((s) => s.activeConversationId);
  const createConversation = useAgentStore((s) => s.createConversation);
  const loadConversation = useAgentStore((s) => s.loadConversation);
  const refreshConversations = useAgentStore((s) => s.refreshConversations);
  const renameConversation = useAgentStore((s) => s.renameConversation);
  const pinConversation = useAgentStore((s) => s.pinConversation);
  const archiveConversation = useAgentStore((s) => s.archiveConversation);
  const setWorkingDirectory = useAgentStore((s) => s.setWorkingDirectory);
  const workingDirectory = useAgentStore((s) => s.workingDirectory);
  const workingDirectoryDisplay = useAgentStore((s) => s.workingDirectoryDisplay);
  const refreshWorkingSetFiles = useAgentStore((s) => s.refreshWorkingSetFiles);
  const selectedModel = useAgentStore((s) => s.selectedModel);
  const providers = useAgentStore((s) => s.providers);

  useEffect(() => {
    const restoredId = useAgentStore.getState().activeConversationId;
    if (restoredId) {
      loadConversation(restoredId)
        .catch(() => {})
        .finally(() => {
          refreshConversations().catch(() => {});
        });
      return;
    }
    refreshConversations().catch(() => {});
  }, [loadConversation, refreshConversations]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !useAgentStore.getState().isStreaming) return;
      event.preventDefault();
      sendCancel();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  const [input, setInput]     = useState('');
  const [ctxOpen, setCtxOpen] = useState(true);
  const [conversationsOpen, setConversationsOpen] = useState(true);
  const [slashHL, setSlashHL] = useState(0);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [slashSkills, setSlashSkills] = useState<SlashSkill[]>([]);

  const slashCommands = useMemo<SlashCommand[]>(() => [
    ...SLASH_CMDS,
    ...slashSkills
      .filter((skill) => skill.enabled && skill.showInSlash)
      .map((skill) => ({
        cmd: `/${skill.slug}`,
        desc: `Invoke ${skill.name}`,
        action: `skill:${skill.slug}`,
      })),
  ], [slashSkills]);
  const slashMatch    = input.match(/^(\/\S*)$/);
  const slashQuery    = slashMatch ? slashMatch[1].toLowerCase() : null;
  const showSlash     = !isStreaming && !!slashQuery;
  const slashFiltered = showSlash ? slashCommands.filter((c) => c.cmd.startsWith(slashQuery!)) : [];
  const cwdCommand = parseCwdCommand(input);
  const skillCommand = parseSkillCommand(input);
  const steering = steeringCapabilities(providers, selectedModel);
  const latestReport = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const report = buildCompletionReport(messages[index]);
      if (report?.changedFiles.length) return report;
    }
    return null;
  }, [messages]);
  const slashMenuActive = showSlash && slashFiltered.length > 0;
  const hasValidAttachments = pendingAttachments.some((file) => file.kind !== 'unsupported');
  const canSubmit = isStreaming
    ? Boolean(input.trim())
    : Boolean(input.trim() || hasValidAttachments) && (!slashMenuActive || cwdCommand.isCwd);
  const pinnedConversations = conversations.filter((conversation) => conversation.pinned);
  const recentConversations = conversations.filter((conversation) => !conversation.pinned);
  const deleteConversation = conversations.find((conversation) => conversation.id === deleteId);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    fetch('http://localhost:7430/api/skills')
      .then((response) => response.ok ? response.json() : [])
      .then((skills: SlashSkill[]) => setSlashSkills(Array.isArray(skills) ? skills : []))
      .catch(() => setSlashSkills([]));
  }, []);

  useEffect(() => {
    const invokeSkill = (event: Event) => {
      const detail = (event as CustomEvent<{ slug?: string }>).detail;
      if (!detail?.slug) return;
      setInput(`/skill ${detail.slug} `);
      window.dispatchEvent(new CustomEvent('nid:navigate', { detail: 'chat' }));
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    const openReview = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setCtxOpen(true);
      if (detail?.path) {
        window.dispatchEvent(new CustomEvent('nid:code-ref-open', { detail }));
      }
      window.dispatchEvent(new CustomEvent('nid:workspace-tab', { detail: 'review' }));
    };
    window.addEventListener('nid:invoke-skill', invokeSkill);
    window.addEventListener('nid:open-review', openReview);
    return () => {
      window.removeEventListener('nid:invoke-skill', invokeSkill);
      window.removeEventListener('nid:open-review', openReview);
    };
  }, []);

  const resizeInput = (value: string) => {
    const inputEl = inputRef.current;
    if (!inputEl) return;
    const lineCount = Math.max(1, value.split(/\r\n|\r|\n/).length);
    const nextHeight = Math.min(180, Math.max(48, lineCount * 24));
    inputEl.style.height = `${nextHeight}px`;
  };

  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setInput(value);
    setSlashHL(0);
    resizeInput(value);
  };

  const handleSlashSelect = (cmd: SlashCommand) => {
    if (cmd.action === 'spawn') {
      setInput('');
      window.dispatchEvent(new CustomEvent('nid:spawn'));
    } else if (cmd.action === 'context') {
      setInput(''); setCtxOpen(true);
    } else if (cmd.action === 'clear') {
      clearMessages(); setInput('');
    } else if (cmd.action === 'cwd') {
      setInput('/cwd ');
    } else if (cmd.action === 'skill') {
      setInput('/skill ');
    } else if (cmd.action.startsWith('skill:')) {
      setInput(`/${cmd.action.slice('skill:'.length)} `);
    } else if (cmd.action === 'help') {
      setInput('');
      addMessage('agent', '**Available commands**\n\n' + slashCommands.map((c) => `\`${c.cmd}\` — ${c.desc}`).join('\n'));
      useAgentStore.getState().finalizeLastAgentMessage();
    } else if (cmd.action.startsWith('nav:')) {
      setInput('');
      window.dispatchEvent(new CustomEvent('nid:navigate', { detail: cmd.action.slice(4) }));
    } else {
      setInput(cmd.cmd + ' ');
    }
    setSlashHL(0);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isStreaming) {
      e.preventDefault();
      sendCancel();
      return;
    }
    if (slashMenuActive) {
      if (e.key === 'ArrowDown')  { e.preventDefault(); setSlashHL((i) => (i + 1) % slashFiltered.length); return; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); setSlashHL((i) => (i - 1 + slashFiltered.length) % slashFiltered.length); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); handleSlashSelect(slashFiltered[slashHL]); return; }
      if (e.key === 'Escape') { setInput(''); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send().catch(() => {}); }
  };

  const addPendingFiles = async (fileList: FileList | File[], source: PendingAttachment['source'] = 'drag_drop') => {
    const files = Array.from(fileList).map((file, index) =>
      source === 'clipboard_paste' ? fileWithName(file, clipboardFileName(file, index)) : file
    );
    const next = await Promise.all(files.map(async (file) => {
      const kind = classifyFile(file);
      const base = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        fileName: file.name,
        kind,
        source,
      };
      if (kind === 'unsupported') {
        return { ...base, reason: 'Unsupported file type' };
      }
      if (kind === 'image') return base;
      try {
        const text = await file.text();
        return {
          ...base,
          estimatedTokens: Math.floor(text.length / 4),
          lineCount: text.split(/\r\n|\r|\n/).length,
        };
      } catch {
        return { ...base, kind: 'unsupported' as const, reason: 'Unsupported file type' };
      }
    }));
    setPendingAttachments((prev) => [...prev, ...next]);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const data = event.clipboardData;
    const files = Array.from(data.files).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) {
      for (const item of Array.from(data.items)) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;
    event.preventDefault();
    addPendingFiles(files, 'clipboard_paste').catch(() => {});
  };

  const uploadPendingAttachments = async (): Promise<boolean> => {
    const valid = pendingAttachments.filter((file) => file.kind !== 'unsupported');
    if (valid.length === 0) return true;
    const conversationId = activeConversationId;
    if (!conversationId) return false;
    const [provider, ...modelParts] = selectedModel.split(':');
    const model = modelParts.join(':');
    const files = await Promise.all(valid.map(async (item) => ({
      fileName: item.fileName,
      mimeType: item.file.type || undefined,
      contentBase64: await fileToBase64(item.file),
    })));
    const source = valid.every((file) => file.source === valid[0]?.source) ? valid[0]?.source : 'mixed';
    const resp = await fetch(`http://localhost:7430/api/conversations/${conversationId}/files/blob`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, provider, model, source }),
    });
    if (!resp.ok) return false;
    const result = await resp.json() as { added: unknown[] };
    if (result.added.length !== valid.length) return false;
    await refreshWorkingSetFiles();
    return true;
  };

  const send = async () => {
    if (isStreaming) {
      const steering = input.trim();
      if (!steering) return;
      if (sendSteer(steering)) setInput('');
      return;
    }
    if (!input.trim() && !hasValidAttachments) return;
    if (cwdCommand.isCwd) {
      if (!cwdCommand.path) {
        const picked = await window.nidavellir?.pickDirectory?.();
        if (!picked) {
          if (!window.nidavellir?.pickDirectory) {
            addMessage('system', `Current working directory: ${workingDirectoryDisplay ?? workingDirectory ?? 'not set'}\nUsage: /cwd /path-to-working-directory`);
          }
          setInput('');
          return;
        }
        const result = await setWorkingDirectory(picked);
        if (result.ok) {
          const suffix = result.warning ? `\nWarning: ${result.warning}` : '';
          addMessage('system', `Working directory changed to ${result.message}${suffix}`);
        } else {
          addMessage('system', `Working directory was not changed: ${result.message}`);
        }
        setInput('');
        return;
      }
      const result = await setWorkingDirectory(cwdCommand.path);
      if (result.ok) {
        const suffix = result.warning ? `\nWarning: ${result.warning}` : '';
        addMessage('system', `Working directory changed to ${result.message}${suffix}`);
      } else {
        addMessage('system', `Working directory was not changed: ${result.message}`);
      }
      setInput('');
      return;
    }
    if (skillCommand.isSkill && (!skillCommand.slug || !skillCommand.prompt)) {
      addMessage('system', 'Usage: /skill skill-slug describe the task');
      setInput('');
      return;
    }
    const content = input.trim() || (
      pendingAttachments.every((file) => file.kind === 'image') ? '[Image attached]' : '[Files attached]'
    );
    const uploaded = await uploadPendingAttachments();
    if (!uploaded) return;
    setInput('');
    setPendingAttachments([]);
    addMessage('user', content);
    if (!sendMessage(content)) {
      useAgentStore.getState().finalizeWithError('agent connection unavailable');
    }
  };

  const beginRename = (id: string, title: string) => {
    setOpenMenuId(null);
    setRenamingId(id);
    setRenameValue(title);
  };

  const finishRename = (id: string) => {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    renameConversation(id, title).catch(() => {});
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const renderConversationRow = (conversation: typeof conversations[number]) => {
    const active = conversation.id === activeConversationId;
    const renaming = conversation.id === renamingId;
    return (
      <div
        key={conversation.id}
        data-testid={`conversation-row-${conversation.id}`}
        aria-selected={active}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'stretch',
          gap: 4,
          borderRadius: 6,
          border: `1px solid ${active ? 'var(--blu)' : 'transparent'}`,
          background: active ? '#1f6feb18' : 'transparent',
          color: active ? 'var(--t0)' : 'var(--t1)',
        }}
      >
        {renaming ? (
          <input
            autoFocus
            placeholder="Conversation name"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={() => finishRename(conversation.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                finishRename(conversation.id);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                cancelRename();
              }
            }}
            style={{
              flex: 1,
              minWidth: 0,
              margin: 6,
              padding: '6px 8px',
              borderRadius: 5,
              border: '1px solid var(--blu)',
              background: 'var(--bg0)',
              color: 'var(--t0)',
              fontSize: 12,
              outline: 'none',
            }}
          />
        ) : (
          <>
            <button
              onClick={() => loadConversation(conversation.id).catch(() => {})}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: 'left',
                padding: '8px 6px 8px 10px',
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                overflow: 'hidden',
              }}
            >
              <div style={{
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {conversation.pinned && <span aria-hidden="true" style={{ color: 'var(--blu)', marginRight: 6 }}>●</span>}
                {conversation.title}
              </div>
              <div style={{ fontSize: 10, color: 'var(--t1)', marginTop: 2 }}>
                {conversation.messageCount} messages
              </div>
            </button>
            <button
              data-testid={`conversation-menu-${conversation.id}`}
              aria-label="Conversation actions"
              onClick={(event) => {
                event.stopPropagation();
                setOpenMenuId((id) => id === conversation.id ? null : conversation.id);
              }}
              style={{
                width: 28,
                flexShrink: 0,
                border: 'none',
                borderLeft: '1px solid #30363d55',
                borderRadius: '0 6px 6px 0',
                background: 'transparent',
                color: 'var(--t1)',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
              }}
            >
              ...
            </button>
            {openMenuId === conversation.id && (
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 0,
                  zIndex: 30,
                  minWidth: 176,
                  padding: 4,
                  borderRadius: 6,
                  border: '1px solid var(--bd)',
                  background: 'var(--bg1)',
                  boxShadow: '0 12px 28px #00000066',
                }}
              >
                <button role="menuitem" onClick={() => beginRename(conversation.id, conversation.title)} style={menuItemStyle}>Rename</button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setOpenMenuId(null);
                    pinConversation(conversation.id, !conversation.pinned).catch(() => {});
                  }}
                  style={menuItemStyle}
                >
                  {conversation.pinned ? 'Unpin Conversation' : 'Pin Conversation'}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setOpenMenuId(null);
                    exportConversationAuditBundle(conversation.id);
                  }}
                  style={menuItemStyle}
                >
                  Export Audit Bundle
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setOpenMenuId(null);
                    setDeleteId(conversation.id);
                  }}
                  style={{ ...menuItemStyle, color: '#ff7b72' }}
                >
                  Delete Conversation
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {conversationsOpen ? (
        <div style={{
          width: 230,
          flexShrink: 0,
          borderRight: '1px solid var(--bd)',
          background: 'var(--bg1)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--bd)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{
              flex: 1,
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--t1)',
              textTransform: 'uppercase',
              letterSpacing: '0.7px',
            }}>Conversations</span>
            <button
              data-testid="new-conversation-button"
              onClick={() => { createConversation().catch(() => {}); }}
              aria-label="New Conversation"
              style={{ fontSize: 16, color: 'var(--t1)', cursor: 'pointer', lineHeight: 1, background: 'transparent', border: 'none', padding: 0 }}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Hide conversations"
              onClick={() => setConversationsOpen(false)}
              style={{ fontSize: 15, color: 'var(--t1)', cursor: 'pointer', lineHeight: 1, background: 'transparent', border: 'none', padding: 0 }}
            >
              ‹
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {pinnedConversations.length > 0 && (
                <>
                  <div style={sectionLabelStyle}>Pinned</div>
                  {pinnedConversations.map(renderConversationRow)}
                  <div style={sectionLabelStyle}>Recent</div>
                </>
              )}
              {recentConversations.map(renderConversationRow)}
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          width: 34,
          flexShrink: 0,
          borderRight: '1px solid var(--bd)',
          background: 'var(--bg1)',
          display: 'flex',
          justifyContent: 'center',
          paddingTop: 10,
        }}>
          <button
            type="button"
            aria-label="Show conversations"
            onClick={() => setConversationsOpen(true)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 5,
              border: '1px solid var(--bd)',
              background: 'var(--bg2)',
              color: 'var(--t1)',
              cursor: 'pointer',
            }}
          >
            ›
          </button>
        </div>
      )}

      {/* Messages */}
      <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar title="chat">
          <AgentSelector compact />
          <div
            data-testid="cwd-indicator"
            title={workingDirectoryDisplay ?? workingDirectory ?? 'No working directory set'}
            style={{
              maxWidth: 320,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 11,
              color: 'var(--t1)',
              background: 'var(--bg2)',
              border: '1px solid var(--bd)',
              borderRadius: 5,
              padding: '4px 9px',
              fontFamily: 'var(--mono)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ color: '#484f58' }}>cwd</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {workingDirectoryDisplay ?? workingDirectory ?? 'not set'}
            </span>
          </div>
          <button
            type="button"
            aria-label="Toggle working set"
            onClick={() => setCtxOpen((o) => !o)}
            style={{
              fontSize: 12,
              color: ctxOpen ? 'var(--t0)' : 'var(--t1)',
              background: 'var(--bg2)',
              border: '1px solid var(--bd)',
              borderRadius: 5,
              padding: '4px 9px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {ctxOpen ? 'Working set' : 'Show working set'}
          </button>
        </TopBar>

        {/* MessageList owns layout and scroll */}
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <MessageList />
        </div>

        {/* Input */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--bd)', background: 'var(--bg1)', flexShrink: 0 }}>
          <div style={{ position: 'relative', width: 'min(920px, 100%)', margin: '0 auto' }}>
            {latestReport && (
              <div
                data-testid="review-changes-strip"
                style={{
                  width: 'min(440px, calc(100% - 40px))',
                  margin: '0 0 -1px 0',
                  border: '1px solid var(--bd)',
                  borderBottom: 'none',
                  borderRadius: '8px 8px 0 0',
                  background: '#30363d66',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '7px 12px',
                  fontSize: 12,
                  color: 'var(--t0)',
                }}
              >
                <span style={{ color: 'var(--t1)' }}>
                  {latestReport.changedFiles.length} {latestReport.changedFiles.length === 1 ? 'file' : 'files'} changed{' '}
                  <span style={{ color: 'var(--grn)', fontFamily: 'var(--mono)' }}>+{latestReport.totalAdditions}</span>{' '}
                  <span style={{ color: 'var(--red)', fontFamily: 'var(--mono)' }}>-{latestReport.totalDeletions}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCtxOpen(true);
                    window.dispatchEvent(new CustomEvent('nid:workspace-tab', { detail: 'review' }));
                  }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--t0)',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                    padding: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Review changes ↗
                </button>
              </div>
            )}
            {showSlash && slashFiltered.length > 0 && (
              <SlashMenu
                query={slashQuery!}
                highlight={slashHL}
                setHighlight={setSlashHL}
                onSelect={handleSlashSelect}
                commands={slashCommands}
              />
            )}
            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-end',
              background: 'var(--bg2)', borderRadius: 8, padding: '10px 12px',
              border: `1px solid ${dragActive ? 'var(--blu)' : showSlash && slashFiltered.length ? 'var(--blu)' : 'var(--bd)'}`,
              transition: 'border-color 0.15s',
              position: 'relative',
            }}
              data-testid="chat-input-dropzone"
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                addPendingFiles(event.dataTransfer.files).catch(() => {});
              }}
            >
              {dragActive && (
                <div style={{
                  position: 'absolute',
                  inset: 4,
                  borderRadius: 6,
                  border: '1px dashed var(--blu)',
                  background: '#1f6feb22',
                  color: 'var(--t0)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  pointerEvents: 'none',
                  zIndex: 2,
                }}>
                  Drop files to add to conversation
                </div>
              )}
              <textarea
                ref={inputRef}
                data-testid="chat-input"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKey}
                onPaste={handlePaste}
                placeholder="Message Nidavellir…   / for commands"
                rows={1}
                disabled={false}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  resize: 'none', fontSize: 13, color: 'var(--t0)', lineHeight: '24px',
                  minHeight: 48, maxHeight: 180, overflowY: 'auto',
                  opacity: 1,
                }}
              />
              <Btn
                primary
                title={isStreaming ? `${steering.label} (Enter)` : 'Send (Enter)'}
                ariaLabel={isStreaming ? steering.label : 'Send'}
                onClick={() => { send().catch(() => {}); }}
                disabled={!canSubmit}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <span>{isStreaming ? steering.label : 'Send'}</span>
                  <span style={{ fontSize: 10, opacity: 0.72, fontFamily: 'var(--mono)' }}>↵</span>
                </span>
              </Btn>
              {isStreaming && steering.supportsQueued && steering.supportsRedirect && (
                <Btn
                  onClick={() => {
                    const text = input.trim();
                    if (!text) return;
                    if (sendRedirectSteer(text)) setInput('');
                  }}
                  disabled={!input.trim()}
                >
                  Redirect
                </Btn>
              )}
            </div>
            {pendingAttachments.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pendingAttachments.map((item) => (
                  <div
                    key={item.id}
                    data-testid={`pending-attachment-${item.fileName}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 8px',
                      borderRadius: 5,
                      border: '1px solid var(--bd)',
                      background: item.kind === 'unsupported' ? '#f8514914' : 'var(--bg2)',
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'var(--t0)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.fileName}
                    </span>
                    <span style={{ fontSize: 11, color: item.kind === 'unsupported' ? 'var(--red)' : 'var(--t1)', flexShrink: 0 }}>
                      {item.kind === 'unsupported'
                        ? item.reason
                        : item.kind === 'image'
                          ? 'Image · vision attachment'
                          : `Text · ${item.lineCount ?? 0} lines · ~${item.estimatedTokens ?? 0} tokens`}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${item.fileName}`}
                      onClick={() => setPendingAttachments((prev) => prev.filter((pending) => pending.id !== item.id))}
                      style={{ border: 'none', background: 'transparent', color: 'var(--t1)', cursor: 'pointer', fontSize: 12 }}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ marginTop: 5, fontSize: 11, color: '#8b949e77', display: 'flex', gap: 16 }}>
            <span>↵ send</span>
            <span>shift+↵ newline</span>
            <span style={{ color: showSlash ? 'var(--blu)' : '#8b949e77' }}>/ commands</span>
            {isStreaming && (
              <span style={{ color: steering.supportsLive ? 'var(--grn)' : '#8b949e99' }}>
                {steering.supportsLive ? 'live steering' : 'queued steering'}
              </span>
            )}
          </div>
        </div>
      </div>

      {ctxOpen && <ContextPanel onClose={() => setCtxOpen(false)} />}
      {deleteConversation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-conversation-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#00000088',
          }}
        >
          <div style={{
            width: 'min(420px, calc(100vw - 32px))',
            borderRadius: 8,
            border: '1px solid var(--bd)',
            background: 'var(--bg1)',
            padding: 18,
            boxShadow: '0 18px 48px #00000099',
          }}>
            <div id="delete-conversation-title" style={{ fontSize: 16, fontWeight: 700, color: 'var(--t0)', marginBottom: 8 }}>
              Delete this conversation?
            </div>
            <div style={{ fontSize: 13, color: 'var(--t1)', lineHeight: 1.5 }}>
              This will remove it from your conversation list. This cannot be undone in the MVP.
            </div>
            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn onClick={() => setDeleteId(null)}>Cancel</Btn>
              <Btn primary onClick={() => {
                const id = deleteConversation.id;
                setDeleteId(null);
                archiveConversation(id).catch(() => {});
              }}>
                Delete Conversation
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const sectionLabelStyle: CSSProperties = {
  padding: '8px 8px 2px',
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--t1)',
  textTransform: 'uppercase',
  letterSpacing: '0.7px',
};

const menuItemStyle: CSSProperties = {
  width: '100%',
  display: 'block',
  padding: '8px 10px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--t0)',
  textAlign: 'left',
  fontSize: 12,
  cursor: 'pointer',
};
