import type { AgreementSection } from '../types';

interface AgreementDocumentSectionsProps {
  sections: AgreementSection[];
}

/** Renders agreement body sections (same markup as preview/PDF). Parent supplies `.agreement-document` wrapper + ref for PDF. */
export function AgreementDocumentSections({ sections }: AgreementDocumentSectionsProps) {
  return (
    <>
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
    </>
  );
}
