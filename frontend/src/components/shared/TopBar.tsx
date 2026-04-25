import type { ReactNode } from 'react';

interface TopBarProps {
  title: string;
  sub?: string;
  children?: ReactNode;
}

export function TopBar({ title, sub, children }: TopBarProps) {
  return (
    <div style={{
      height: 48, padding: '0 20px', flexShrink: 0,
      borderBottom: '1px solid var(--bd)', background: 'var(--bg1)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t0)' }}>{title}</span>
        {sub && (
          <span data-testid="topbar-sub" style={{ fontSize: 12, color: 'var(--t1)', marginLeft: 10 }}>
            {sub}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
