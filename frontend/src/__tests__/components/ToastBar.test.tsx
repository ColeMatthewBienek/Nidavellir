import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastBar } from '../../components/chat/ToastBar';

describe('ToastBar — structure', () => {
  it('renders without crashing', () => {
    expect(() => render(<ToastBar message="Model changed to Codex" />)).not.toThrow();
  });

  it('shows the message text', () => {
    render(<ToastBar message="Model changed to Codex" />);
    expect(screen.getByText(/model changed to codex/i)).toBeTruthy();
  });

  it('does not render when message is empty', () => {
    const { container } = render(<ToastBar message="" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ToastBar — interactions', () => {
  it('calls onDismiss when close button clicked', () => {
    const onDismiss = vi.fn();
    render(<ToastBar message="Model changed to Codex" onDismiss={onDismiss} />);
    const closeBtn = screen.getByRole('button');
    fireEvent.click(closeBtn);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('auto-dismisses after duration', async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ToastBar message="Model changed to Codex" onDismiss={onDismiss} duration={2000} />);
    act(() => { vi.advanceTimersByTime(2100); });
    expect(onDismiss).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
