interface HandoffModalProps {
  visible:     boolean;
  newProvider: string;
  summary?:    string;
  onContinue:  () => void;
  onClean:     () => void;
  onReview:    () => void;
  onCancel:    () => void;
}

export function HandoffModal({
  visible,
  newProvider,
  summary,
  onContinue,
  onClean,
  onReview,
  onCancel,
}: HandoffModalProps) {
  if (!visible) return null;

  return (
    // Backdrop — clicking outside the card cancels
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: '#00000077',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
      }}
    >
      {/* Modal card — stop click propagation so backdrop click doesn't fire inside card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg1)',
          border: '1px solid var(--bd)',
          borderRadius: 10,
          padding: 28,
          maxWidth: 440,
          width: '90%',
          boxShadow: '0 24px 64px #00000088',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t0)' }}>
            Switch to {newProvider}
          </div>
          <button
            onClick={onCancel}
            aria-label="Cancel"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--t1)',
              fontSize: 18,
              lineHeight: 1,
              padding: '0 2px',
            }}
          >
            ×
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--t1)', marginBottom: 18, lineHeight: 1.6 }}>
          You have context in the current session. Choose how to proceed:
        </div>

        {summary && (
          <div style={{
            background: 'var(--bg0)',
            border: '1px solid var(--bd)',
            borderRadius: 6,
            padding: '10px 14px',
            fontSize: 11,
            color: 'var(--t1)',
            lineHeight: 1.6,
            marginBottom: 18,
            maxHeight: 120,
            overflowY: 'auto',
            fontFamily: 'monospace',
          }}>
            {summary}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={onContinue}
            style={{
              padding: '9px 14px',
              background: 'var(--grn)',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              color: '#000',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            Continue — carry context forward
          </button>
          <button
            onClick={onReview}
            style={{
              padding: '9px 14px',
              background: 'var(--bg2)',
              border: '1px solid var(--bd)',
              borderRadius: 6,
              fontSize: 13,
              color: 'var(--t0)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            Review context before deciding
          </button>
          <button
            onClick={onClean}
            style={{
              padding: '9px 14px',
              background: 'transparent',
              border: '1px solid var(--bd)',
              borderRadius: 6,
              fontSize: 13,
              color: 'var(--t1)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            Start clean — no context carried
          </button>
        </div>
      </div>
    </div>
  );
}
