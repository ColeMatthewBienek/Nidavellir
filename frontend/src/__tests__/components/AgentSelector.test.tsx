import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AgentSelector } from '../../components/chat/AgentSelector';
import { useAgentStore } from '../../store/agentStore';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  useAgentStore.setState({
    messages: [],
    conversationId: null,
    selectedProvider: 'codex',
    selectedModel: 'codex:gpt-5.4',
    connectionStatus: 'connected',
    handoffPending: false,
    handoffProvider: '',
    handoffSummary: null,
    toastMessage: '',
    agentModelsLoaded: true,
    agentModels: [
      {
        id: 'codex:gpt-5.5',
        provider_id: 'codex',
        model_id: 'gpt-5.5',
        display_name: 'GPT-5.5',
        description: 'Frontier model for complex coding, research, and real-world work.',
        cost_tier: 'subscription',
        available: true,
      },
      {
        id: 'codex:gpt-5.4',
        provider_id: 'codex',
        model_id: 'gpt-5.4',
        display_name: 'GPT-5.4',
        description: 'Most capable GPT-5.4 model for complex coding tasks.',
        cost_tier: 'subscription',
        available: true,
      },
    ],
  });
});

describe('AgentSelector', () => {
  it('shows GPT-5.5 in the Codex model dropdown', () => {
    render(<AgentSelector compact />);

    fireEvent.click(screen.getByTestId('provider-btn'));

    expect(screen.getByTestId('provider-option-codex:gpt-5.5')).toBeTruthy();
    expect(screen.getByText('GPT-5.5')).toBeTruthy();
  });
});
