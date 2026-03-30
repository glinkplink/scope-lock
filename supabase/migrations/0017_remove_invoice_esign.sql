-- Remove invoice DocuSeal e-sign schema
-- This migration drops the invoice-specific esign_* columns added in 0016_invoices_esign_and_issuance.sql
-- while keeping the issued_at column for business state tracking.

-- Drop the CHECK constraint for invoice esign status
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_esign_status_check;

-- Drop the in-flight e-sign index (no longer needed)
DROP INDEX IF EXISTS idx_invoices_inflight_esign_by_user_created_at;

-- Drop all invoice esign_* columns (keep issued_at for business state)
ALTER TABLE invoices
  DROP COLUMN IF EXISTS esign_submission_id,
  DROP COLUMN IF EXISTS esign_submitter_id,
  DROP COLUMN IF EXISTS esign_embed_src,
  DROP COLUMN IF EXISTS esign_status,
  DROP COLUMN IF EXISTS esign_submission_state,
  DROP COLUMN IF EXISTS esign_submitter_state,
  DROP COLUMN IF EXISTS esign_sent_at,
  DROP COLUMN IF EXISTS esign_opened_at,
  DROP COLUMN IF EXISTS esign_completed_at,
  DROP COLUMN IF EXISTS esign_declined_at,
  DROP COLUMN IF EXISTS esign_decline_reason,
  DROP COLUMN IF EXISTS esign_signed_document_url;

-- Keep idx_invoices_user_id_issued_at_created_at for invoice listing by issuance date