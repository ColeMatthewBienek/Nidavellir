import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TokenUsageDashboard } from '../../components/dashboard/TokenUsageDashboard';

const defaultData = {
  model: 'Claude Sonnet',
  currentTokens: 12847,
  usableTokens: 192000,
  totalLimit: 200000,
  reserved: 8000,
  accurate: true,
};

describe('TokenUsageDashboard', () => {
  it('renders without crashing', () => {
    expect(() => render(<TokenUsageDashboard />)).not.toThrow();
  });

  it('shows the dashboard heading', () => {
    render(<TokenUsageDashboard />);
    expect(screen.getByText('Token Usage Dashboard')).toBeTruthy();
  });

  it('shows the active model name', () => {
    render(<TokenUsageDashboard data={defaultData} />);
    expect(screen.getByText('Claude Sonnet')).toBeTruthy();
  });

  it('calculates and displays percentage correctly', () => {
    render(<TokenUsageDashboard data={defaultData} />);
    const pct = Math.round((12847 / 192000) * 100);
    expect(screen.getByText(`${pct}%`)).toBeTruthy();
  });

  it('shows OK health state when below 50%', () => {
    render(<TokenUsageDashboard data={{ ...defaultData, currentTokens: 50000, usableTokens: 192000 }} />);
    expect(screen.getByText('OK')).toBeTruthy();
  });

  it('shows At Risk when 50–64%', () => {
    render(<TokenUsageDashboard data={{ ...defaultData, currentTokens: 110000, usableTokens: 192000 }} />);
    expect(screen.getByText('At Risk')).toBeTruthy();
  });

  it('shows Prepare Compaction when 65–74%', () => {
    render(<TokenUsageDashboard data={{ ...defaultData, currentTokens: 130000, usableTokens: 192000 }} />);
    expect(screen.getByText('Prepare Compaction')).toBeTruthy();
  });

  it('shows Compaction Required when 75–84%', () => {
    render(<TokenUsageDashboard data={{ ...defaultData, currentTokens: 148000, usableTokens: 192000 }} />);
    expect(screen.getByText('Compaction Required')).toBeTruthy();
  });

  it('shows Blocked when >= 85%', () => {
    render(<TokenUsageDashboard data={{ ...defaultData, currentTokens: 165000, usableTokens: 192000 }} />);
    expect(screen.getByText('Blocked')).toBeTruthy();
  });

  it('shows accuracy as Counts Accurate when accurate=true', () => {
    render(<TokenUsageDashboard data={{ ...defaultData, accurate: true }} />);
    expect(screen.getByText('Counts Accurate')).toBeTruthy();
  });

  it('shows Counts Estimated when accurate=false', () => {
    render(<TokenUsageDashboard data={{ ...defaultData, accurate: false }} />);
    expect(screen.getByText('Counts Estimated')).toBeTruthy();
  });

  it('calls onExport with json when Export JSON clicked', () => {
    const onExport = vi.fn();
    render(<TokenUsageDashboard data={defaultData} onExport={onExport} />);
    fireEvent.click(screen.getByText('Export JSON'));
    expect(onExport).toHaveBeenCalledWith('json');
  });

  it('calls onExport with csv when Export CSV clicked', () => {
    const onExport = vi.fn();
    render(<TokenUsageDashboard data={defaultData} onExport={onExport} />);
    fireEvent.click(screen.getByText('Export CSV'));
    expect(onExport).toHaveBeenCalledWith('csv');
  });

  it('switches to history tab', () => {
    render(<TokenUsageDashboard data={defaultData} />);
    fireEvent.click(screen.getByText('history'));
    expect(screen.getByText(/Historical token usage data coming soon/)).toBeTruthy();
  });

  it('shows limits breakdown on overview tab', () => {
    render(<TokenUsageDashboard data={defaultData} />);
    expect(screen.getByText('Total Limit')).toBeTruthy();
    expect(screen.getByText('Reserved')).toBeTruthy();
    expect(screen.getByText('Usable')).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
  });
});
