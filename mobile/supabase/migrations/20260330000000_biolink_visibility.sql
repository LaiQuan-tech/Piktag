-- Biolink visibility: public, friends, close_friends, private
ALTER TABLE piktag_biolinks ADD COLUMN IF NOT EXISTS visibility text DEFAULT 'public';

-- Close friends relationship table
CREATE TABLE IF NOT EXISTS piktag_close_friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  close_friend_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, close_friend_id)
);

CREATE INDEX IF NOT EXISTS idx_close_friends_user ON piktag_close_friends(user_id);
ALTER TABLE piktag_close_friends ENABLE ROW LEVEL SECURITY;
