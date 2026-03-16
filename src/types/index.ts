// PikTag Types - aligned with Supabase DB schema

export type PiktagProfile = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  website: string | null;
  location: string | null;
  language: string;
  is_verified: boolean;
  is_public: boolean;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
};

export type Tag = {
  id: string;
  name: string;
  category: string | null;
  usage_count: number;
  created_at: string;
};

export type UserTag = {
  id: string;
  user_id: string;
  tag_id: string;
  position: number;
  created_at: string;
  tag?: Tag; // joined
};

export type Follow = {
  id: string;
  follower_id: string;
  following_id: string;
  created_at: string;
  follower?: PiktagProfile; // joined
  following?: PiktagProfile; // joined
};

export type Connection = {
  id: string;
  user_id: string;
  connected_user_id: string;
  nickname: string | null;
  note: string | null;
  met_at: string | null;
  met_location: string | null;
  birthday: string | null;
  anniversary: string | null;
  contract_expiry: string | null;
  created_at: string;
  updated_at?: string;
  connected_user?: PiktagProfile; // joined
};

export type ConnectionTag = {
  id: string;
  connection_id: string;
  tag_id: string;
  created_at: string;
  tag?: Tag; // joined
};

export type Biolink = {
  id: string;
  user_id: string;
  platform: string;
  url: string;
  label: string | null;
  position: number;
  is_active: boolean;
  created_at: string;
};

export type Note = {
  id: string;
  user_id: string;
  target_user_id: string;
  content: string;
  color: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  target_user?: PiktagProfile; // joined
};

export type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, any> | null;
  is_read: boolean;
  created_at: string;
};

export type BiolinkClick = {
  id: string;
  biolink_id: string;
  clicker_user_id: string;
  created_at: string;
};

export type TagSnapshot = {
  id: string;
  tag_id: string;
  usage_count: number;
  snapshot_date: string;
  created_at: string;
};
