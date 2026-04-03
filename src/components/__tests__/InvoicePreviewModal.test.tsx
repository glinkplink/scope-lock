// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InvoicePreviewModal } from '../InvoicePreviewModal';

const nonZeroRect = {
  width: 120,
  height: 40,
  top: 0,
  left: 0,
  right: 120,
  bottom: 40,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

describe('InvoicePreviewModal', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      nonZeroRect as DOMRect
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('does not render when closed', () => {
    render(<InvoicePreviewModal open={false} onClose={vi.fn()} htmlMarkup="<div>Preview</div>" />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('focuses the close button when opened and restores focus on close', () => {
    function Harness() {
      return (
        <div>
          <button type="button">Before modal</button>
          <InvoicePreviewModal open onClose={vi.fn()} htmlMarkup="<div>Preview</div>" />
        </div>
      );
    }

    render(<Harness />);

    expect(screen.getByRole('button', { name: /close preview/i })).toHaveFocus();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<InvoicePreviewModal open onClose={onClose} htmlMarkup="<div>Preview</div>" />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps focus inside the dialog', () => {
    render(
      <InvoicePreviewModal
        open
        onClose={vi.fn()}
        htmlMarkup={'<button type="button">Inner action</button>'}
      />
    );

    const dialog = screen.getByRole('dialog');
    const closeButton = screen.getByRole('button', { name: /close preview/i });
    const innerButton = screen.getByRole('button', { name: /inner action/i });

    innerButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    closeButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(innerButton).toHaveFocus();
  });
});
