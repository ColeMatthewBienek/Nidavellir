import { useEffect } from 'react';
import { TopBar } from '../components/shared/TopBar';
import { TokenUsageDashboard } from '../components/dashboard/TokenUsageDashboard';
import { useAgentStore } from '../store/agentStore';

const API = 'http://localhost:7430';

export function TokenScreen() {
  const contextUsage   = useAgentStore((s) => s.contextUsage);
  const selectedModel  = useAgentStore((s) => s.selectedModel);
  const conversationId = useAgentStore((s) => s.conversationId);

  const modelLabel = selectedModel.split(':')[1] ?? selectedModel;
  const provider   = selectedModel.split(':')[0] ?? 'claude';

  const data = contextUsage ?? {
    model:         modelLabel,
    currentTokens: 0,
    usableTokens:  192000,
    totalLimit:    200000,
    reserved:      8000,
    accurate:      false,
  };

  const handleExport = (_format: 'json' | 'csv') => {
    window.location.href = `${API}/api/tokens/export?range=24h`;
  };

  // Refresh context usage when screen opens
  useEffect(() => {
    const params = new URLSearchParams({
      conversation_id: conversationId ?? '',
      model:      modelLabel,
      provider,
    });
    fetch(`${API}/api/context/usage?${params}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) {
          useAgentStore.getState().setContextUsage({
            model:         d.model,
            currentTokens: d.currentTokens,
            usableTokens:  d.usableTokens,
            totalLimit:    d.contextLimit,
            reserved:      d.reservedOutputTokens,
            accurate:      d.accuracy === 'accurate',
          });
        }
      })
      .catch(() => {});
  }, [conversationId, modelLabel, provider]);

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar title="Token Usage" />
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <TokenUsageDashboard data={data} onExport={handleExport} />
      </div>
    </div>
  );
}
