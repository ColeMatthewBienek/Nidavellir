interface ProviderIconProps {
  provider: string;
  size?: number;
}

export function ProviderIcon({ provider, size = 36 }: ProviderIconProps) {
  const r = 7;
  if (provider === 'Anthropic') {
    return (
      <svg width={size} height={size} viewBox="0 0 36 36">
        <rect width="36" height="36" rx={r} fill="#c96a42"/>
        <polygon points="10,26 14,14 18,22 22,14 26,26 23,26 18,18 13,26" fill="white" opacity="0.95"/>
      </svg>
    );
  }
  if (provider === 'OpenAI') {
    return (
      <svg width={size} height={size} viewBox="0 0 36 36">
        <rect width="36" height="36" rx={r} fill="#10a37f"/>
        {[0, 60, 120, 180, 240, 300].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const cx = 18 + 5 * Math.cos(rad);
          const cy = 18 + 5 * Math.sin(rad);
          return <circle key={deg} cx={cx} cy={cy} r="4.2" fill="none" stroke="white" strokeWidth="1.8"/>;
        })}
        <circle cx="18" cy="18" r="2.2" fill="white"/>
      </svg>
    );
  }
  if (provider === 'Google') {
    return (
      <svg width={size} height={size} viewBox="0 0 36 36">
        <rect width="36" height="36" rx={r} fill="#ffffff" stroke="var(--bd)"/>
        <path d="M25 18.5h-7v3h4.1c-.4 2-2.2 3.5-4.1 3.5-2.5 0-4.5-2-4.5-4.5s2-4.5 4.5-4.5c1.1 0 2.1.4 2.9 1l2.2-2.2C21.6 13.5 19.9 13 18 13c-4.1 0-7.5 3.4-7.5 7.5s3.4 7.5 7.5 7.5c4.4 0 7.3-3.1 7.3-7.4 0-.5-.1-1-.3-1.6z" fill="#4285f4"/>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 36 36">
      <rect width="36" height="36" rx={r} fill="var(--bg2)" stroke="var(--bd)"/>
      <text x="18" y="23" textAnchor="middle" fontSize="13" fill="var(--t1)" fontFamily="monospace">◎</text>
    </svg>
  );
}
