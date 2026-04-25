export function ThinkingBubble() {
  return (
    <div style={{ padding: '10px 20px', display: 'flex', gap: 10 }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%', background: 'var(--grnd)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0,
      }}>N</div>
      <div style={{ paddingTop: 5 }}>
        <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 6 }}>Nidavellir · thinking</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: '50%', background: 'var(--t1)',
              display: 'inline-block',
              animation: `nidBounce 1.2s ${i * 0.2}s ease-in-out infinite`,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}
