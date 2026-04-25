import type { ReactNode, MouseEventHandler } from 'react';

interface BtnProps {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  primary?: boolean;
  small?: boolean;
}

export function Btn({ children, onClick, disabled, primary, small }: BtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: small ? '4px 10px' : '6px 14px',
        background: primary ? 'var(--grnd)' : 'var(--bg2)',
        border: `1px solid ${primary ? 'var(--grnd)' : 'var(--bd)'}`,
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12,
        fontWeight: 500,
        color: disabled ? 'var(--t1)' : '#fff',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}
