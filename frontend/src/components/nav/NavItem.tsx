import type { ReactNode } from 'react';
import type { ScreenId } from '../../types';

interface NavItemProps {
  id: ScreenId;
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: (id: ScreenId) => void;
}

export function NavItem({ id, label, icon, active, onClick }: NavItemProps) {
  return (
    <div
      data-testid={`nav-item-${id}`}
      data-active={String(active)}
      className="nid-nav-item"
      onClick={() => onClick(id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '8px 14px', fontSize: 13, cursor: 'pointer',
        color: active ? 'var(--grn)' : 'var(--t1)',
        background: active ? 'var(--bg2)' : 'transparent',
        borderLeft: active ? '2px solid var(--grn)' : '2px solid transparent',
        transition: 'all 0.15s', userSelect: 'none',
      }}
    >
      <span style={{ opacity: active ? 1 : 0.7, flexShrink: 0 }}>{icon}</span>
      {label}
    </div>
  );
}
