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

// Labels that should have bold formatting
const BOLD_LABELS = [
  'Date:',
  'Service Provider:',
  'Customer:',
  'Job Location:',
  'Phone:',
  'Item/Structure:',
  'Work Requested:',
  'Job Type:',
  'Total Price:',
  'Price Type:',
  'Deposit Required:',
  'Payment Terms:',
  'Target Completion:',
  'Name:',
  'Signature:',
];

// Parse a line and return label/value parts if it matches a known label
function parseLabeledLine(line: string): { label: string; value: string } | null {
  for (const label of BOLD_LABELS) {
    if (line.startsWith(label)) {
      return { label, value: line.slice(label.length).trim() };
    }
  }
  return null;
}

// Render a line with bold label for HTML preview
function renderLineWithBoldLabel(line: string, key: number) {
  const parsed = parseLabeledLine(line);
  if (parsed) {
    return (
      <p key={key} className="content-line">
        <strong>{parsed.label}</strong> {parsed.value}
      </p>
    );
  }
  return (
    <p key={key} className="content-line">
      {line}
    </p>
  );
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
    const usableHeight = pageHeight - (margin * 2);  // Usable page height

    let yPosition = margin;
    const lines = doc.splitTextToSize(plainText, maxWidth);

    // Section headers to detect for special formatting
    const sectionHeaders = [
      'WELDING SERVICES AGREEMENT',
      'Project Overview',
      'Scope of Work',
      'Materials',
      'Exclusions',
      'Assumptions',
      'Hidden Damage Clause',
      'Third-Party Work',
      'Change Orders',
      'Pricing and Payment',
      'Completion and Responsibility',
      'Workmanship Warranty',
      'Agreement and Acknowledgment',
    ];

    // Signature block party labels
    const signaturePartyLabels = ['Customer', 'Service Provider'];

    // Pre-calculate section boundaries for smart page breaks
    const sectionStartIndices: number[] = [];
    lines.forEach((line: string, index: number) => {
      if (sectionHeaders.includes(line.trim())) {
        sectionStartIndices.push(index);
      }
    });

    // Calculate height needed for content from startIdx to next section (or end)
    const getContentHeightUntilNextSection = (startIdx: number): number => {
      const nextSectionIdx = sectionStartIndices.find(i => i > startIdx) ?? lines.length;
      let height = 0;
      for (let i = startIdx; i < nextSectionIdx; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === '') {
          height += 3;
        } else if (sectionHeaders.includes(trimmed)) {
          height += baseLineHeight + 2 + 4; // header height + spacing
        } else {
          height += baseLineHeight;
        }
      }
      return height;
    };

    lines.forEach((line: string, index: number) => {
      const trimmedLine = line.trim();
      const isMainTitle = trimmedLine === 'WELDING SERVICES AGREEMENT';
      const isSectionHeader = sectionHeaders.includes(trimmedLine);
      const isSignaturePartyLabel = signaturePartyLabels.includes(trimmedLine);
      const isEmptyLine = trimmedLine === '';

      // Track if we're in Service Provider section
      const previousLines = lines.slice(0, index).map((l: string) => l.trim());
      const isAfterServiceProvider = previousLines.includes('Service Provider');
      const isBeforeCustomer = !previousLines.includes('Customer') ||
                               previousLines.lastIndexOf('Service Provider') > previousLines.lastIndexOf('Customer');

      // Check if this is the Service Provider's signature line
      const isProviderSignatureLine =
        isAfterServiceProvider &&
        isBeforeCustomer &&
        trimmedLine.startsWith('Signature:');

      // Determine line height and spacing
      let lineHeight = baseLineHeight;
      if (isEmptyLine) {
        lineHeight = 3;
      } else if (isSectionHeader) {
        lineHeight = baseLineHeight + 2;
      }

      // Add extra space before "Customer" signature label
      if (trimmedLine === 'Customer') {
        yPosition += 15;
      }

      // Smart page break: when hitting a section header, check if section fits
      if (isSectionHeader && !isMainTitle) {
        const sectionHeight = getContentHeightUntilNextSection(index);
        const spaceRemaining = usableHeight - (yPosition - margin);

        // If less than 40% of section fits, start new page
        if (sectionHeight > spaceRemaining && spaceRemaining < sectionHeight * 0.6) {
          doc.addPage();
          yPosition = margin;
        }
      }

      // Basic overflow check
      if (yPosition + lineHeight > pageHeight - margin) {
        doc.addPage();
        yPosition = margin;
      }

      // Add spacing before section headers (except main title and if not at page top)
      if (isSectionHeader && !isMainTitle && yPosition > margin + 5) {
        yPosition += 4;
      }

      // Render the line
      if (!isEmptyLine) {
        if (isMainTitle) {
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          doc.text(line, pageWidth / 2, yPosition, { align: 'center' });
        } else if (isSectionHeader) {
          doc.setFontSize(12);
          doc.setFont('helvetica', 'bold');
          doc.text(line, margin, yPosition);
        } else if (isSignaturePartyLabel) {
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.text(line, margin, yPosition);
        } else if (isProviderSignatureLine) {
          // Render Service Provider signature with label in bold, value in italic
          doc.setFontSize(10);
          const parsed = parseLabeledLine(trimmedLine);
          if (parsed) {
            doc.setFont('helvetica', 'bold');
            doc.text(parsed.label, margin, yPosition);
            const labelWidth = doc.getTextWidth(parsed.label + ' ');
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(14);
            doc.text(parsed.value, margin + labelWidth, yPosition);
            doc.setFontSize(10); // Reset font size
          } else {
            doc.setFont('helvetica', 'normal');
            doc.text(line, margin, yPosition);
          }
        } else {
          doc.setFontSize(10);
          const parsed = parseLabeledLine(trimmedLine);
          if (parsed) {
            doc.setFont('helvetica', 'bold');
            doc.text(parsed.label, margin, yPosition);
            const labelWidth = doc.getTextWidth(parsed.label + ' ');
            doc.setFont('helvetica', 'normal');
            doc.text(parsed.value, margin + labelWidth, yPosition);
          } else {
            doc.setFont('helvetica', 'normal');
            doc.text(line, margin, yPosition);
          }
        }
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
                {section.content.split('\n').map((line, i) => renderLineWithBoldLabel(line, i))}
                {sig && (
                  <div className="signature-blocks">
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
