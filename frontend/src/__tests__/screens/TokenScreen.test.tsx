import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenScreen } from '../../screens/TokenScreen';

describe('TokenScreen', () => {
  it('renders without crashing', () => {
    expect(() => render(<TokenScreen />)).not.toThrow();
  });

  it('shows Provider Breakdown section', () => {
    render(<TokenScreen />);
    expect(screen.getByText(/provider breakdown/i)).toBeTruthy();
  });

  it('shows Download JSONL button', () => {
    render(<TokenScreen />);
    expect(screen.getByText(/download jsonl/i)).toBeTruthy();
  });
});
