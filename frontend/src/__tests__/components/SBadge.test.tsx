import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
// Fails (red) until SBadge.tsx exists
import { SBadge } from '../../components/shared/SBadge';

const ALL_STATUSES = [
  'idle', 'busy', 'active', 'error', 'pending',
  'running', 'complete', 'failed', 'scheduled', 'changes_requested'
] as const;

describe('SBadge', () => {
  it('renders without crashing for every s', () => {
    for (const s of ALL_STATUSES) {
      expect(() => render(<SBadge s={s} />)).not.toThrow();
    }
  });

  it('renders the label text for idle', () => {
    render(<SBadge s="idle" />);
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('renders the label text for active', () => {
    render(<SBadge s="active" />);
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('renders the label text for running', () => {
    render(<SBadge s="running" />);
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('renders the label text for complete', () => {
    render(<SBadge s="complete" />);
    expect(screen.getByText('complete')).toBeInTheDocument();
  });

  it('renders a s dot element', () => {
    render(<SBadge s="active" />);
    expect(screen.getByTestId('sbadge-dot')).toBeInTheDocument();
  });
});
