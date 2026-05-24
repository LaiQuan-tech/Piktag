// send-chat-push edge function
//
// Deploy: cd mobile && supabase functions deploy send-chat-push
// Required secrets:
//   SUPABASE_URL (auto-provided)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided)
//
// Invocation:
// A DB trigger on piktag_messages AFTER INSERT calls this function via
// pg_net.http_post with:
//   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//   body: { "message_id": "<uuid>" }
//
// The function looks up the inserted message, resolves the recipient,
// fetches their Expo push token, and forwards a push via Expo's public
// push API (https://exp.host/--/api/v2/push/send).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_BODY_CHARS = 200;

type RequestBody = {
  message_id?: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  conversation: {
    participant_a: string;
    participant_b: string;
  } | null;
};

type ProfileRow = {
  id: string;
  push_token: string | null;
  full_name: string | null;
  username: string | null;
};

function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(500, {
        ok: false,
        error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
      });
    }

    // Authorization: we don't verify a user JWT (the DB trigger is not a
    // user). Instead we require the caller to present the service role key
    // as a bearer token. Only Postgres (which knows the key via vault) can
    // produce this, so it's a reasonable shared secret.
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
    const expected = `Bearer ${serviceRoleKey}`;
    if (!authHeader || !timingSafeEqual(authHeader, expected)) {
      return jsonResponse(401, { ok: false, error: 'Unauthorized' });
    }

    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { ok: false, error: 'Body must be valid JSON' });
    }

    const messageId = (body.message_id ?? '').trim();
    if (!messageId) {
      return jsonResponse(400, { ok: false, error: 'Missing message_id' });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Single round-trip to fetch the message + its conversation's participants.
    const { data: messageData, error: messageError } = await adminClient
      .from('piktag_messages')
      .select(
        'id, conversation_id, sender_id, body, conversation:piktag_conversations!inner(participant_a, participant_b)'
      )
      .eq('id', messageId)
      .maybeSingle<MessageRow>();

    if (messageError) {
      console.error('send-chat-push message lookup failed:', messageError);
      return jsonResponse(500, { ok: false, error: 'Message lookup failed' });
    }
    if (!messageData || !messageData.conversation) {
      return jsonResponse(404, { ok: false, error: 'Message not found' });
    }

    const { sender_id: senderId, conversation } = messageData;
    const recipientId =
      conversation.participant_a === senderId
        ? conversation.participant_b
        : conversation.participant_a;

    // Defensive: if the sender somehow is also the recipient, don't push.
    // Shouldn't happen given the conversation schema but cheap to guard.
    if (!recipientId || recipientId === senderId) {
      return jsonResponse(200, { ok: true, skipped: 'self' });
    }

    // Skip if either side has blocked the other. We check both directions
    // so neither blocker nor blockee receives notifications from each other.
    const { data: blockRows, error: blockError } = await adminClient
      .from('piktag_blocks')
      .select('blocker_id, blocked_id')
      .or(
        `and(blocker_id.eq.${senderId},blocked_id.eq.${recipientId}),` +
          `and(blocker_id.eq.${recipientId},blocked_id.eq.${senderId})`
      )
      .limit(1);

    if (blockError) {
      console.error('send-chat-push block lookup failed:', blockError);
      return jsonResponse(500, { ok: false, error: 'Block lookup failed' });
    }
    if (blockRows && blockRows.length > 0) {
      return jsonResponse(200, { ok: true, skipped: 'blocked' });
    }

    // Fetch both profiles in one query, then split by id.
    const { data: profiles, error: profilesError } = await adminClient
      .from('piktag_profiles')
      .select('id, push_token, full_name, username')
      .in('id', [senderId, recipientId])
      .returns<ProfileRow[]>();

    if (profilesError) {
      console.error('send-chat-push profile lookup failed:', profilesError);
      return jsonResponse(500, { ok: false, error: 'Profile lookup failed' });
    }

    const recipientProfile = profiles?.find((p) => p.id === recipientId) ?? null;
    const senderProfile = profiles?.find((p) => p.id === senderId) ?? null;

    const pushToken = recipientProfile?.push_token?.trim() ?? '';
    // Bail early if no token: Expo would reject an empty `to` anyway, and
    // this is the normal case for users who never granted push permission.
    if (!pushToken) {
      return jsonResponse(200, { ok: true, skipped: 'no_token' });
    }

    const senderDisplayName =
      (senderProfile?.full_name?.trim() || senderProfile?.username?.trim() || 'New message').slice(
        0,
        100
      );

    const rawBody = (messageData.body ?? '').trim();
    const truncatedBody =
      rawBody.length > MAX_BODY_CHARS ? `${rawBody.slice(0, MAX_BODY_CHARS - 1)}\u2026` : rawBody;

    const expoPayload = {
      to: pushToken,
      title: senderDisplayName,
      body: truncatedBody,
      data: {
        type: 'chat',
        conversationId: messageData.conversation_id,
        messageId: messageData.id,
      },
      sound: 'default',
      // Intentionally omit badge: the app computes its own unread badge
      // from local state; a server-set number would fight with that.
      badge: undefined,
      priority: 'high',
    };

    let ticket: unknown;
    try {
      const upstream = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(expoPayload),
      });

      const text = await upstream.text();
      try {
        ticket = JSON.parse(text);
      } catch {
        ticket = { raw: text.slice(0, 300) };
      }

      if (!upstream.ok) {
        console.error(
          `send-chat-push Expo responded ${upstream.status}:`,
          typeof ticket === 'string' ? ticket : JSON.stringify(ticket).slice(0, 300)
        );
        return jsonResponse(502, {
          ok: false,
          error: `Expo push failed with HTTP ${upstream.status}`,
        });
      }
    } catch (fetchErr) {
      console.error('send-chat-push Expo fetch threw:', fetchErr);
      return jsonResponse(502, { ok: false, error: 'Expo push request failed' });
    }

    return jsonResponse(200, { ok: true, ticket });
  } catch (err) {
    console.error('send-chat-push edge function error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(500, { ok: false, error: message });
  }
});
