export type AskFeedItem = {
  ask_id: string;
  author_id: string;
  author_username: string | null;
  author_full_name: string | null;
  author_avatar_url: string | null;
  body: string;
  title: string | null;
  expires_at: string;
  created_at: string;
  ask_tag_names: string[];
  degree: 1 | 2;
  mutual_friend_count: number;
  mutual_friend_previews: Array<{
    id: string;
    full_name: string | null;
    avatar_url: string | null;
  }>;
};

export type MyActiveAsk = {
  id: string;
  body: string;
  title: string | null;
  expires_at: string;
  created_at: string;
  tag_names: string[];
};
