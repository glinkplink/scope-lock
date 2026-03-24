-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "moddatetime";

-- ============================================================================
-- TABLES
-- ============================================================================

-- Business Profiles Table
CREATE TABLE business_profiles (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid        REFERENCES auth.users NOT NULL UNIQUE,
  business_name            text        NOT NULL,
  owner_name               text,
  phone                    text,
  email                    text,
  address                  text,
  google_business_profile_url text,
  default_exclusions       text[]      NOT NULL DEFAULT '{}',
  default_assumptions      text[]      NOT NULL DEFAULT '{}',
  next_wo_number           integer     NOT NULL DEFAULT 1,
  default_warranty_period  integer     NOT NULL DEFAULT 30,
  default_negotiation_period integer   NOT NULL DEFAULT 10,
  default_payment_methods  text[]      NOT NULL DEFAULT '{}',
  default_tax_rate         numeric(5,4) NOT NULL DEFAULT 0.06,
  default_late_payment_terms text      NOT NULL DEFAULT 'Balances unpaid 7 days after completion accrue 1.5% per month',
  default_card_fee_note    boolean     NOT NULL DEFAULT false,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

-- Clients Table
CREATE TABLE clients (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        REFERENCES auth.users NOT NULL,
  name            text        NOT NULL,
  name_normalized text        NOT NULL,
  phone           text,
  email           text,
  address         text,
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- Jobs Table
CREATE TABLE jobs (
  id                            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       uuid          REFERENCES auth.users NOT NULL,
  client_id                     uuid          REFERENCES clients(id) ON DELETE SET NULL,
  wo_number                     integer,
  agreement_date                date,
  customer_name                 text          NOT NULL,
  customer_phone                text,
  customer_email                text,
  job_location                  text          NOT NULL,
  job_type                      text          NOT NULL,
  asset_or_item_description     text          NOT NULL,
  requested_work                text          NOT NULL,
  contractor_phone              text,
  contractor_email              text,
  governing_state               text,
  materials_provided_by         text,
  installation_included         boolean,
  grinding_included             boolean,
  paint_or_coating_included     boolean,
  removal_or_disassembly_included boolean,
  hidden_damage_possible        boolean,
  price_type                    text          NOT NULL,
  price                         numeric(10,2) NOT NULL,
  deposit_required              boolean,
  deposit_amount                numeric(10,2),
  payment_terms                 text,
  late_payment_terms            text,
  target_start                  date,
  target_completion_date        date,
  exclusions                    text[],
  assumptions                   text[],
  customer_obligations          text[],
  change_order_required         boolean,
  workmanship_warranty_days     integer,
  negotiation_period            integer,
  status                        text          DEFAULT 'draft',
  created_at                    timestamptz   DEFAULT now(),
  updated_at                    timestamptz   DEFAULT now()
);

-- Change Orders Table
CREATE TABLE change_orders (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid          REFERENCES auth.users NOT NULL,
  job_id      uuid          REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  description text          NOT NULL,
  price_delta numeric(10,2),
  time_delta  integer,
  approved    boolean,
  created_at  timestamptz   DEFAULT now(),
  updated_at  timestamptz   DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_business_profiles_user_id ON business_profiles(user_id);
CREATE INDEX idx_clients_user_id ON clients(user_id);
CREATE INDEX idx_clients_user_id_name_normalized ON clients(user_id, name_normalized);
CREATE INDEX idx_jobs_user_id ON jobs(user_id);
CREATE INDEX idx_jobs_client_id ON jobs(client_id);
CREATE INDEX idx_change_orders_user_id ON change_orders(user_id);
CREATE INDEX idx_change_orders_job_id ON change_orders(job_id);

-- ============================================================================
-- TRIGGERS (updated_at)
-- ============================================================================

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON business_profiles
  FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON change_orders
  FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Business Profiles RLS
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own" ON business_profiles FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "insert_own" ON business_profiles FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "update_own" ON business_profiles FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "delete_own" ON business_profiles FOR DELETE
  USING (user_id = auth.uid());

-- Clients RLS
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own" ON clients FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "insert_own" ON clients FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "update_own" ON clients FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "delete_own" ON clients FOR DELETE
  USING (user_id = auth.uid());

-- Jobs RLS
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own" ON jobs FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "insert_own" ON jobs FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "update_own" ON jobs FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "delete_own" ON jobs FOR DELETE
  USING (user_id = auth.uid());

-- Change Orders RLS
ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own" ON change_orders FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "insert_own" ON change_orders FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "update_own" ON change_orders FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "delete_own" ON change_orders FOR DELETE
  USING (user_id = auth.uid());
