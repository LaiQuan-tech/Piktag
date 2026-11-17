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

// recordAskResponse removed 2026-11-18 with the Ask UI (its only callers
// were AskStoryRow and ConnectionsScreen's Ask rail). The
// record_ask_response RPC and piktag_ask_responses table stay server-side
// for older app versions.
