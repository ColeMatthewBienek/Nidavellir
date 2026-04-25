import { useState, useEffect } from 'react';
import { useAppStore } from '../../store';
import { NAV_GROUPS, SETTINGS_ITEM } from './nav-config';
import { NavItem } from './NavItem';
import type { ScreenId } from '../../types';

function AgentPip() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const iv = setInterval(() => setOn((v) => !v), 1800);
    return () => clearInterval(iv);
  }, []);
  return (
    <span title="2 agents active" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, color: 'var(--grn)',
      padding: '2px 6px', borderRadius: 10,
      border: '1px solid #3fb95044',
      background: '#3fb95016',
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: '50%', background: 'var(--grn)',
        display: 'inline-block',
        boxShadow: on ? '0 0 6px #3fb950' : 'none',
        transition: 'box-shadow 0.8s ease',
      }} />
      2 active
    </span>
  );
}

export function NavSidebar() {
  const activeScreen = useAppStore((s) => s.activeScreen);
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);
  const backendStatus = useAppStore((s) => s.backendStatus);

  const statusColor =
    backendStatus === 'ok' ? 'var(--grn)' :
    backendStatus === 'error' ? 'var(--red)' :
    'var(--t1)';

  return (
    <nav style={{
      width: 200, flexShrink: 0,
      background: 'var(--bg1)',
      borderRight: '1px solid var(--bd)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Logo */}
      <div style={{
        padding: '0 14px', height: 48, flexShrink: 0,
        borderBottom: '1px solid var(--bd)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--grn)">
            <path d="M8 0L14.928 4v8L8 16 1.072 12V4z"/>
          </svg>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t0)', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            Nidavellir
          </span>
        </div>
        <AgentPip />
      </div>

      {/* Nav groups */}
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 8, paddingBottom: 8 }}>
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} style={{ marginBottom: gi < NAV_GROUPS.length - 1 ? 8 : 0 }}>
            <div style={{
              padding: '6px 14px 3px',
              fontSize: 10, fontWeight: 600, color: '#484f58',
              textTransform: 'uppercase', letterSpacing: '0.8px',
            }}>
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavItem
                key={item.id}
                id={item.id}
                label={item.label}
                icon={item.icon}
                active={activeScreen === item.id}
                onClick={(id: ScreenId) => setActiveScreen(id)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Settings + status */}
      <div style={{ borderTop: '1px solid var(--bd)', padding: '8px 0' }}>
        <NavItem
          id={SETTINGS_ITEM.id}
          label={SETTINGS_ITEM.label}
          icon={SETTINGS_ITEM.icon}
          active={activeScreen === SETTINGS_ITEM.id}
          onClick={(id: ScreenId) => setActiveScreen(id)}
        />
        <div style={{ padding: '4px 14px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            data-testid="backend-status-dot"
            style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }}
          />
          <span style={{ fontSize: 10, color: 'var(--t1)' }}>backend {backendStatus}</span>
        </div>
      </div>
    </nav>
  );
}
