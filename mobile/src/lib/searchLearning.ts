import { supabase } from './supabase';

export async function recordSearchLearning(params: {
  query: string;
  extractedKeyword: string;
  clickedTagId?: string;
  clickedUserId: string;
  searcherId: string;
}): Promise<void> {
  try {
    await supabase.from('piktag_search_learnings').insert({
      query: params.query.slice(0, 200),
      extracted_keyword: params.extractedKeyword.slice(0, 100),
      clicked_tag_id: params.clickedTagId || null,
      clicked_user_id: params.clickedUserId,
      searcher_id: params.searcherId,
    });
  } catch {
    // Non-blocking — learning is best-effort
  }
}

export async function recordAskResponse(params: {
  askId: string;
  authorId: string;
  action: 'view' | 'follow' | 'chat' | 'connect';
}): Promise<void> {
  try {
    await supabase.rpc('record_ask_response', {
      p_ask_id: params.askId,
      p_author_id: params.authorId,
      p_action: params.action,
    });
  } catch {
    // Non-blocking — tracking is best-effort
  }
}
