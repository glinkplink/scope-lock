import type { EsignJobStatus, Job } from '../types/db';
import { fetchWithSupabaseAuth } from './fetch-with-supabase-auth';

export interface EsignSendDocumentsPayload {
  name?: string;
  send_email?: boolean;
  order?: 'preserved' | 'random';
  completed_redirect_url?: string;
  message?: { subject?: string; body?: string };
  documents: Array<{
    name?: string;
    html: string;
    html_header?: string;
    html_footer?: string;
    size?: string;
  }>;
}

export interface EsignApiResponse {
  jobId: string;
  esign_submission_id: string | null;
  esign_submitter_id: string | null;
  esign_embed_src: string | null;
  esign_status: EsignJobStatus;
  esign_submission_state: string | null;
  esign_submitter_state: string | null;
  esign_sent_at: string | null;
  esign_opened_at: string | null;
  esign_completed_at: string | null;
  esign_declined_at: string | null;
  esign_decline_reason: string | null;
  esign_signed_document_url: string | null;
}

export async function sendWorkOrderForSignature(
  jobId: string,
  payload: EsignSendDocumentsPayload
): Promise<EsignApiResponse> {
  const res = await fetchWithSupabaseAuth(`/api/esign/work-orders/${jobId}/send`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg =
      json && typeof json === 'object' && json !== null && 'error' in json
        ? String((json as { error: unknown }).error)
        : text || res.statusText;
    throw new Error(msg);
  }
  return json as EsignApiResponse;
}

/** Apply send/resend API payload onto an in-memory `Job` row. */
export function mergeEsignResponseIntoJob(job: Job, r: EsignApiResponse): Job {
  return {
    ...job,
    esign_submission_id: r.esign_submission_id,
    esign_submitter_id: r.esign_submitter_id,
    esign_embed_src: r.esign_embed_src,
    esign_status: r.esign_status,
    esign_submission_state: r.esign_submission_state,
    esign_submitter_state: r.esign_submitter_state,
    esign_sent_at: r.esign_sent_at,
    esign_opened_at: r.esign_opened_at,
    esign_completed_at: r.esign_completed_at,
    esign_declined_at: r.esign_declined_at,
    esign_decline_reason: r.esign_decline_reason,
    esign_signed_document_url: r.esign_signed_document_url,
  };
}

export async function resendWorkOrderSignature(
  jobId: string,
  message?: { subject?: string; body?: string }
): Promise<EsignApiResponse> {
  const res = await fetchWithSupabaseAuth(`/api/esign/work-orders/${jobId}/resend`, {
    method: 'POST',
    body: JSON.stringify(message ? { message } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg =
      json && typeof json === 'object' && json !== null && 'error' in json
        ? String((json as { error: unknown }).error)
        : text || res.statusText;
    throw new Error(msg);
  }
  return json as EsignApiResponse;
}
