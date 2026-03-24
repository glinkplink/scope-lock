ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS default_tax_rate numeric(5,4) NOT NULL DEFAULT 0.06;
