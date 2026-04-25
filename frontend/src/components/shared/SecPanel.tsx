import type { ReactNode } from 'react';

interface SecPanelProps {
  title: string;
  action?: string;
  onAction?: () => void;
  width?: number;
  children: ReactNode;
}

export function SecPanel({ title, action, onAction, width = 210, children }: SecPanelProps) {
  return (
    <div style={{
      width, flexShrink: 0,
      borderRight: '1px solid var(--bd)',
      background: 'var(--bg1)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--bd)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: 'var(--t1)',
          textTransform: 'uppercase', letterSpacing: '0.7px',
        }}>{title}</span>
        {action && (
          <span onClick={onAction} style={{ fontSize: 16, color: 'var(--t1)', cursor: 'pointer', lineHeight: 1 }}>
            {action}
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>{children}</div>
    </div>
  );
}
