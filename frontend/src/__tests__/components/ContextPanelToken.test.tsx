import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextPanel } from '../../components/chat/ContextPanel';

describe('ContextPanel — Token Usage section', () => {
  it('renders without crashing', () => {
    expect(() => render(<ContextPanel onClose={() => {}} />)).not.toThrow();
  });

  it('shows Token Usage section header', () => {
    render(<ContextPanel onClose={() => {}} />);
    expect(screen.getByText(/Token Usage/i)).toBeTruthy();
  });

  it('shows Files section header', () => {
    render(<ContextPanel onClose={() => {}} />);
    // "Files" appears in section header (uppercase) and file path names
    expect(screen.getAllByText(/Files/i).length).toBeGreaterThan(0);
  });

  it('calls onClose when ✕ is clicked', () => {
    const onClose = vi.fn();
    render(<ContextPanel onClose={onClose} />);
    // The header close button
    const closeBtn = screen.getAllByText('✕')[0];
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('toggles Files section when header clicked', () => {
    render(<ContextPanel onClose={() => {}} />);
    // The section header contains "FILES" (uppercased) — get the first exact match
    const fileHeaders = screen.getAllByText(/^files$/i);
    const fileHeader = fileHeaders[0].closest('div')!;
    fireEvent.click(fileHeader);
    // After collapse, "Add files" link should be gone
    expect(screen.queryByText('+ Add files')).toBeNull();
  });

  it('shows + Add files link when files section expanded', () => {
    render(<ContextPanel onClose={() => {}} />);
    expect(screen.getByText('+ Add files')).toBeTruthy();
  });

  it('removes a file when ✕ clicked on file row', () => {
    render(<ContextPanel onClose={() => {}} />);
    // Initial file count
    const removeBtns = screen.getAllByText('✕');
    // First ✕ is the panel close, rest are file removes
    const fileRemove = removeBtns[1];
    fireEvent.click(fileRemove);
    // One fewer file row
    expect(screen.getAllByText('✕').length).toBeLessThan(removeBtns.length);
  });

  it('shows Inspect Dashboard button', () => {
    render(<ContextPanel onClose={() => {}} />);
    expect(screen.getByText(/Inspect Dashboard/i)).toBeTruthy();
  });

  it('Inspect Dashboard button dispatches nid:navigate event', () => {
    render(<ContextPanel onClose={() => {}} />);
    const dispatched: string[] = [];
    window.addEventListener('nid:navigate', (e) => {
      dispatched.push((e as CustomEvent).detail);
    });
    fireEvent.click(screen.getByText(/Inspect Dashboard/i));
    expect(dispatched).toContain('tokens');
  });

  it('opens FileSearchModal when + Add files clicked', () => {
    render(<ContextPanel onClose={() => {}} />);
    fireEvent.click(screen.getByText('+ Add files'));
    // FileSearchModal should appear
    expect(screen.getByText(/Search files/i)).toBeTruthy();
  });
});
