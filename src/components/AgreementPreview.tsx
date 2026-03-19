import { useRef, useState } from 'react';
import type { WelderJob } from '../types';
import type { BusinessProfile } from '../types/db';
import { generateAgreement } from '../lib/agreement-generator';
import { saveWorkOrder } from '../lib/db/jobs';
import appCss from '../App.css?raw';

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

function getProviderDisplay(profile: BusinessProfile | null, job: WelderJob) {
  return {
    name: profile?.owner_name || profile?.business_name || job.contractor_name || 'Service Provider',
    phone: profile?.phone || job.contractor_phone || '',
  };
}

function buildPdfHtml(previewMarkup: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      ${appCss}

      :root {
        color-scheme: light;
      }

      @page {
        size: Letter;
        margin: 0.35in;
      }

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

      /* Match on-screen tables: borders + row shading for PDF */
      .content-table {
        border: 1px solid #cccccc;
        border-collapse: collapse;
      }

      .content-table td {
        border-bottom: 1px solid #cccccc;
        padding: 0.7rem 0.8rem;
      }

      .content-table tr:nth-child(odd) {
        background: #f7f7f5;
      }

      .content-table tr:last-child td {
        border-bottom: none;
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

async function buildPdf(job: WelderJob, profile: BusinessProfile | null, previewElement: HTMLElement) {
  const provider = getProviderDisplay(profile, job);

  const response = await fetch('/api/pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: getPdfFilename(job.wo_number, job.customer_name),
      html: buildPdfHtml(previewElement.outerHTML),
      workOrderNumber: `Work Order #${String(job.wo_number).padStart(4, '0')}`,
      providerName: provider.name,
      providerPhone: provider.phone,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Failed to generate PDF.');
  }

  const blob = await response.blob();
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

  const sections = generateAgreement(job, profile);

  const handleDownloadAndSave = async () => {
    setSaving(true);
    setSaveError('');
    setConfirmationMessage('');

    if (!documentRef.current) {
      setSaving(false);
      setSaveError('Preview is not ready yet. Please try again.');
      return;
    }

    try {
      await buildPdf(job, profile, documentRef.current);
    } catch (error) {
      setSaving(false);
      setSaveError(error instanceof Error ? error.message : 'Failed to generate PDF.');
      return;
    }

    if (!profile) {
      setSaving(false);
      setSaveError('No profile found — cannot save work order.');
      return;
    }

    const { data, error } = await saveWorkOrder(profile.user_id, job, existingJobId);

    setSaving(false);

    if (error || !data) {
      setSaveError(error?.message || 'Failed to save work order.');
      return;
    }

    const isNewSave = !existingJobId;
    setConfirmationMessage(
      `WO #${String(job.wo_number).padStart(4, '0')} saved. PDF downloaded.`
    );
    onSaveSuccess(data.id, isNewSave);
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

      <div className="preview-actions preview-actions-bottom">
        {renderDownloadButton()}
      </div>
    </div>
  );
}
