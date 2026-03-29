CREATE INDEX IF NOT EXISTS idx_jobs_user_id_created_at
  ON jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_user_id_job_id_created_at
  ON invoices (user_id, job_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.list_work_orders_dashboard(
  p_user_id uuid,
  p_job_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  wo_number integer,
  customer_name text,
  job_type text,
  other_classification text,
  agreement_date date,
  created_at timestamptz,
  price numeric,
  esign_status text,
  change_orders jsonb,
  latest_invoice jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH filtered_jobs AS (
    SELECT
      j.id,
      j.wo_number,
      j.customer_name,
      j.job_type,
      j.other_classification,
      j.agreement_date,
      j.created_at,
      j.price,
      j.esign_status
    FROM jobs j
    WHERE j.user_id = p_user_id
      AND auth.uid() = p_user_id
      AND (
        p_job_ids IS NULL
        OR cardinality(p_job_ids) = 0
        OR j.id = ANY (p_job_ids)
      )
  )
  SELECT
    j.id,
    j.wo_number,
    j.customer_name,
    j.job_type,
    j.other_classification,
    j.agreement_date,
    j.created_at,
    j.price,
    j.esign_status,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', co.id,
          'job_id', co.job_id,
          'co_number', co.co_number,
          'esign_status', co.esign_status
        )
        ORDER BY co.co_number
      ) FILTER (WHERE co.id IS NOT NULL),
      '[]'::jsonb
    ) AS change_orders,
    inv.latest_invoice
  FROM filtered_jobs j
  LEFT JOIN change_orders co
    ON co.job_id = j.id
   AND co.user_id = p_user_id
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'id', i.id,
      'job_id', i.job_id,
      'status', i.status,
      'invoice_number', i.invoice_number,
      'created_at', i.created_at
    ) AS latest_invoice
    FROM invoices i
    WHERE i.user_id = p_user_id
      AND i.job_id = j.id
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(COALESCE(i.line_items, '[]'::jsonb)) = 'array'
              THEN COALESCE(i.line_items, '[]'::jsonb)
            ELSE '[]'::jsonb
          END
        ) AS elem
        WHERE COALESCE(elem->>'change_order_id', '') <> ''
      )
    ORDER BY i.created_at DESC
    LIMIT 1
  ) inv ON true
  GROUP BY
    j.id,
    j.wo_number,
    j.customer_name,
    j.job_type,
    j.other_classification,
    j.agreement_date,
    j.created_at,
    j.price,
    j.esign_status,
    inv.latest_invoice
  ORDER BY j.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_work_orders_dashboard(uuid, uuid[]) TO authenticated;
