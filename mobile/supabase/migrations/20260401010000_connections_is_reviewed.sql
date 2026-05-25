-- Add is_reviewed column to mark connections that have been reviewed
ALTER TABLE piktag_connections
  ADD COLUMN IF NOT EXISTS is_reviewed boolean NOT NULL DEFAULT false;
