-- Case-insensitive client dedup: lookup key separate from display name.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS name_normalized text;

UPDATE clients
SET name_normalized = lower(trim(name))
WHERE name_normalized IS NULL AND name IS NOT NULL;

-- Backfill any edge case
UPDATE clients SET name_normalized = lower(trim(coalesce(name, '')))
WHERE name_normalized IS NULL;

ALTER TABLE clients
  ALTER COLUMN name_normalized SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_user_id_name_normalized
  ON clients (user_id, name_normalized);
