/** DocuSeal submission/submitter → DB patch fields. Keep server-only; tested via Vitest importing this module. */

export const DOCUSEAL_CUSTOMER_ROLE = 'Customer';

export function pickCustomerSubmitter(submission) {
  const list = submission?.submitters || [];
  return list.find((s) => s.role === DOCUSEAL_CUSTOMER_ROLE) || list[0] || null;
}

export function deriveEsignStatus(submission, submitter) {
  if (submission?.status === 'expired') return 'expired';
  if (submission?.status === 'declined') return 'declined';
  if (submitter?.status === 'declined') return 'declined';
  if (submission?.status === 'completed' || submitter?.status === 'completed') return 'completed';
  if (submitter?.opened_at) return 'opened';
  if (submitter?.status === 'opened') return 'opened';
  return 'sent';
}

export function pickSignedDocumentUrl(submission, submitter) {
  const su = submitter?.documents?.[0]?.url;
  if (su) return su;
  const sd = submission?.documents?.[0]?.url;
  if (sd) return sd;
  return null;
}

export function buildEsignRowFromSubmission(submission) {
  const submitter = pickCustomerSubmitter(submission);
  if (!submitter) {
    return null;
  }
  const status = deriveEsignStatus(submission, submitter);
  // embed_src is only present in the POST /submissions/html response; GET
  // /submissions/:id omits it.  Only write it when DocuSeal provides a value
  // so polling/resend calls don't clobber a stored signing link with null.
  const embedSrcEntry = submitter.embed_src
    ? { esign_embed_src: submitter.embed_src }
    : {};
  return {
    esign_submission_id: String(submission.id),
    esign_submitter_id: String(submitter.id),
    ...embedSrcEntry,
    esign_status: status,
    esign_submission_state: submission.status ?? null,
    esign_submitter_state: submitter.status ?? null,
    esign_sent_at: submitter.sent_at ?? null,
    esign_opened_at: submitter.opened_at ?? null,
    esign_completed_at: submitter.completed_at ?? submission.completed_at ?? null,
    esign_declined_at: submitter.declined_at ?? null,
    esign_decline_reason: submitter.decline_reason ?? null,
    esign_signed_document_url: pickSignedDocumentUrl(submission, submitter),
  };
}
