interface Msg {
  id: number | string;
  role: 'user' | 'agent';
  content: string;
  time?: string;
  streaming?: boolean;
}

interface MsgBubbleProps {
  msg: Msg;
}

export function MsgBubble({ msg }: MsgBubbleProps) {
  const isUser = msg.role === 'user';
  const parts = msg.content.split(/(```[\s\S]*?```)/g);

  return (
    <div style={{
      padding: '10px 20px', display: 'flex', gap: 10,
      flexDirection: isUser ? 'row-reverse' : 'row', alignItems: 'flex-start',
    }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
        background: isUser ? 'var(--blu)' : 'var(--grnd)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, color: '#fff',
      }}>
        {isUser ? 'U' : 'N'}
      </div>
      <div style={{ maxWidth: '68%', fontSize: 13, color: 'var(--t0)', lineHeight: 1.65 }}>
        <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 4, textAlign: isUser ? 'right' : 'left' }}>
          {isUser ? 'You' : 'Nidavellir'}
          {msg.time ? ` · ${msg.time}` : ''}
          {msg.streaming && (
            <span style={{ marginLeft: 6, color: 'var(--grn)', fontSize: 9, animation: 'nidBlink 1.2s step-start infinite' }}>
              ● LIVE
            </span>
          )}
        </div>
        {parts.map((p, i) =>
          p.startsWith('```') ? (
            <pre key={i} style={{
              background: 'var(--bg0)', border: '1px solid var(--bd)', borderRadius: 6,
              padding: '10px 14px', margin: '6px 0',
              fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6,
              overflowX: 'auto', color: 'var(--t0)', whiteSpace: 'pre-wrap',
            }}>
              {p.replace(/^```\w*\n?/, '').replace(/```$/, '')}
            </pre>
          ) : (
            <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{p}</span>
          )
        )}
        {msg.streaming && (
          <span style={{ color: 'var(--grn)', animation: 'nidBlink 1s step-start infinite' }}>▋</span>
        )}
      </div>
    </div>
  );
}
