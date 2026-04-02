-- Add push_token to profiles for push notifications
ALTER TABLE piktag_profiles
  ADD COLUMN IF NOT EXISTS push_token text;
