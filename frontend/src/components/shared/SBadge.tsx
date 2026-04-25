import type { BadgeStatus } from '../../types';

const STATUS: Record<BadgeStatus, [string, string]> = {
  idle:              ['var(--t1)',  'idle'],
  busy:              ['var(--yel)', 'busy'],
  active:            ['var(--grn)', 'active'],
  error:             ['var(--red)', 'error'],
  pending:           ['var(--t1)',  'pending'],
  running:           ['var(--blu)', 'running'],
  complete:          ['var(--grn)', 'complete'],
  failed:            ['var(--red)', 'failed'],
  scheduled:         ['var(--prp)', 'scheduled'],
  changes_requested: ['var(--yel)', 'changes'],
};

const PULSE_HEX: Partial<Record<BadgeStatus, string>> = {
  active:  '#3fb950',
  running: '#1f6feb',
};

interface SBadgeProps {
  s: BadgeStatus;
}

export function SBadge({ s }: SBadgeProps) {
  const [col, lbl] = STATUS[s] ?? STATUS.idle;
  const pulse = s === 'active' || s === 'running';
  const glowCol = PULSE_HEX[s] ?? col;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 20,
      border: `1px solid ${glowCol}44`,
      background: `${glowCol}16`,
      fontSize: 11, fontWeight: 500, color: col,
    }}>
      <span
        data-testid="sbadge-dot"
        style={{
          width: 5, height: 5, borderRadius: '50%', background: col,
          display: 'inline-block',
          boxShadow: pulse ? `0 0 6px ${glowCol}` : 'none',
          animation: pulse ? 'nidPulse 2s ease-in-out infinite' : 'none',
        }}
      />
      {lbl}
    </span>
  );
}
