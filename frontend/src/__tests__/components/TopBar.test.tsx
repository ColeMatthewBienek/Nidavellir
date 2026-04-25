import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
// Fails (red) until TopBar.tsx exists
import { TopBar } from '../../components/shared/TopBar';

describe('TopBar', () => {
  it('renders the title', () => {
    render(<TopBar title="Test Title" />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<TopBar title="Title" sub="Subtitle text" />);
    expect(screen.getByText('Subtitle text')).toBeInTheDocument();
  });

  it('does not render subtitle element when sub is not provided', () => {
    render(<TopBar title="Title" />);
    expect(screen.queryByTestId('topbar-sub')).not.toBeInTheDocument();
  });

  it('renders children in the right slot', () => {
    render(<TopBar title="Title"><button>Action</button></TopBar>);
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
  });

  it('renders with no children without crashing', () => {
    expect(() => render(<TopBar title="Title" />)).not.toThrow();
  });
});
