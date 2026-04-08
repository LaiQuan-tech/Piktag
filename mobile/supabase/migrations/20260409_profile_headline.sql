-- Add headline field to profiles (e.g. "PM @ Google", "自由接案設計師")
ALTER TABLE piktag_profiles ADD COLUMN IF NOT EXISTS headline text;
