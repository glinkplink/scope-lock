import { useEffect, useRef, type KeyboardEvent } from 'react';
import './InvoicePreviewModal.css';

interface InvoicePreviewModalProps {
  open: boolean;
  onClose: () => void;
  /** Full inner markup from `generateInvoiceHtml` (includes `.agreement-document` root). */
  htmlMarkup: string;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function tabbableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    const ti = el.getAttribute('tabindex');
    if (ti === '-1') return false;
    if (el.hidden) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

export function InvoicePreviewModal({ open, onClose, htmlMarkup }: InvoicePreviewModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  function handleDialogKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key !== 'Tab' || !dialogRef.current) return;

    const list = tabbableElements(dialogRef.current);
    if (list.length === 0) return;

    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (!active || !dialogRef.current.contains(active)) {
      e.preventDefault();
      first.focus();
      return;
    }

    if (e.shiftKey) {
      if (active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={dialogRef}
      className="invoice-preview-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Invoice preview"
      onKeyDown={handleDialogKeyDown}
    >
      <div className="invoice-preview-modal-toolbar">
        <div className="invoice-preview-modal-heading">
          <p className="invoice-preview-modal-kicker">Invoice preview</p>
          <p className="invoice-preview-modal-subtitle">Light document preview inside the Forge shell.</p>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className="invoice-preview-modal-close"
          onClick={onClose}
        >
          Close preview
        </button>
      </div>
      <div className="invoice-preview-modal-scroll">
        <div className="invoice-preview-modal-sheet-frame">
          <div
            className="invoice-preview-modal-sheet"
            dangerouslySetInnerHTML={{ __html: htmlMarkup }}
          />
        </div>
      </div>
    </div>
  );
}
