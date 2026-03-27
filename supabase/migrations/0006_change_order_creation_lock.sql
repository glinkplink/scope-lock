-- Forward fix for already-applied 0005: atomic CO creation with per-job locking.

DROP FUNCTION IF EXISTS public.create_change_order(
  uuid,
  uuid,
  text,
  text,
  text,
  boolean,
  jsonb,
  numeric,
  text,
  text
);

CREATE OR REPLACE FUNCTION public.create_change_order(
  p_user_id uuid,
  p_job_id uuid,
  p_description text,
  p_reason text,
  p_status text,
  p_requires_approval boolean,
  p_line_items jsonb,
  p_time_amount numeric,
  p_time_unit text,
  p_time_note text
)
RETURNS change_orders
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_row change_orders%ROWTYPE;
  v_co_number integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'User mismatch while creating change order'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(5005, hashtext(p_job_id::text));

  SELECT COALESCE(MAX(co_number), 0) + 1
  INTO v_co_number
  FROM change_orders
  WHERE job_id = p_job_id;

  INSERT INTO change_orders (
    user_id,
    job_id,
    co_number,
    description,
    reason,
    status,
    requires_approval,
    line_items,
    time_amount,
    time_unit,
    time_note
  )
  VALUES (
    p_user_id,
    p_job_id,
    v_co_number,
    p_description,
    p_reason,
    p_status,
    p_requires_approval,
    COALESCE(p_line_items, '[]'::jsonb),
    COALESCE(p_time_amount, 0),
    COALESCE(p_time_unit, 'days'),
    COALESCE(p_time_note, '')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_change_order(
  uuid,
  uuid,
  text,
  text,
  text,
  boolean,
  jsonb,
  numeric,
  text,
  text
) TO authenticated;
