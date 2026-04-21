-- Landing page email capture (updates list, no auth required)

CREATE TABLE landing_email_captures (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text        NOT NULL,
  source     text        NOT NULL DEFAULT 'landing_page',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX landing_email_captures_created_at_idx ON landing_email_captures (created_at DESC);

ALTER TABLE landing_email_captures ENABLE ROW LEVEL SECURITY;

-- Anonymous and signed-in visitors can submit; no public SELECT
CREATE POLICY "landing_email_captures_insert_anon"
  ON landing_email_captures
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "landing_email_captures_insert_authenticated"
  ON landing_email_captures
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

GRANT INSERT ON landing_email_captures TO anon, authenticated;
