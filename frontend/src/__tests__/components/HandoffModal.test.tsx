import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HandoffModal } from '../../components/chat/HandoffModal';

const defaultProps = {
  newProvider: 'Codex',
  onContinue:  vi.fn(),
  onClean:     vi.fn(),
  onReview:    vi.fn(),
  onCancel:    vi.fn(),
};

describe('HandoffModal — structure', () => {
  it('renders without crashing when visible', () => {
    expect(() => render(<HandoffModal visible {...defaultProps} />)).not.toThrow();
  });

  it('does not render when not visible', () => {
    const { container } = render(<HandoffModal visible={false} {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the new provider name', () => {
    render(<HandoffModal visible {...defaultProps} />);
    expect(screen.getByText(/codex/i)).toBeTruthy();
  });

  it('shows Continue button', () => {
    render(<HandoffModal visible {...defaultProps} />);
    expect(screen.getByText(/continue/i)).toBeTruthy();
  });

  it('shows Start Clean button', () => {
    render(<HandoffModal visible {...defaultProps} />);
    expect(screen.getByText(/start clean/i)).toBeTruthy();
  });

  it('shows Review button', () => {
    render(<HandoffModal visible {...defaultProps} />);
    expect(screen.getByText(/review/i)).toBeTruthy();
  });
});

describe('HandoffModal — interactions', () => {
  it('calls onContinue when Continue is clicked', () => {
    const onContinue = vi.fn();
    render(<HandoffModal visible {...defaultProps} onContinue={onContinue} />);
    fireEvent.click(screen.getByText(/continue/i));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('calls onClean when Start Clean is clicked', () => {
    const onClean = vi.fn();
    render(<HandoffModal visible {...defaultProps} onClean={onClean} />);
    fireEvent.click(screen.getByText(/start clean/i));
    expect(onClean).toHaveBeenCalledOnce();
  });

  it('calls onReview when Review is clicked', () => {
    const onReview = vi.fn();
    render(<HandoffModal visible {...defaultProps} onReview={onReview} />);
    fireEvent.click(screen.getByText(/review/i));
    expect(onReview).toHaveBeenCalledOnce();
  });

  it('calls onCancel when × button is clicked', () => {
    const onCancel = vi.fn();
    render(<HandoffModal visible {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when backdrop is clicked', () => {
    const onCancel = vi.fn();
    render(<HandoffModal visible {...defaultProps} onCancel={onCancel} />);
    // The backdrop is the outermost div (first child of container)
    const backdrop = screen.getByText(/codex/i).closest('[style*="fixed"]')!;
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows summary text when provided', () => {
    render(
      <HandoffModal
        visible
        {...defaultProps}
        summary="Previous session covered async Python and JWT auth."
      />
    );
    expect(screen.getByText(/async Python/i)).toBeTruthy();
  });
});
