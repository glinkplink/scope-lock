interface InvoicePreviewModalProps {
  open: boolean;
  onClose: () => void;
  /** Full inner markup from `generateInvoiceHtml` (includes `.agreement-document` root). */
  htmlMarkup: string;
}

export function InvoicePreviewModal({ open, onClose, htmlMarkup }: InvoicePreviewModalProps) {
  if (!open) return null;

  return (
    <div className="invoice-preview-modal-overlay" role="dialog" aria-modal="true" aria-label="Invoice preview">
      <div className="invoice-preview-modal-toolbar">
        <button type="button" className="home-work-orders-link" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="invoice-preview-modal-scroll">
        <div
          className="invoice-preview-modal-sheet invoice-preview-page-rhythm"
          // Paginated print-style rhythm: horizontal rules every Letter-height at 96dpi (see ARCHITECTURE.md).
          dangerouslySetInnerHTML={{ __html: htmlMarkup }}
        />
      </div>
    </div>
  );
}
