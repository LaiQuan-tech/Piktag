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
  action: 'view' | 'follow' | 'chat' | 'connect' | 'recommend';
  recommendedUserId?: string;
}): Promise<'ok' | 'duplicate'> {
  // 'recommend' (answer-by-introduction, 20260706020000) is load-bearing,
  // not best-effort analytics: it writes WHO was recommended, and the
  // caller needs the duplicate signal to show "already recommended".
  // The record_ask_response RPC can't serve it — no recommended_user_id
  // parameter, and its ON CONFLICT DO NOTHING would swallow the
  // UNIQUE(ask_id, responder_id, action) violation — so this path
  // inserts directly (RLS: responder_id must equal auth.uid()).
  if (params.action === 'recommend') {
    const { data: authData } = await supabase.auth.getUser();
    const me = authData?.user?.id;
    if (!me) throw new Error('Not signed in');
    const { error } = await supabase.from('piktag_ask_responses').insert({
      ask_id: params.askId,
      responder_id: me,
      author_id: params.authorId,
      action: 'recommend',
      recommended_user_id: params.recommendedUserId ?? null,
    });
    if (error) {
      // Postgres 23505 (unique_violation → PostgREST 409): this
      // responder already recommended someone for this ask.
      if ((error as { code?: string }).code === '23505') return 'duplicate';
      throw error;
    }
    return 'ok';
  }

  try {
    await supabase.rpc('record_ask_response', {
      p_ask_id: params.askId,
      p_author_id: params.authorId,
      p_action: params.action,
    });
  } catch {
    // Non-blocking — tracking is best-effort
  }
  return 'ok';
}
