-- Add share_location toggle to profiles (default true)
ALTER TABLE piktag_profiles
  ADD COLUMN IF NOT EXISTS share_location boolean NOT NULL DEFAULT true;
