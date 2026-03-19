-- WO counter + new profile defaults
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS next_wo_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS default_warranty_period integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS default_negotiation_period integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS default_payment_methods text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS default_late_payment_terms text NOT NULL
    DEFAULT 'Balances unpaid 7 days after completion accrue 1.5% per month',
  ADD COLUMN IF NOT EXISTS default_card_fee_note boolean NOT NULL DEFAULT false;

-- New jobs columns to store full WO data
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS wo_number integer,
  ADD COLUMN IF NOT EXISTS agreement_date date,
  ADD COLUMN IF NOT EXISTS contractor_phone text,
  ADD COLUMN IF NOT EXISTS contractor_email text,
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS governing_state text,
  ADD COLUMN IF NOT EXISTS job_classification text,
  ADD COLUMN IF NOT EXISTS target_start date,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS payment_methods text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS late_payment_terms text,
  ADD COLUMN IF NOT EXISTS card_fee_note boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS negotiation_period integer,
  ADD COLUMN IF NOT EXISTS customer_obligations text[] NOT NULL DEFAULT '{}';

-- Allow upsert by name for client auto-create (MVP: name-based deduplication)
ALTER TABLE clients
  ADD CONSTRAINT IF NOT EXISTS clients_user_id_name_unique UNIQUE (user_id, name);