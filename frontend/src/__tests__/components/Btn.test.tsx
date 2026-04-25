import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
// Fails (red) until Btn.tsx exists
import { Btn } from '../../components/shared/Btn';

describe('Btn', () => {
  it('renders children', () => {
    render(<Btn>Click me</Btn>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const handler = vi.fn();
    render(<Btn onClick={handler}>Click</Btn>);
    fireEvent.click(screen.getByText('Click'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not call onClick when disabled', () => {
    const handler = vi.fn();
    render(<Btn onClick={handler} disabled>Click</Btn>);
    fireEvent.click(screen.getByText('Click'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('renders as a button element', () => {
    render(<Btn>Label</Btn>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Btn disabled>Label</Btn>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders without crashing with primary prop', () => {
    expect(() => render(<Btn primary>Primary</Btn>)).not.toThrow();
  });

  it('renders without crashing with small prop', () => {
    expect(() => render(<Btn small>Small</Btn>)).not.toThrow();
  });
});
