// PikTag Types - aligned with Supabase DB schema

// Semantic Tag Types — applying Semantic HTML concepts to people
export type SemanticType = 'identity' | 'skill' | 'interest' | 'social' | 'meta' | 'relation';

export const SEMANTIC_TYPE_ORDER: SemanticType[] = ['identity', 'skill', 'interest', 'social', 'meta', 'relation'];

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

export type TagConcept = {
  id: string;
  canonical_name: string;
  semantic_type: SemanticType | null;
  embedding: number[] | null;
  usage_count: number;
  created_at: string;
};

export type TagAlias = {
  id: string;
  alias: string;
  concept_id: string;
  language: string;
  created_at: string;
  concept?: TagConcept; // joined
};

export type Tag = {
  id: string;
  name: string;
  semantic_type: SemanticType | null;
  parent_tag_id: string | null;
  aliases: string[];
  concept_id: string | null;
  usage_count: number;
  created_at: string;
  concept?: TagConcept; // joined
};

export type UserTag = {
  id: string;
  user_id: string;
  tag_id: string;
  position: number;
  weight: number;
  semantic_type: SemanticType | null;
  is_private?: boolean;
  is_pinned?: boolean;
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
  scan_session_id: string | null;
  created_at: string;
  updated_at?: string;
  connected_user?: PiktagProfile; // joined
};

export type ConnectionTag = {
  id: string;
  connection_id: string;
  tag_id: string;
  semantic_type: SemanticType | null;
  created_at: string;
  tag?: Tag; // joined
};

export type BiolinkDisplayMode = 'icon' | 'card';

export type Biolink = {
  id: string;
  user_id: string;
  platform: string;
  url: string;
  label: string | null;
  position: number;
  is_active: boolean;
  display_mode: BiolinkDisplayMode;
  icon_url?: string | null;
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

export type TagPreset = {
  id: string;
  user_id: string;
  name: string;
  location: string;
  tags: string[];
  created_at: string;
  last_used_at: string;
};

export type ScanSession = {
  id: string;
  host_user_id: string;
  preset_id: string | null;
  event_date: string;
  event_location: string;
  event_tags: string[];
  qr_code_data: string;
  scan_count: number;
  is_active: boolean;
  created_at: string;
  expires_at: string;
  host_user?: PiktagProfile; // joined
};

export interface UserStatus {
  id: string;
  user_id: string;
  text: string;
  created_at: string;
  expires_at: string;
}
