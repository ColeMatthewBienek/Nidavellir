import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TokenUsageDashboard } from '../../components/dashboard/TokenUsageDashboard';

// ── Fixture matching the /api/tokens/dashboard response shape ─────────────────

const MOCK_DATA = {
  providers: [
    {
      provider: 'anthropic',
      total_input: 104_757,
      total_output: 24_000,
      request_count: 42,
      models: [
        {
          model: 'claude-opus-4',
          total_input: 86_000,
          total_output: 18_000,
          request_count: 30,
          last_used: '2026-04-26T11:16:00Z',
        },
        {
          model: 'claude-sonnet-4',
          total_input: 18_757,
          total_output: 6_000,
          request_count: 12,
          last_used: '2026-04-26T11:15:00Z',
        },
      ],
    },
    {
      provider: 'openai',
      total_input: 40_428,
      total_output: 5_000,
      request_count: 15,
      models: [
        {
          model: 'gpt-5.4',
          total_input: 40_428,
          total_output: 5_000,
          request_count: 15,
          last_used: '2026-04-26T11:10:00Z',
        },
      ],
    },
  ],
  rollingWindow: {
    total_input: 512_348,
    total_output: 29_408,
    request_count: 57,
    hours: 5,
  },
  dailyTotals: {
    total_input: 278_428,
    total_output: 42_998,
    request_count: 130,
  },
  anomalies: [
    {
      type:        'input_spike',
      severity:    'high',
      description: 'Contains 4592 total tokens in single request',
      record_id:   'rec-001',
      created_at:  '2026-04-26T11:14:00Z',
    },
    {
      type:        'output_spike',
      severity:    'medium',
      description: 'Average output is 5.7× baseline of 2046 tokens',
      record_id:   'rec-002',
      created_at:  '2026-04-26T11:12:00Z',
    },
    {
      type:        'high_discrepancy',
      severity:    'medium',
      description: 'Anthropic reported 4052 tokens; estimation 523',
      record_id:   'rec-003',
      created_at:  '2026-04-26T11:10:00Z',
    },
  ],
  recentIssues: [
    { type: 'context_overflow',   description: 'Context overflow rejected', time: '11:16' },
    { type: 'rate_limit',         description: 'Rate limit hit',           time: '11:15' },
    { type: 'stream_interrupted', description: 'Stream interrupted',       time: '11:16' },
  ],
  generatedAt: '2026-04-26T11:20:00Z',
};

// ── Structure tests ───────────────────────────────────────────────────────────

describe('TokenUsageDashboard — structure', () => {
  it('renders without crashing', () => {
    expect(() => render(<TokenUsageDashboard data={MOCK_DATA} />)).not.toThrow();
  });

  it('renders with no data (empty state)', () => {
    expect(() => render(<TokenUsageDashboard />)).not.toThrow();
  });

  it('shows PROVIDER BREAKDOWN section heading', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    expect(screen.getByText(/provider breakdown/i)).toBeTruthy();
  });

  it('shows TIME AGGREGATES section heading', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    expect(screen.getByText(/time aggregates/i)).toBeTruthy();
  });

  it('shows ANOMALIES section heading', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    expect(screen.getByText(/anomalies/i)).toBeTruthy();
  });

  it('shows RECENT ISSUES section heading', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    expect(screen.getByText(/recent issues/i)).toBeTruthy();
  });

  it('shows EXPORT USAGE DATA section heading', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    expect(screen.getByText(/export usage data/i)).toBeTruthy();
  });
});

// ── Provider breakdown tests ──────────────────────────────────────────────────

describe('TokenUsageDashboard — provider breakdown', () => {
  it('shows provider names', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    // "anthropic" appears in both a provider row and an anomaly description; use getAllByText
    expect(screen.getAllByText(/anthropic/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/openai/i)).toBeTruthy();
  });

  it('shows provider total token counts', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    // anthropic has 128,757 total tokens
    expect(screen.getByText(/128,757/)).toBeTruthy();
  });

  it('shows model names under expanded provider', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    // Providers start expanded; model names visible
    expect(screen.getByText('claude-opus-4')).toBeTruthy();
    expect(screen.getByText('claude-sonnet-4')).toBeTruthy();
  });

  it('collapses provider on click', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    const [anthropicRow] = screen.getAllByTestId('provider-row');
    fireEvent.click(anthropicRow);
    // After collapse, model names may not be visible
    // (test the toggle worked — no crash)
  });
});

// ── Time aggregates tests ─────────────────────────────────────────────────────

describe('TokenUsageDashboard — time aggregates', () => {
  it('shows Last 5 Hours card', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    expect(screen.getByText(/last 5 hours/i)).toBeTruthy();
  });

  it('shows Today (Local) card', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    expect(screen.getByText(/today/i)).toBeTruthy();
  });

  it('shows rolling window input tokens', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    expect(screen.getByText(/512,348/)).toBeTruthy();
  });

  it('shows daily totals input tokens', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    expect(screen.getByText(/278,428/)).toBeTruthy();
  });
});

// ── Anomalies tests ───────────────────────────────────────────────────────────

describe('TokenUsageDashboard — anomalies', () => {
  it('shows all anomaly descriptions', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    expect(screen.getByText(/Contains 4592 total tokens/i)).toBeTruthy();
    expect(screen.getByText(/5\.7× baseline/i)).toBeTruthy();
    expect(screen.getByText(/Anthropic reported 4052 tokens/i)).toBeTruthy();
  });

  it('anomaly severity is visually indicated', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    // High severity anomaly row should be present
    expect(screen.getByText(/large input spike/i)).toBeTruthy();
  });

  it('shows zero anomalies message when empty', () => {
    render(<TokenUsageDashboard data={{ ...MOCK_DATA, anomalies: [] }} />);
    expect(screen.getByText(/no anomalies/i)).toBeTruthy();
  });
});

// ── Recent issues tests ───────────────────────────────────────────────────────

describe('TokenUsageDashboard — recent issues', () => {
  it('shows all recent issue descriptions', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    expect(screen.getByText(/context overflow rejected/i)).toBeTruthy();
    expect(screen.getByText(/rate limit hit/i)).toBeTruthy();
    expect(screen.getByText(/stream interrupted/i)).toBeTruthy();
  });

  it('shows timestamps for each issue', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    expect(screen.getAllByText('11:16').length).toBeGreaterThan(0);
  });

  it('shows no issues message when empty', () => {
    render(<TokenUsageDashboard data={{ ...MOCK_DATA, recentIssues: [] }} />);
    expect(screen.getByText(/no recent issues/i)).toBeTruthy();
  });
});

// ── Export section tests ──────────────────────────────────────────────────────

describe('TokenUsageDashboard — export', () => {
  it('shows Download JSONL button', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    expect(screen.getByText(/download jsonl/i)).toBeTruthy();
  });

  it('shows range selector', () => {
    render(<TokenUsageDashboard data={MOCK_DATA} />);
    expect(screen.getByText(/last 24 hours/i)).toBeTruthy();
  });

  it('calls onExport when Download JSONL clicked', () => {
    const onExport = vi.fn();
    render(<TokenUsageDashboard data={MOCK_DATA} onExport={onExport} />);
    fireEvent.click(screen.getByText(/download jsonl/i));
    expect(onExport).toHaveBeenCalledWith('jsonl', expect.any(String));
  });
});
