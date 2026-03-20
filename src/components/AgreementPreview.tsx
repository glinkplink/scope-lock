import { useLayoutEffect, useRef, useState } from 'react';
import type { WelderJob } from '../types';
import type { BusinessProfile } from '../types/db';
import { generateAgreement } from '../lib/agreement-generator';
import { saveWorkOrder } from '../lib/db/jobs';
import appCss from '../App.css?raw';

/** Letter width at 96dpi — preview layout matches PDF viewport. */
const PREVIEW_LETTER_WIDTH_PX = 816;

/** Preview upscale only applies at this breakpoint and when measure width > 816px. */
const PREVIEW_DESKTOP_UPSCALE_MQ = '(min-width: 1024px)';

interface AgreementPreviewProps {
  job: WelderJob;
  profile: BusinessProfile | null;
  existingJobId?: string;
  onSaveSuccess: (savedJobId: string, isNewSave: boolean) => void;
}

function getPdfFilename(woNumber: number, customerName: string): string {
  const sanitized = (customerName || 'customer').replace(/\s+/g, '_');
  return `WO-${String(woNumber).padStart(4, '0')}_${sanitized}.pdf`;
}

/** Business name for PDF footer (not owner/welder personal name). */
function getPdfFooterBusinessName(profile: BusinessProfile | null, job: WelderJob): string {
  return (
    profile?.business_name?.trim() ||
    job.contractor_name?.trim() ||
    ''
  );
}

function getPdfFooterPhone(profile: BusinessProfile | null, job: WelderJob): string {
  return profile?.phone || job.contractor_phone || '';
}

