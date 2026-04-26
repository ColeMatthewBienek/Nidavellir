import { TopBar } from '../components/shared/TopBar';
import { TokenUsageDashboard } from '../components/dashboard/TokenUsageDashboard';
import { useAgentStore } from '../store/agentStore';

export function TokenScreen() {
  const contextUsage  = useAgentStore((s) => s.contextUsage);
  const selectedModel = useAgentStore((s) => s.selectedModel);

  const modelLabel = selectedModel.split(':')[1] ?? selectedModel;

  const data = contextUsage ?? {
    model:         modelLabel,
    currentTokens: 0,
    usableTokens:  192000,
    totalLimit:    200000,
    reserved:      8000,
    accurate:      false,
  };

  const handleExport = (format: 'json' | 'csv') => {
    window.location.href = `/api/tokens/export?format=${format}`;
  };

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar title="Token Usage" />
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <TokenUsageDashboard data={data} onExport={handleExport} />
      </div>
    </div>
  );
}
