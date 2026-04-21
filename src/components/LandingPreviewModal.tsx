import { useEffect, useRef, type KeyboardEvent } from 'react';
import './LandingPreviewModal.css';

export interface LandingPreviewModalProps {
  open: boolean;
  onClose: () => void;
  /** HTML for the document sheet (e.g. agreement/invoice markup). */
  htmlMarkup: string;
  /** Short title shown in the toolbar (e.g. "Work order preview"). */
  title: string;
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

export function LandingPreviewModal({ open, onClose, htmlMarkup, title }: LandingPreviewModalProps) {
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
      className="landing-preview-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="landing-preview-modal-toolbar">
        <div className="landing-preview-modal-heading">
          <p className="landing-preview-modal-kicker">Document preview</p>
          <p className="landing-preview-modal-title">{title}</p>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className="landing-preview-modal-close"
          onClick={onClose}
        >
          Close preview
        </button>
      </div>
      <div className="landing-preview-modal-scroll">
        <div className="landing-preview-modal-sheet-frame">
          <div
            className="landing-preview-modal-sheet"
            dangerouslySetInnerHTML={{ __html: htmlMarkup }}
          />
        </div>
      </div>
    </div>
  );
}
