import { useEffect } from 'react';

interface ToastBarProps {
  message:    string;
  duration?:  number;   // ms before auto-dismiss (default 4000)
  onDismiss?: () => void;
}

export function ToastBar({ message, duration = 4000, onDismiss }: ToastBarProps) {
  useEffect(() => {
    if (!message || !onDismiss) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [message, duration, onDismiss]);

  if (!message) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'var(--bg2)',
      border: '1px solid var(--bd)',
      borderRadius: 8,
      padding: '10px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      fontSize: 12,
      color: 'var(--t0)',
      boxShadow: '0 8px 24px #00000066',
      zIndex: 300,
      whiteSpace: 'nowrap',
    }}>
      <span>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--t1)',
            fontSize: 14,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
