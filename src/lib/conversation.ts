import { supabase } from './supabase';

/**
 * Find an existing direct conversation between two users,
 * or create a new one if none exists.
 * Returns the conversation ID.
 */
export async function getOrCreateDirectConversation(
  currentUserId: string,
  otherUserId: string
): Promise<string> {
  // 1. Check if a direct conversation already exists between these two users.
  //    Find all conversations where the current user is a participant...
  const { data: myConversations, error: myError } = await supabase
    .from('piktag_conversation_participants')
    .select('conversation_id')
    .eq('user_id', currentUserId);

  if (myError) {
    throw new Error(`Failed to fetch user conversations: ${myError.message}`);
  }

  if (myConversations && myConversations.length > 0) {
    const myConvIds = myConversations.map((p) => p.conversation_id);

    // ...then check if the other user is also in any of those conversations
    // that are of type 'direct'
    for (const convId of myConvIds) {
      // Verify it's a direct conversation
      const { data: conv } = await supabase
        .from('piktag_conversations')
        .select('id, type')
        .eq('id', convId)
        .eq('type', 'direct')
        .single();

      if (!conv) continue;

      // Check if the other user is a participant
      const { data: otherParticipant } = await supabase
        .from('piktag_conversation_participants')
        .select('id')
        .eq('conversation_id', convId)
        .eq('user_id', otherUserId)
        .limit(1);

      if (otherParticipant && otherParticipant.length > 0) {
        // Found an existing direct conversation between these two users
        return convId;
      }
    }
  }

  // 2. No existing conversation found - create a new one
  const now = new Date().toISOString();

  const { data: newConversation, error: convError } = await supabase
    .from('piktag_conversations')
    .insert({
      type: 'direct',
      name: null,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (convError || !newConversation) {
    throw new Error(`Failed to create conversation: ${convError?.message}`);
  }

  // 3. Add both users as participants
  const { error: partError } = await supabase
    .from('piktag_conversation_participants')
    .insert([
      {
        conversation_id: newConversation.id,
        user_id: currentUserId,
        joined_at: now,
      },
      {
        conversation_id: newConversation.id,
        user_id: otherUserId,
        joined_at: now,
      },
    ]);

  if (partError) {
    // Attempt cleanup of the conversation we just created
    await supabase.from('piktag_conversations').delete().eq('id', newConversation.id);
    throw new Error(`Failed to add participants: ${partError.message}`);
  }

  return newConversation.id;
}
