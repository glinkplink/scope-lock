-- Structured change orders: line items, status, per-job CO numbering, backfill from legacy columns.

ALTER TABLE change_orders
  ADD COLUMN IF NOT EXISTS co_number integer,
  ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS time_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS time_unit text NOT NULL DEFAULT 'days',
  ADD COLUMN IF NOT EXISTS time_note text NOT NULL DEFAULT '';

ALTER TABLE change_orders DROP CONSTRAINT IF EXISTS change_orders_status_check;
ALTER TABLE change_orders
  ADD CONSTRAINT change_orders_status_check
  CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected'));

ALTER TABLE change_orders DROP CONSTRAINT IF EXISTS change_orders_time_unit_check;
ALTER TABLE change_orders
  ADD CONSTRAINT change_orders_time_unit_check
  CHECK (time_unit IN ('hours', 'days'));

-- Backfill from legacy columns (before DROP)
UPDATE change_orders SET
  line_items = CASE
    WHEN price_delta IS NOT NULL THEN jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'description', 'Migrated from legacy change order',
        'quantity', 1,
        'unit_rate', price_delta
      )
    )
    ELSE '[]'::jsonb
  END,
  time_amount = COALESCE(ABS(COALESCE(time_delta, 0))::numeric, 0),
  time_unit = 'days',
  status = CASE
    WHEN approved IS TRUE THEN 'approved'
    WHEN approved IS FALSE THEN 'rejected'
    ELSE 'pending_approval'
  END,
  requires_approval = NOT (approved IS TRUE OR approved IS FALSE);

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY created_at, id) AS rn
  FROM change_orders
)
UPDATE change_orders c
SET co_number = n.rn
FROM numbered n
WHERE c.id = n.id;

ALTER TABLE change_orders
  DROP COLUMN IF EXISTS price_delta,
  DROP COLUMN IF EXISTS time_delta,
  DROP COLUMN IF EXISTS approved;

ALTER TABLE change_orders ALTER COLUMN co_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_change_orders_job_co_number
  ON change_orders (job_id, co_number);

CREATE OR REPLACE FUNCTION public.next_co_number(p_job_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(MAX(co_number), 0) + 1
  FROM change_orders
  WHERE job_id = p_job_id;
$$;

GRANT EXECUTE ON FUNCTION public.next_co_number(uuid) TO authenticated;

DROP POLICY IF EXISTS "select_own" ON change_orders;
DROP POLICY IF EXISTS "insert_own" ON change_orders;
DROP POLICY IF EXISTS "update_own" ON change_orders;
DROP POLICY IF EXISTS "delete_own" ON change_orders;

CREATE POLICY "Users can view own change_orders" ON change_orders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own change_orders" ON change_orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own change_orders" ON change_orders
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own change_orders" ON change_orders
  FOR DELETE USING (auth.uid() = user_id);
