import { jsPDF } from 'jspdf';
import type { WelderJob } from '../types';
import type { BusinessProfile } from '../types/db';
import { generateAgreement, formatAgreementAsText } from '../lib/agreement-generator';

interface AgreementPreviewProps {
  job: WelderJob;
  profile: BusinessProfile | null;
}

function getPdfFilename(customerName: string): string {
  const sanitized = customerName.replace(/\s+/g, '');
  const d = new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const yy = String(d.getFullYear()).slice(-2);
  return `${sanitized}${m}-${day}-${yy}.pdf`;
}

export function AgreementPreview({ job, profile }: AgreementPreviewProps) {
  const sections = generateAgreement(job, profile);
  const plainText = formatAgreementAsText(sections);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = () => {
    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.height; // ~297mm for A4
    const pageWidth = doc.internal.pageSize.width;   // ~210mm for A4
    const margin = 20;
    const maxWidth = pageWidth - (margin * 2);       // ~170mm
    const baseLineHeight = 6;                        // Base line height

    let yPosition = margin;
    const lines = doc.splitTextToSize(plainText, maxWidth);

    // Section headers to detect for special formatting
    const sectionHeaders = [
      'WELDING SERVICES AGREEMENT',
      'Project Overview',
      'Scope of Work',
      'Materials',
      'Exclusions',
      'Hidden Damage Clause',
      'Third-Party Work',
      'Change Orders',
      'Pricing and Payment',
      'Completion and Responsibility',
      'Workmanship Warranty',
      'Client Acknowledgment',
    ];

    lines.forEach((line: string) => {
      const trimmedLine = line.trim();
      const isMainTitle = trimmedLine === 'WELDING SERVICES AGREEMENT';
      const isSectionHeader = sectionHeaders.includes(trimmedLine);
      const isEmptyLine = trimmedLine === '';

      // Determine line height and spacing
      let lineHeight = baseLineHeight;
      if (isEmptyLine) {
        lineHeight = 3; // Reduced spacing for empty lines
      } else if (isSectionHeader) {
        lineHeight = baseLineHeight + 2; // Extra space after headers
      }

      // Check if adding this line would exceed page height
      if (yPosition + lineHeight > pageHeight - margin) {
        doc.addPage();
        yPosition = margin;
      }

      // Skip rendering empty lines, just add spacing
      if (!isEmptyLine) {
        // Set font style for headers
        if (isMainTitle) {
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
        } else if (isSectionHeader) {
          doc.setFontSize(12);
          doc.setFont('helvetica', 'bold');
        } else {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
        }

        doc.text(line, margin, yPosition);
      }

      yPosition += lineHeight;
    });

    doc.save(getPdfFilename(job.customer_name));
  };

  const actionButtons = (
    <div className="preview-actions">
      <button onClick={handlePrint} className="btn-action">
        Print
      </button>
      <button onClick={handleDownloadPdf} className="btn-action">
        📥 Download PDF
      </button>
    </div>
  );

  return (
    <div className="agreement-preview">
      {actionButtons}

      <div className="agreement-document">
        {sections.map((section, index) => {
          const isSignature = !!section.signatureData;
          const sig = section.signatureData;
          return (
            <div
              key={index}
              className={`agreement-section ${isSignature ? 'signature-section' : ''}`}
            >
              <h3 className="section-title">{section.title}</h3>
              <div className="section-content">
                {section.content.split('\n').map((line, i) => (
                  <p key={i} className="content-line">
                    {line}
                  </p>
                ))}
                {sig && (
                  <div className="signature-blocks">
                    <div className="signature-block">
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
                      <div className="signature-field">
                        <span className="signature-field-label">Name</span>
                        <div className="signature-field-value signature-typed-autofill">
                          {sig.ownerName}
                        </div>
                      </div>
                      <div className="signature-field">
                        <span className="signature-field-label">Signature</span>
                        <div className="signature-field-value" />
                      </div>
                      <div className="signature-field">
                        <span className="signature-field-label">Date</span>
                        <div className="signature-field-value">{sig.ownerDate}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {actionButtons}
    </div>
  );
}
