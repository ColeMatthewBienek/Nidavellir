import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HandoffModal } from '../../components/chat/HandoffModal';

describe('HandoffModal — structure', () => {
  it('renders without crashing when visible', () => {
    expect(() =>
      render(<HandoffModal visible newProvider="Codex" onContinue={vi.fn()} onClean={vi.fn()} onReview={vi.fn()} />)
    ).not.toThrow();
  });

  it('does not render when not visible', () => {
    const { container } = render(
      <HandoffModal visible={false} newProvider="Codex" onContinue={vi.fn()} onClean={vi.fn()} onReview={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the new provider name', () => {
    render(<HandoffModal visible newProvider="Codex" onContinue={vi.fn()} onClean={vi.fn()} onReview={vi.fn()} />);
    expect(screen.getByText(/codex/i)).toBeTruthy();
  });

  it('shows Continue button', () => {
    render(<HandoffModal visible newProvider="Codex" onContinue={vi.fn()} onClean={vi.fn()} onReview={vi.fn()} />);
    expect(screen.getByText(/continue/i)).toBeTruthy();
  });

  it('shows Start Clean button', () => {
    render(<HandoffModal visible newProvider="Codex" onContinue={vi.fn()} onClean={vi.fn()} onReview={vi.fn()} />);
    expect(screen.getByText(/start clean/i)).toBeTruthy();
  });

  it('shows Review button', () => {
    render(<HandoffModal visible newProvider="Codex" onContinue={vi.fn()} onClean={vi.fn()} onReview={vi.fn()} />);
    expect(screen.getByText(/review/i)).toBeTruthy();
  });
});

describe('HandoffModal — interactions', () => {
  it('calls onContinue when Continue is clicked', () => {
    const onContinue = vi.fn();
    render(<HandoffModal visible newProvider="Codex" onContinue={onContinue} onClean={vi.fn()} onReview={vi.fn()} />);
    fireEvent.click(screen.getByText(/continue/i));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('calls onClean when Start Clean is clicked', () => {
    const onClean = vi.fn();
    render(<HandoffModal visible newProvider="Codex" onContinue={vi.fn()} onClean={onClean} onReview={vi.fn()} />);
    fireEvent.click(screen.getByText(/start clean/i));
    expect(onClean).toHaveBeenCalledOnce();
  });

  it('calls onReview when Review is clicked', () => {
    const onReview = vi.fn();
    render(<HandoffModal visible newProvider="Codex" onContinue={vi.fn()} onClean={vi.fn()} onReview={onReview} />);
    fireEvent.click(screen.getByText(/review/i));
    expect(onReview).toHaveBeenCalledOnce();
  });

  it('shows summary text when provided', () => {
    render(
      <HandoffModal
        visible
        newProvider="Codex"
        summary="Previous session covered async Python and JWT auth."
        onContinue={vi.fn()}
        onClean={vi.fn()}
        onReview={vi.fn()}
      />
    );
    expect(screen.getByText(/async Python/i)).toBeTruthy();
  });
});
