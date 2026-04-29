import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import './InvoicePreviewModal.css';

interface InvoicePreviewModalProps {
  open: boolean;
  onClose: () => void;
  /** Full inner markup from `generateInvoiceHtml` (includes `.agreement-document` root). */
  htmlMarkup: string;
  /** Toolbar kicker; default keeps invoice call sites unchanged. */
  kicker?: string;
  /** Dialog accessible name; default keeps invoice call sites unchanged. */
  ariaLabel?: string;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const LETTER_WIDTH_PX = 816;
const LETTER_HEIGHT_PX = 1056;

function tabbableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    const ti = el.getAttribute('tabindex');
    if (ti === '-1') return false;
    if (el.hidden) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

export function InvoicePreviewModal({
  open,
  onClose,
  htmlMarkup,
  kicker = 'Invoice preview',
  ariaLabel = 'Invoice preview',
}: InvoicePreviewModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const layoutFrameRef = useRef<number | null>(null);
  const [scale, setScale] = useState(1);
  const [sheetHeight, setSheetHeight] = useState(LETTER_HEIGHT_PX);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    const updateLayout = () => {
      const scroll = scrollRef.current;
      const sheet = sheetRef.current;
      if (!scroll || !sheet) return;

      const style = window.getComputedStyle(scroll);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const availableWidth = scroll.clientWidth - padX;
      const availableHeight = scroll.clientHeight - padY;
      const widthScale =
        availableWidth > 0 ? availableWidth / LETTER_WIDTH_PX : 1;
      const firstPageScale =
        availableHeight > 0 ? availableHeight / LETTER_HEIGHT_PX : 1;
      const nextScale = Math.min(1, widthScale, firstPageScale);
      const nextSheetHeight = Math.max(sheet.scrollHeight, LETTER_HEIGHT_PX);

      setScale((current) => (Math.abs(current - nextScale) > 0.001 ? nextScale : current));
      setSheetHeight((current) => (current !== nextSheetHeight ? nextSheetHeight : current));
    };

    const scheduleLayout = () => {
      if (layoutFrameRef.current != null) return;
      layoutFrameRef.current = window.requestAnimationFrame(() => {
        layoutFrameRef.current = null;
        updateLayout();
      });
    };

    scheduleLayout();
    window.addEventListener('resize', scheduleLayout);
    if ('fonts' in document && document.fonts?.ready) {
      void document.fonts.ready.then(scheduleLayout).catch(() => {});
    }
    return () => {
      if (layoutFrameRef.current != null) {
        window.cancelAnimationFrame(layoutFrameRef.current);
        layoutFrameRef.current = null;
      }
      window.removeEventListener('resize', scheduleLayout);
    };
  }, [open, htmlMarkup]);

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

  const scaledWidth = LETTER_WIDTH_PX * scale;
  const scaledHeight = sheetHeight * scale;

  return (
    <div
      ref={dialogRef}
      className="invoice-preview-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="invoice-preview-modal-toolbar">
        <div className="invoice-preview-modal-heading">
          <p className="invoice-preview-modal-kicker">{kicker}</p>
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
      <div ref={scrollRef} className="invoice-preview-modal-scroll">
        <div
          className="invoice-preview-modal-stage"
          style={{ width: scaledWidth, height: scaledHeight }}
        >
          <div
            ref={sheetRef}
            className="invoice-preview-modal-sheet"
            style={{
              width: LETTER_WIDTH_PX,
              transform: scale !== 1 ? `scale(${scale})` : undefined,
              transformOrigin: 'top left',
            }}
            dangerouslySetInnerHTML={{ __html: htmlMarkup }}
          />
        </div>
      </div>
    </div>
  );
}
