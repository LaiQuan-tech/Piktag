-- Add position column to piktag_connection_tags for tag ordering
ALTER TABLE piktag_connection_tags
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
