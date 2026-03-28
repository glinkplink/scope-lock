CREATE INDEX IF NOT EXISTS idx_jobs_inflight_esign_by_user_created_at
  ON jobs (user_id, created_at DESC)
  WHERE esign_status IN ('sent', 'opened');
