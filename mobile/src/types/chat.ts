// Chat / DM types. Matches the piktag_conversations and piktag_messages
// tables in 20260421_chat_messaging.sql.

export type InboxTab = 'primary' | 'requests' | 'general';

export type ConversationRaw = {
  id: string;
  participant_a: string;
  participant_b: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender_id: string | null;
  a_last_read_at: string;
  b_last_read_at: string;
  initiated_by: string;
  created_at: string;
};

// Denormalized row used in the inbox list: we attach the other
// participant's profile so a single query renders everything the row
// needs. `unread_count` is computed client-side from last_message_at
// vs the viewer's own read cursor.
export type InboxConversation = {
  id: string;
  other_user_id: string;
  other_username: string | null;
  other_full_name: string | null;
  other_avatar_url: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender_id: string | null;
  last_read_at: string;
  initiated_by: string;
  is_connection: boolean;
  i_have_replied: boolean;
  unread: boolean;
  // Per-viewer manual folder pin. NULL → fall back to the computed
  // bucket (is_connection → primary, unreplied incoming → requests,
  // else general). Set via the set_conversation_folder RPC when the
  // user taps the ⋯ menu on a row and picks "Move to …".
  folder_override: InboxTab | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  client_nonce: string | null;
};

// Client-side representation for optimistic UI. A message is in one of
// three states while being sent; on failure it stays in the thread as
// 'failed' with a retry affordance.
export type MessageStatus = 'sent' | 'sending' | 'failed';

export type ThreadMessage = Message & {
  status: MessageStatus;
};

export type ChatUnreadSummary = {
  total: number;
  primary: number;
  requests: number;
  general: number;
};
