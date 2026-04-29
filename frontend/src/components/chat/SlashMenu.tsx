export interface SlashCommand {
  cmd: string;
  desc: string;
  action: string;
}

export const SLASH_CMDS: SlashCommand[] = [
  { cmd: '/plan',    desc: 'Start or resume a plan',       action: 'nav:plan'   },
  { cmd: '/spawn',   desc: 'Spawn a new agent',             action: 'spawn'      },
  { cmd: '/agents',  desc: 'Show active agent status',      action: 'nav:agents' },
  { cmd: '/tasks',   desc: 'View task queue',               action: 'nav:tasks'  },
  { cmd: '/skills',  desc: 'Browse & invoke a skill',       action: 'nav:skills' },
  { cmd: '/skill',   desc: 'Invoke a skill by slug',         action: 'skill'      },
  { cmd: '/cwd',     desc: 'Change Working Directory',       action: 'cwd'        },
  { cmd: '/context', desc: 'Toggle Working Set panel',      action: 'context'    },
  { cmd: '/memory',  desc: 'Search memory store',           action: 'memory'     },
  { cmd: '/clear',   desc: 'Clear this conversation',       action: 'clear'      },
  { cmd: '/help',    desc: 'List all available commands',   action: 'help'       },
];

interface SlashMenuProps {
  query: string;
  highlight: number;
  setHighlight: (i: number) => void;
  onSelect: (cmd: SlashCommand) => void;
  commands?: SlashCommand[];
}

export function SlashMenu({ query, highlight, setHighlight, onSelect, commands = SLASH_CMDS }: SlashMenuProps) {
  const filtered = commands.filter((c) => c.cmd.startsWith(query));
  if (!filtered.length) return null;
  return (
    <div style={{
      position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0,
      background: 'var(--bg1)', border: '1px solid #1f6feb55',
      borderRadius: 8, overflow: 'hidden',
      boxShadow: '0 -12px 32px #00000077', zIndex: 20,
    }}>
      <div style={{
        padding: '6px 14px', borderBottom: '1px solid var(--bd)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 10, color: 'var(--t1)', textTransform: 'uppercase', letterSpacing: '0.7px' }}>Commands</span>
        <span style={{ fontSize: 10, color: 'var(--t1)' }}>↑↓ navigate · ↵ select · esc dismiss</span>
      </div>
      {filtered.map((c, i) => (
        <div
          key={c.cmd}
          onClick={() => onSelect(c)}
          onMouseEnter={() => setHighlight(i)}
          style={{
            padding: '9px 14px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 14,
            background: i === highlight ? 'var(--bg2)' : 'transparent',
            borderBottom: i < filtered.length - 1 ? '1px solid #30363d22' : 'none',
            transition: 'background 0.1s',
          }}
        >
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--blu)', flexShrink: 0, width: 88 }}>{c.cmd}</span>
          <span style={{ fontSize: 12, color: 'var(--t1)', flex: 1 }}>{c.desc}</span>
          {i === highlight && (
            <span style={{
              fontSize: 10, color: 'var(--t1)', background: 'var(--bg0)',
              border: '1px solid var(--bd)', borderRadius: 3, padding: '1px 5px',
            }}>↵</span>
          )}
        </div>
      ))}
    </div>
  );
}
