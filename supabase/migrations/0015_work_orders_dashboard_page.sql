CREATE OR REPLACE FUNCTION public.list_work_orders_dashboard_page(
  p_user_id uuid,
  p_limit integer,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
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
  change_order_count integer,
  change_orders_preview jsonb,
  has_in_flight_change_orders boolean,
  latest_invoice jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH page_jobs AS (
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
        p_cursor_created_at IS NULL
        OR j.created_at < p_cursor_created_at
        OR (
          j.created_at = p_cursor_created_at
          AND p_cursor_id IS NOT NULL
          AND j.id < p_cursor_id
        )
      )
    ORDER BY j.created_at DESC, j.id DESC
    LIMIT GREATEST(p_limit, 1)
  ),
  page_change_orders AS (
    SELECT
      co.id,
      co.job_id,
      co.co_number,
      co.esign_status
    FROM change_orders co
    INNER JOIN page_jobs j
      ON j.id = co.job_id
    WHERE co.user_id = p_user_id
  ),
  ranked_change_orders AS (
    SELECT
      co.id,
      co.job_id,
      co.co_number,
      co.esign_status,
      row_number() OVER (PARTITION BY co.job_id ORDER BY co.co_number ASC) AS preview_rank
    FROM page_change_orders co
  ),
  change_order_rollups AS (
    SELECT
      co.job_id,
      COUNT(*)::integer AS change_order_count,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', co.id,
            'job_id', co.job_id,
            'co_number', co.co_number,
            'esign_status', co.esign_status
          )
          ORDER BY co.co_number
        ) FILTER (WHERE co.preview_rank <= 2),
        '[]'::jsonb
      ) AS change_orders_preview,
      COALESCE(bool_or(co.esign_status IN ('sent', 'opened')), false) AS has_in_flight_change_orders
    FROM ranked_change_orders co
    GROUP BY co.job_id
  ),
  page_job_level_invoices AS (
    SELECT
      i.id,
      i.job_id,
      i.status,
      i.invoice_number,
      i.created_at
    FROM invoices i
    INNER JOIN page_jobs j
      ON j.id = i.job_id
    WHERE i.user_id = p_user_id
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
  ),
  latest_job_level_invoices AS (
    SELECT DISTINCT ON (i.job_id)
      i.job_id,
      jsonb_build_object(
        'id', i.id,
        'job_id', i.job_id,
        'status', i.status,
        'invoice_number', i.invoice_number,
        'created_at', i.created_at
      ) AS latest_invoice
    FROM page_job_level_invoices i
    ORDER BY i.job_id, i.created_at DESC, i.id DESC
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
    COALESCE(c.change_order_count, 0) AS change_order_count,
    COALESCE(c.change_orders_preview, '[]'::jsonb) AS change_orders_preview,
    COALESCE(c.has_in_flight_change_orders, false) AS has_in_flight_change_orders,
    l.latest_invoice
  FROM page_jobs j
  LEFT JOIN change_order_rollups c
    ON c.job_id = j.id
  LEFT JOIN latest_job_level_invoices l
    ON l.job_id = j.id
  ORDER BY j.created_at DESC, j.id DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_work_orders_dashboard_page(uuid, integer, timestamptz, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_work_orders_dashboard_summary(
  p_user_id uuid
)
RETURNS TABLE (
  job_count bigint,
  invoiced_contract_total numeric,
  pending_contract_total numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH user_jobs AS (
    SELECT
      j.id,
      j.price
    FROM jobs j
    WHERE j.user_id = p_user_id
      AND auth.uid() = p_user_id
  ),
  user_job_level_invoices AS (
    SELECT
      i.id,
      i.job_id,
      i.status,
      i.created_at
    FROM invoices i
    INNER JOIN user_jobs j
      ON j.id = i.job_id
    WHERE i.user_id = p_user_id
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
  ),
  latest_job_level_invoices AS (
    SELECT DISTINCT ON (i.job_id)
      i.job_id,
      i.status
    FROM user_job_level_invoices i
    ORDER BY i.job_id, i.created_at DESC, i.id DESC
  )
  SELECT
    COUNT(*)::bigint AS job_count,
    COALESCE(
      SUM(
        CASE
          WHEN l.status = 'downloaded' THEN j.price
          ELSE 0
        END
      ),
      0
    ) AS invoiced_contract_total,
    COALESCE(
      SUM(
        CASE
          WHEN l.status IS NULL OR l.status = 'draft' THEN j.price
          ELSE 0
        END
      ),
      0
    ) AS pending_contract_total
  FROM user_jobs j
  LEFT JOIN latest_job_level_invoices l
    ON l.job_id = j.id;
$$;

GRANT EXECUTE ON FUNCTION public.get_work_orders_dashboard_summary(uuid) TO authenticated;
