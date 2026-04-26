import { useEffect, useState } from 'react';
import { TopBar } from '../components/shared/TopBar';
import { TokenUsageDashboard, DashboardData } from '../components/dashboard/TokenUsageDashboard';

const API = 'http://localhost:7430';

export function TokenScreen() {
  const [dashData, setDashData] = useState<DashboardData | undefined>(undefined);

  useEffect(() => {
    fetch(`${API}/api/tokens/dashboard`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setDashData(d); })
      .catch(() => {});
  }, []);

  const handleExport = (_format: 'jsonl', range: string) => {
    window.location.href = `${API}/api/tokens/export?range=${range}`;
  };

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar title="Token Usage" />
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <TokenUsageDashboard data={dashData} onExport={handleExport} />
      </div>
    </div>
  );
}
