import { useState } from 'react';
import { jsPDF } from 'jspdf';
import type { WelderJob, AgreementSection } from '../types';
import type { BusinessProfile } from '../types/db';
import { generateAgreement } from '../lib/agreement-generator';
import { saveWorkOrder } from '../lib/db/jobs';

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

function drawHeader(doc: jsPDF, woNumber: number, pageWidth: number, sideMargin: number) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(170, 170, 170);
  doc.text(`Work Order #${String(woNumber).padStart(4, '0')}`, sideMargin, 10);
  doc.text('Confidential', pageWidth / 2, 10, { align: 'center' });
  doc.setDrawColor(189, 215, 238);
  doc.setLineWidth(0.5);
  doc.line(sideMargin, 13, pageWidth - sideMargin, 13);
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
}

function drawFooter(
  doc: jsPDF,
  pageNum: number,
  pageWidth: number,
  pageHeight: number,
  sideMargin: number,
  profileName: string,
  profilePhone: string
) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(170, 170, 170);
  doc.setDrawColor(189, 215, 238);
  doc.setLineWidth(0.5);
  doc.line(sideMargin, pageHeight - 14, pageWidth - sideMargin, pageHeight - 14);
  const providerText = profilePhone
    ? `Service Provider: ${profileName} | ${profilePhone}`
    : `Service Provider: ${profileName}`;
  doc.text(providerText, sideMargin, pageHeight - 10);
  doc.text(`Page ${pageNum}`, pageWidth - sideMargin, pageHeight - 10, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
}

function buildPdf(job: WelderJob, profile: BusinessProfile | null, sections: AgreementSection[]) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const topMargin = 25;
  const sideMargin = 20;
  const bottomMargin = 22;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - sideMargin * 2;

  const profileName = profile?.business_name || job.contractor_name || 'Service Provider';
  const profilePhone = profile?.phone || job.contractor_phone || '';

  let y = topMargin;

  drawHeader(doc, job.wo_number, pageWidth, sideMargin);

  const checkPageBreak = (needed: number) => {
    if (y + needed > pageHeight - bottomMargin) {
      doc.addPage();
      drawHeader(doc, job.wo_number, pageWidth, sideMargin);
      y = topMargin;
    }
  };

  // Title
  checkPageBreak(12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Work Order', pageWidth / 2, y, { align: 'center' });
  y += 12;

  for (const section of sections) {
    const sectionLabel =
      section.number > 0 ? `${section.number}. ${section.title}` : section.title;

    checkPageBreak(10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(sectionLabel, sideMargin, y);
    y += 7;

    for (const block of section.blocks) {
      if (block.type === 'paragraph') {
        const lines = doc.splitTextToSize(block.text, contentWidth);
        const needed = lines.length * 5 + 4;
        checkPageBreak(needed);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(lines, sideMargin, y);
        y += lines.length * 5 + 4;
      } else if (block.type === 'bullets') {
        for (const item of block.items) {
          const bulletText = `\u2022  ${item}`;
          const lines = doc.splitTextToSize(bulletText, contentWidth - 5);
          const needed = lines.length * 5 + 2;
          checkPageBreak(needed);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.text(lines, sideMargin + 5, y);
          y += lines.length * 5 + 2;
        }
        y += 2;
      } else if (block.type === 'table') {
        const labelColWidth = 55;
        const valueColWidth = contentWidth - labelColWidth;
        const cellPadX = 3;
        const cellPadY = 4;

        for (let ri = 0; ri < block.rows.length; ri++) {
          const [label, value] = block.rows[ri];
          const valueLines = doc.splitTextToSize(value || '', valueColWidth - cellPadX * 2);
          const rowHeight = Math.max(8, valueLines.length * 5 + cellPadY * 2);

          checkPageBreak(rowHeight);

          if (ri % 2 === 0) {
            doc.setFillColor(247, 247, 245);
            doc.rect(sideMargin, y, contentWidth, rowHeight, 'F');
          }

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.text(label, sideMargin + cellPadX, y + cellPadY + 1.5);

          doc.setFont('helvetica', 'normal');
          doc.text(valueLines, sideMargin + labelColWidth + cellPadX, y + cellPadY + 1.5);

          y += rowHeight;
        }
        y += 3;
      } else if (block.type === 'signature') {
        const sig = section.signatureData;
        if (!sig) continue;

        checkPageBreak(50);

        const sigColWidth = (contentWidth - 10) / 2;
        const cols = [
          { x: sideMargin, label: 'Customer', name: sig.customerName, autofillSig: '', date: '' },
          {
            x: sideMargin + sigColWidth + 10,
            label: 'Service Provider',
            name: sig.ownerName,
            autofillSig: sig.ownerName,
            date: sig.ownerDate,
          },
        ];

        const startY = y;
        for (const col of cols) {
          let cy = startY;

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.text(col.label, col.x, cy);
          cy += 7;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.text(`Name: ${col.name}`, col.x, cy);
          cy += 8;

          doc.text('Signature:', col.x, cy);
          if (col.autofillSig) {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(13);
            doc.text(col.autofillSig, col.x + 25, cy);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
          } else {
            doc.setDrawColor(150, 150, 150);
            doc.line(col.x + 25, cy + 1, col.x + sigColWidth - 5, cy + 1);
            doc.setDrawColor(0, 0, 0);
          }
          cy += 8;

          doc.text('Date:', col.x, cy);
          if (col.date) {
            doc.text(col.date, col.x + 15, cy);
          } else {
            doc.setDrawColor(150, 150, 150);
            doc.line(col.x + 15, cy + 1, col.x + sigColWidth - 5, cy + 1);
            doc.setDrawColor(0, 0, 0);
          }
        }

        y = startY + 32;
      }

      // Completion Acceptance block
      y += 10;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('COMPLETION ACCEPTANCE', sideMargin, y);
      y += 8;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const completionText = 'I confirm the work described in this Agreement has been completed to my satisfaction. Remaining balance is due upon signing.';
      const completionLines = doc.splitTextToSize(completionText, contentWidth);
      doc.text(completionLines, sideMargin, y);
      y += completionLines.length * 5 + 10;

      doc.text('Customer Signature:', sideMargin, y);
      doc.setDrawColor(150, 150, 150);
      doc.line(sideMargin + 35, y + 1, sideMargin + 180, y + 1);
      doc.text('Date:', sideMargin + 200, y);
      doc.line(sideMargin + 220, y + 1, sideMargin + 280, y + 1);
      doc.setDrawColor(0, 0, 0);
    }

    y += 5;
  }

  // Stamp footers on all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, i, pageWidth, pageHeight, sideMargin, profileName, profilePhone);
  }

  doc.save(getPdfFilename(job.wo_number, job.customer_name));
}

export function AgreementPreview({ job, profile, existingJobId, onSaveSuccess }: AgreementPreviewProps) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmationMessage, setConfirmationMessage] = useState('');

  const sections = generateAgreement(job, profile);

  const handleDownloadAndSave = async () => {
    setSaving(true);
    setSaveError('');
    setConfirmationMessage('');

    buildPdf(job, profile, sections);

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

  const downloadButton = (
    <button onClick={handleDownloadAndSave} className="btn-action btn-primary" disabled={saving}>
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
        {downloadButton}
      </div>

      <div className="agreement-document">
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

      <div className="preview-actions">
        {downloadButton}
      </div>
    </div>
  );
}