function buildPdfHtml(previewMarkup: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&amp;family=Dancing+Script:wght@400;700&amp;display=swap"
      rel="stylesheet"
    />
    <style>
      ${appCss}

      :root {
        color-scheme: light;
      }

      /* No @page rule: page.pdf({ margin }) is the only source of content insets (see app-server). */

      html,
      body {
        margin: 0;
        padding: 0;
        background: #ffffff;
      }

      body {
        font-family: 'Barlow', 'DIN 2014', 'Bahnschrift', 'D-DIN', system-ui, sans-serif;
        letter-spacing: normal;
        word-spacing: normal;
        -webkit-font-smoothing: antialiased;
      }

      p {
        text-align: left;
        line-height: 1.4;
        word-break: normal;
        overflow-wrap: break-word;
      }

      .pdf-render-root {
        padding: 0;
        background: #ffffff;
      }

      .agreement-document {
        border: none;
        border-radius: 0;
        box-shadow: none;
        padding: 0;
      }

      /* Key-value tables: label column tint + borders (parity with preview) */
      .content-table {
        border: 1px solid #cccccc;
        border-collapse: collapse;
      }

      .content-table td {
        border: 1px solid #cccccc;
        padding: 0.7rem 0.8rem;
      }

      .content-table.parties-party-table th.party-header-cell {
        border: 1px solid #cccccc;
        padding: 0.7rem 0.8rem;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .table-label {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      /* Extra space below Puppeteer header margin so "Work Order" clears the header rule */
      .pdf-render-root .agreement-document-header {
        padding-top: 2rem;
      }

      .content-bullets {
        list-style-type: disc;
        list-style-position: outside;
        padding-left: 1.35rem;
        margin-left: 0;
      }

      .content-bullets li {
        display: list-item;
      }

      @media print {
        body {
          -webkit-font-smoothing: antialiased;
        }
      }
    </style>
  </head>
  <body>
    <div class="pdf-render-root">${previewMarkup}</div>
  </body>
</html>`;
}

async function fetchPdfBlob(
  job: WelderJob,
  profile: BusinessProfile | null,
  previewElement: HTMLElement
): Promise<Blob> {
  const response = await fetch('/api/pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: getPdfFilename(job.wo_number, job.customer_name),
      html: buildPdfHtml(previewElement.outerHTML),
      workOrderNumber: `Work Order #${String(job.wo_number).padStart(4, '0')}`,
      providerName: getPdfFooterBusinessName(profile, job),
      providerPhone: getPdfFooterPhone(profile, job),
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Failed to generate PDF.');
  }

  return response.blob();
}

function downloadPdfBlob(blob: Blob, job: WelderJob): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = getPdfFilename(job.wo_number, job.customer_name);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function AgreementPreview({ job, profile, existingJobId, onSaveSuccess }: AgreementPreviewProps) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmationMessage, setConfirmationMessage] = useState('');
  const documentRef = useRef<HTMLDivElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const previewSheetRef = useRef<HTMLDivElement | null>(null);
  const [previewContentHeight, setPreviewContentHeight] = useState(0);
  /**
   * Screen preview only: scales the native 816px sheet to fit smaller containers,
   * and may upscale modestly on desktop. PDF markup stays 816px.
   */
  const [previewScale, setPreviewScale] = useState(1);

  const sections = generateAgreement(job, profile);

  useLayoutEffect(() => {
    const viewport = previewViewportRef.current;
    if (!viewport) return;

    const computeScale = () => {
      const w = viewport.getBoundingClientRect().width;
      if (w <= 0) return 1;

      const maxScale = window.matchMedia(PREVIEW_DESKTOP_UPSCALE_MQ).matches ? 1.5 : 1;
      return Math.min(w / PREVIEW_LETTER_WIDTH_PX, maxScale);
    };

    const updateScale = () => {
      setPreviewScale(computeScale());
    };

    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(viewport);
    const mq = window.matchMedia(PREVIEW_DESKTOP_UPSCALE_MQ);
    mq.addEventListener('change', updateScale);
    window.addEventListener('resize', updateScale);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', updateScale);
      window.removeEventListener('resize', updateScale);
    };
  }, []);

  /* Spacer height: sheet content only — ResizeObserver here does not track scroll container size. */
  useLayoutEffect(() => {
    const sheet = previewSheetRef.current;
    if (!sheet) return;

    const updateHeight = () => {
      setPreviewContentHeight(sheet.scrollHeight);
    };

    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, [job, profile]);

  const handleDownloadAndSave = async () => {
    setSaving(true);
    setSaveError('');
    setConfirmationMessage('');

    if (!documentRef.current) {
      setSaving(false);
      setSaveError('Preview is not ready yet. Please try again.');
      return;
    }

    if (!profile) {
      setSaving(false);
      setSaveError('No profile found — cannot save work order.');
      return;
    }

    const { data, error } = await saveWorkOrder(profile.user_id, job, existingJobId);

    if (error || !data) {
      setSaving(false);
      setSaveError(error?.message || 'Failed to save work order.');
      return;
    }

    const isNewSave = !existingJobId;
    onSaveSuccess(data.id, isNewSave);

    try {
      const blob = await fetchPdfBlob(job, profile, documentRef.current);
      downloadPdfBlob(blob, job);
      setConfirmationMessage(
        `WO #${String(job.wo_number).padStart(4, '0')} saved. PDF downloaded.`
      );
    } catch (pdfErr) {
      setSaveError(
        pdfErr instanceof Error
          ? `Work order saved, but PDF failed: ${pdfErr.message}`
          : 'Work order saved, but PDF download failed.'
      );
      setConfirmationMessage(`WO #${String(job.wo_number).padStart(4, '0')} saved.`);
    } finally {
      setSaving(false);
    }
  };

  const renderDownloadButton = () => (
    <button
      type="button"
      onClick={handleDownloadAndSave}
      className="btn-action btn-primary"
      disabled={saving}
    >
      {saving ? 'Saving...' : 'Download & Save'}
    </button>
  );

  return (
    <div className="agreement-preview">
      <div className="preview-actions">
        {confirmationMessage && (
          <div className="success-banner">{confirmationMessage}</div>
        )}
        {saveError && <div className="error-banner">{saveError}</div>}
        {renderDownloadButton()}
      </div>

      <div ref={previewViewportRef} className="agreement-preview-scale-viewport">
        <div
          className="agreement-preview-scale-spacer"
          style={{
            width: PREVIEW_LETTER_WIDTH_PX * previewScale,
            height: previewContentHeight * previewScale,
          }}
        >
          <div
            ref={previewSheetRef}
            className="agreement-preview-scale-sheet"
            style={{
              width: PREVIEW_LETTER_WIDTH_PX,
              transform: previewScale !== 1 ? `scale(${previewScale})` : undefined,
              transformOrigin: 'top left',
            }}
          >
                <div ref={documentRef} className="agreement-document">
              <div className="agreement-document-header">
                <h2 className="agreement-document-title">Work Order</h2>
              </div>
              {sections.map((section, si) => (
                <div
                  key={si}
                  className={`agreement-section ${section.signatureData ? 'signature-section' : ''}`}
                >
                  <h3 className="section-title">
                    {section.number > 0 ? `${section.number}. ${section.title}` : section.title}
                  </h3>
                  <div className="section-content">
                    {section.blocks.map((block, bi) => {
                if (block.type === 'paragraph') {
                  return (
                    <p key={bi} className="content-paragraph">
                      {block.text}
                    </p>
                  );
                }
                if (block.type === 'note') {
                  return (
                    <p key={bi} className="content-note">
                      {block.text}
                    </p>
                  );
                }
                if (block.type === 'bullets') {
                  return (
                    <ul key={bi} className="content-bullets">
                      {block.items.map((item, ii) => (
                        <li key={ii}>{item}</li>
                      ))}
                    </ul>
                  );
                }
                if (block.type === 'partiesLayout') {
                  const { agreementDate, serviceProvider: sp, customer: cu, jobSiteAddress } = block;
                  return (
                    <div key={bi} className="parties-layout">
                      <div className="parties-plain">
                        <div className="parties-plain-row">
                          <span className="parties-plain-label">Agreement Date:</span>
                          <span className="parties-plain-value">{agreementDate}</span>
                        </div>
                      </div>
                      <table className="content-table parties-party-table">
                        <tbody>
                          <tr className="party-table-header-row">
                            <th
                              className="party-header-cell party-header-spacer"
                              scope="col"
                              aria-hidden="true"
                            >
                              {'\u00a0'}
                            </th>
                            <th scope="col" className="party-header-cell">
                              Service Provider
                            </th>
                            <th scope="col" className="party-header-cell">
                              Customer
                            </th>
                          </tr>
                          <tr>
                            <td className="table-label">Name</td>
                            <td className="table-value">{sp.businessName}</td>
                            <td className="table-value">{cu.name}</td>
                          </tr>
                          <tr>
                            <td className="table-label">Phone</td>
                            <td className="table-value">{sp.phone}</td>
                            <td className="table-value">{cu.phone}</td>
                          </tr>
                          <tr>
                            <td className="table-label">Email</td>
                            <td className="table-value">{sp.email}</td>
                            <td className="table-value">{cu.email}</td>
                          </tr>
                        </tbody>
                      </table>
                      <div className="parties-plain">
                        <div className="parties-plain-row">
                          <span className="parties-plain-label">Job Site Address:</span>
                          <span className="parties-plain-value">{jobSiteAddress}</span>
                        </div>
                      </div>
                    </div>
                  );
                }
                if (block.type === 'table') {
                  return (
                    <table key={bi} className="content-table">
                      <tbody>
                        {block.rows.map(([label, value], ri) => (
                          <tr key={ri}>
                            <td className="table-label">{label}</td>
                            <td className="table-value">{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                }
                if (block.type === 'signature') {
                  const sig = section.signatureData;
                  if (!sig) return null;
                  return (
                    <div key={bi} className="signature-blocks">
                      <div className="signature-block">
                        <div className="signature-block-identifier">Customer</div>
                        <div className="signature-field">
                          <span className="signature-field-label">Name</span>
                          <div className="signature-field-value">{sig.customerName}</div>
                        </div>
                        <div className="signature-field">
                          <span className="signature-field-label">Signature</span>
                          <div className="signature-field-value" />
                        </div>
                        <div className="signature-field">
                          <span className="signature-field-label">Date</span>
                          <div className="signature-field-value" />
                        </div>
                      </div>
                      <div className="signature-block">
                        <div className="signature-block-identifier">Service Provider</div>
                        <div className="signature-field">
                          <span className="signature-field-label">Name</span>
                          <div className="signature-field-value">{sig.ownerName}</div>
                        </div>
                        <div className="signature-field">
                          <span className="signature-field-label">Signature</span>
                          <div className="signature-field-value">
                            <div className="signature-autofill-name">{sig.ownerName}</div>
                          </div>
                        </div>
                        <div className="signature-field">
                          <span className="signature-field-label">Date</span>
                          <div className="signature-field-value">{sig.ownerDate}</div>
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="preview-actions preview-actions-bottom">
        {renderDownloadButton()}
      </div>
    </div>
  );
}
