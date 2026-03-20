-- Redundant with jobs.job_type (canonical); app writes job_type only
ALTER TABLE jobs DROP COLUMN IF EXISTS job_classification;
