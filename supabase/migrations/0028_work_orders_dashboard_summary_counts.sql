-- Extend dashboard summary with signed/completed work-order counts.
-- Completed means the latest standard job-level invoice is fully settled
-- (`payment_status` = `paid` or `offline`); legacy CO-only invoices remain excluded.

DROP FUNCTION IF EXISTS public.get_work_orders_dashboard_summary(uuid);

CREATE FUNCTION public.get_work_orders_dashboard_summary(
  p_user_id uuid
)
RETURNS TABLE (
  job_count bigint,
  signed_job_count bigint,
  completed_job_count bigint,
  invoiced_contract_total numeric,
  pending_contract_total numeric,
  paid_contract_total numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH user_jobs AS (
    SELECT
      j.id,
      j.price,
      j.esign_status,
      j.offline_signed_at
    FROM jobs j
    WHERE j.user_id = p_user_id
      AND auth.uid() = p_user_id
  ),
  user_job_level_invoices AS (
    SELECT
      i.id,
      i.job_id,
      i.issued_at,
      i.payment_status,
      i.created_at
    FROM invoices i
    INNER JOIN user_jobs j
      ON j.id = i.job_id
    WHERE i.user_id = p_user_id
      AND public.is_job_level_invoice_line_items(i.line_items)
  ),
  latest_job_level_invoices AS (
    SELECT DISTINCT ON (i.job_id)
      i.job_id,
      i.issued_at,
      i.payment_status
    FROM user_job_level_invoices i
    ORDER BY i.job_id, i.created_at DESC, i.id DESC
  )
  SELECT
    COUNT(*)::bigint AS job_count,
    COUNT(*) FILTER (
      WHERE j.esign_status = 'completed' OR j.offline_signed_at IS NOT NULL
    )::bigint AS signed_job_count,
    COUNT(*) FILTER (
      WHERE COALESCE(l.payment_status, 'unpaid') IN ('paid', 'offline')
    )::bigint AS completed_job_count,
    COALESCE(
      SUM(
        CASE
          WHEN l.issued_at IS NOT NULL
            AND COALESCE(l.payment_status, 'unpaid') NOT IN ('paid', 'offline')
            THEN j.price
          ELSE 0
        END
      ),
      0
    ) AS invoiced_contract_total,
    COALESCE(
      SUM(
        CASE
          WHEN l.issued_at IS NULL THEN j.price
          ELSE 0
        END
      ),
      0
    ) AS pending_contract_total,
    COALESCE(
      SUM(
        CASE
          WHEN COALESCE(l.payment_status, 'unpaid') IN ('paid', 'offline') THEN j.price
          ELSE 0
        END
      ),
      0
    ) AS paid_contract_total
  FROM user_jobs j
  LEFT JOIN latest_job_level_invoices l
    ON l.job_id = j.id;
$$;

GRANT EXECUTE ON FUNCTION public.get_work_orders_dashboard_summary(uuid) TO authenticated;
