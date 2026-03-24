-- Invoices + atomic invoice numbering (see ARCHITECTURE.md)

ALTER TABLE business_profiles
  ADD COLUMN next_invoice_number integer NOT NULL DEFAULT 1;

CREATE TABLE invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id           uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  invoice_number   integer NOT NULL,
  invoice_date     date NOT NULL DEFAULT CURRENT_DATE,
  due_date         date NOT NULL,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'downloaded')),
  line_items       jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal         numeric(10,2) NOT NULL DEFAULT 0,
  tax_rate         numeric(5,4) NOT NULL DEFAULT 0.06,
  tax_amount       numeric(10,2) NOT NULL DEFAULT 0,
  total            numeric(10,2) NOT NULL DEFAULT 0,
  payment_methods  jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_user_id ON invoices(user_id);
CREATE INDEX idx_invoices_job_id ON invoices(job_id);

CREATE OR REPLACE FUNCTION next_invoice_number(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_next integer;
BEGIN
  UPDATE business_profiles
  SET next_invoice_number = next_invoice_number + 1
  WHERE user_id = p_user_id
  RETURNING next_invoice_number - 1 INTO v_next;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid) TO authenticated;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own invoices"
  ON invoices FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER handle_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE PROCEDURE moddatetime(updated_at);
