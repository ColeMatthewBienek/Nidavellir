import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
// Fails (red) until NavSidebar.tsx exists
import { NavSidebar } from '../../components/nav/NavSidebar';

describe('NavSidebar', () => {
  it('renders all nav group labels', () => {
    render(<NavSidebar />);
    expect(screen.getByText('Interaction')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Resources')).toBeInTheDocument();
  });

  it('renders all nav item labels', () => {
    render(<NavSidebar />);
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders Chat as active by default (from store)', () => {
    render(<NavSidebar />);
    const chatItem = screen.getByTestId('nav-item-chat');
    expect(chatItem).toHaveAttribute('data-active', 'true');
  });

  it('clicking a nav item updates the store active screen', () => {
    render(<NavSidebar />);
    fireEvent.click(screen.getByTestId('nav-item-agents'));
    expect(screen.getByTestId('nav-item-agents')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('nav-item-chat')).toHaveAttribute('data-active', 'false');
  });

  it('renders backend status indicator', () => {
    render(<NavSidebar />);
    expect(screen.getByTestId('backend-status-dot')).toBeInTheDocument();
  });
});
