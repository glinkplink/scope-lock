import type { WelderJob } from '../types';
import type { BusinessProfile } from '../types/db';
import appCss from '../App.css?raw';

export function getPdfFilename(woNumber: number, customerName: string): string {
  const sanitized = (customerName || 'customer').replace(/\s+/g, '_');
  return `WO-${String(woNumber).padStart(4, '0')}_${sanitized}.pdf`;
}

/** Padded label for PDF margin header (matches server `buildHeaderTemplate` left cell). */
export function getWorkOrderHeaderLabel(job: WelderJob): string {
  return `Work Order #${String(job.wo_number).padStart(4, '0')}`;
}

/** Business name for PDF footer (not owner/welder personal name). */
export function getPdfFooterBusinessName(profile: BusinessProfile | null, job: WelderJob): string {
  return profile?.business_name?.trim() || job.contractor_name?.trim() || '';
}

export function getPdfFooterPhone(profile: BusinessProfile | null, job: WelderJob): string {
  return profile?.phone || job.contractor_phone || '';
}

export function buildPdfHtml(previewMarkup: string): string {
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

export async function fetchAgreementPdfBlob(
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
      workOrderNumber: getWorkOrderHeaderLabel(job),
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

export function downloadAgreementPdfBlob(blob: Blob, job: WelderJob): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = getPdfFilename(job.wo_number, job.customer_name);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
