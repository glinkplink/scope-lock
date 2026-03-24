-- Normalize legacy CashApp labels to Cash App in stored payment method arrays.

UPDATE business_profiles
SET default_payment_methods = COALESCE(
  (
    SELECT array_agg(method ORDER BY first_position)
    FROM (
      SELECT normalized_method AS method, MIN(position) AS first_position
      FROM (
        SELECT
          CASE
            WHEN btrim(method) = 'CashApp' THEN 'Cash App'
            ELSE btrim(method)
          END AS normalized_method,
          position
        FROM unnest(default_payment_methods) WITH ORDINALITY AS pm(method, position)
      ) normalized
      WHERE normalized_method <> ''
      GROUP BY normalized_method
    ) deduped
  ),
  '{}'::text[]
)
WHERE EXISTS (
  SELECT 1
  FROM unnest(default_payment_methods) AS pm(method)
  WHERE btrim(method) = 'CashApp'
);

UPDATE invoices
SET payment_methods = COALESCE(
  (
    SELECT jsonb_agg(method ORDER BY first_position)
    FROM (
      SELECT normalized_method AS method, MIN(position) AS first_position
      FROM (
        SELECT
          CASE
            WHEN btrim(value) = 'CashApp' THEN 'Cash App'
            ELSE btrim(value)
          END AS normalized_method,
          position
        FROM jsonb_array_elements_text(payment_methods) WITH ORDINALITY AS pm(value, position)
      ) normalized
      WHERE normalized_method <> ''
      GROUP BY normalized_method
    ) deduped
  ),
  '[]'::jsonb
)
WHERE payment_methods @> '["CashApp"]'::jsonb;
