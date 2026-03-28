-- DocuSeal e-sign state on work orders (single row per job; resend via PUT submitter).
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS esign_submission_id text,
  ADD COLUMN IF NOT EXISTS esign_submitter_id text,
  ADD COLUMN IF NOT EXISTS esign_embed_src text,
  ADD COLUMN IF NOT EXISTS esign_status text NOT NULL DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS esign_submission_state text,
  ADD COLUMN IF NOT EXISTS esign_submitter_state text,
  ADD COLUMN IF NOT EXISTS esign_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS esign_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS esign_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS esign_declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS esign_decline_reason text,
  ADD COLUMN IF NOT EXISTS esign_signed_document_url text;

COMMENT ON COLUMN jobs.esign_status IS 'not_sent | sent | opened | completed | declined | expired';
