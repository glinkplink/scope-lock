import type { WelderJob } from '../types';
import { generateAgreement, formatAgreementAsText } from '../lib/agreement-generator';

interface AgreementPreviewProps {
  job: WelderJob;
}

export function AgreementPreview({ job }: AgreementPreviewProps) {
  const sections = generateAgreement(job);
  const plainText = formatAgreementAsText(sections);

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(plainText);
      alert('Agreement copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy:', err);
      alert('Failed to copy to clipboard');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="agreement-preview">
      <div className="preview-actions">
        <button onClick={handleCopyToClipboard} className="btn-action">
          📋 Copy Text
        </button>
        <button onClick={handlePrint} className="btn-action">
          🖨️ Print / PDF
        </button>
      </div>

      <div className="agreement-document">
        {sections.map((section, index) => (
          <div key={index} className="agreement-section">
            <h3 className="section-title">{section.title}</h3>
            <div className="section-content">
              {section.content.split('\n').map((line, i) => (
                <p key={i} className="content-line">
                  {line}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
