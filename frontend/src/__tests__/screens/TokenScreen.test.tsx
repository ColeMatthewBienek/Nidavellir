import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenScreen } from '../../screens/TokenScreen';

describe('TokenScreen', () => {
  it('renders without crashing', () => {
    expect(() => render(<TokenScreen />)).not.toThrow();
  });

  it('shows the Token Usage Dashboard heading', () => {
    render(<TokenScreen />);
    expect(screen.getByText('Token Usage Dashboard')).toBeTruthy();
  });

  it('shows Export JSON button', () => {
    render(<TokenScreen />);
    expect(screen.getByText('Export JSON')).toBeTruthy();
  });
});
