-- Structured payment terms: replace free-text late_payment_terms with
-- payment_terms_days (Net X) and late_fee_rate (% per month).

-- business_profiles: structured defaults (NOT NULL with sensible defaults)
ALTER TABLE business_profiles
  ADD COLUMN default_payment_terms_days integer NOT NULL DEFAULT 14,
  ADD COLUMN default_late_fee_rate numeric(5,2) NOT NULL DEFAULT 1.5;

-- jobs: per-job overrides (nullable — falls back to profile defaults)
ALTER TABLE jobs
  ADD COLUMN payment_terms_days integer,
  ADD COLUMN late_fee_rate numeric(5,2);
