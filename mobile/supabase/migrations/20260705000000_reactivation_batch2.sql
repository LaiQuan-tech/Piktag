-- 20260705000000_reactivation_batch2.sql
-- =============================================================================
-- Reactivation backlog #2 + #3 (founder-approved list, executed 2026-07-05
-- post-iOS-launch — everything additive/backward-compatible with the live
-- build).
--
-- #2 contact_joined: promote_local_contacts_for_profile now tells the OWNER
--    the story ("the contact you saved just joined — connected, tags kept").
--    The generic 'friend' row stays for old builds, stamped source='promote'
--    so new builds hide it (no duplicate). 4-point checklist: category map
--    updated here; client filter/KNOWN/i18n ship in the same commit.
-- #3 intro_sent_at on piktag_local_contacts: "已寄出" state for the
--    寄我的聯絡資料 CTA (re-send allowed after 7 days un-joined).
--
-- Idempotent (CREATE OR REPLACE / IF NOT EXISTS).
-- =============================================================================

alter table public.piktag_local_contacts
  add column if not exists intro_sent_at timestamptz;

comment on column public.piktag_local_contacts.intro_sent_at is
  'When the owner last sent their contact card to this person (寄我的聯絡資料). Drives the 已寄出 state; re-send unlocks after 7 days while un-promoted.';

CREATE OR REPLACE FUNCTION public.is_notification_category_enabled(
  p_user_id uuid,
  p_type    text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category text;
  v_enabled  boolean;
BEGIN
  -- Map type → category column. Unknown types are allowed through
  -- (covers admin / system / future notification kinds that haven't
  -- been categorized yet — fail-open by design so a missing case
  -- never silently swallows a real notification).
  v_category := CASE p_type
    WHEN 'follow'              THEN 'notif_social'
    WHEN 'friend'              THEN 'notif_social'
    WHEN 'tag_added'           THEN 'notif_social'
    WHEN 'biolink_click'       THEN 'notif_social'
    WHEN 'invite_accepted'     THEN 'notif_social'
    WHEN 'vibe_shift'          THEN 'notif_social'
    WHEN 'ask_posted'          THEN 'notif_social'
    WHEN 'tag_trending'        THEN 'notif_social'
    WHEN 'contact_sync_nudge'  THEN 'notif_social'
    WHEN 'contact_joined'      THEN 'notif_social'
    WHEN 'recommendation'      THEN 'notif_matches'
    WHEN 'tag_convergence'     THEN 'notif_matches'
    WHEN 'ask_bridge'          THEN 'notif_matches'
    WHEN 'reconnect_suggest'   THEN 'notif_matches'
    WHEN 'tag_combo'           THEN 'notif_matches'
    WHEN 'birthday'            THEN 'notif_memories'
    WHEN 'anniversary'         THEN 'notif_memories'
    WHEN 'on_this_day'         THEN 'notif_memories'
    WHEN 'ask_prompt'          THEN 'notif_memories'
    WHEN 'endorsement_request' THEN 'notif_memories'
    WHEN 'tag_suggest_nudge'   THEN 'notif_memories'
    ELSE NULL
  END;

  IF v_category IS NULL THEN
    RETURN true;
  END IF;

  -- Dynamic column read. COALESCE(..., true) so existing profile
  -- rows that pre-date this migration (column literally not yet
  -- populated for them) default to opted-in.
  EXECUTE format(
    'SELECT COALESCE(%I, true) FROM public.piktag_profiles WHERE id = $1',
    v_category
  ) INTO v_enabled USING p_user_id;

  RETURN COALESCE(v_enabled, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_local_contacts_for_profile(
  p_user_id uuid,
  p_phone text,
  p_email text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_norm text := nullif(trim(p_phone), '');
  v_email_lower text := nullif(lower(trim(p_email)), '');
  v_local_contact record;
  v_conn_id uuid;
  v_tag_name text;
  v_tag_id uuid;
  v_promoted_count integer := 0;
  v_new_username text;
  v_new_fullname text;
  v_new_avatar text;
  v_notif_body text;
BEGIN
  IF v_phone_norm IS NULL AND v_email_lower IS NULL THEN
    RETURN 0;
  END IF;

  -- The new member's public identity, for the contact_joined story rows.
  SELECT username, full_name, avatar_url
    INTO v_new_username, v_new_fullname, v_new_avatar
    FROM piktag_profiles WHERE id = p_user_id;

  FOR v_local_contact IN
    SELECT *
    FROM piktag_local_contacts
    WHERE promoted_to_connection_id IS NULL
      AND owner_user_id <> p_user_id
      AND (
        (v_phone_norm IS NOT NULL AND phone_normalized = v_phone_norm)
        OR (v_email_lower IS NOT NULL AND email_lower = v_email_lower)
      )
    ORDER BY id              -- deterministic, resumable batching
    LIMIT 200                -- catastrophe cap (see header)
  LOOP
    SELECT id INTO v_conn_id
      FROM piktag_connections
     WHERE user_id = v_local_contact.owner_user_id
       AND connected_user_id = p_user_id
     LIMIT 1;

    IF v_conn_id IS NULL THEN
      INSERT INTO piktag_connections (
        user_id,
        connected_user_id,
        met_at,
        met_location,
        note,
        nickname,
        birthday,
        is_reviewed
      ) VALUES (
        v_local_contact.owner_user_id,
        p_user_id,
        COALESCE(v_local_contact.met_at, now()),
        v_local_contact.met_location,
        -- Structured headline carries onto fusion as owner-private
        -- context; legacy free-text note (if any) wins when present.
        COALESCE(NULLIF(v_local_contact.note, ''), v_local_contact.headline),
        v_local_contact.name,
        v_local_contact.birthday,
        false
      )
      RETURNING id INTO v_conn_id;

      INSERT INTO piktag_connections (
        user_id, connected_user_id, met_at, is_reviewed
      ) VALUES (
        p_user_id, v_local_contact.owner_user_id, now(), false
      )
      ON CONFLICT (user_id, connected_user_id) DO NOTHING;
    END IF;

    -- ── also create the piktag_follows row so the promoted
    -- ── connection actually shows up on the owner's home list.
    -- ── ConnectionsScreen filters `connections ∩ follows`; without
    -- ── this insert the promoted user is invisible there.
    INSERT INTO piktag_follows (follower_id, following_id)
    VALUES (v_local_contact.owner_user_id, p_user_id)
    ON CONFLICT (follower_id, following_id) DO NOTHING;

    -- Transfer tags from the array into proper piktag_tags +
    -- piktag_connection_tags rows. Each tag name is normalized
    -- (strip leading #, trim) before lookup/insert.
    IF array_length(v_local_contact.tags, 1) IS NOT NULL THEN
      FOREACH v_tag_name IN ARRAY v_local_contact.tags
      LOOP
        v_tag_name := trim(both '#' from trim(v_tag_name));
        IF v_tag_name = '' THEN CONTINUE; END IF;

        SELECT id INTO v_tag_id FROM piktag_tags WHERE name = v_tag_name LIMIT 1;
        IF v_tag_id IS NULL THEN
          BEGIN
            INSERT INTO piktag_tags (name) VALUES (v_tag_name)
            RETURNING id INTO v_tag_id;
          EXCEPTION WHEN unique_violation THEN
            SELECT id INTO v_tag_id FROM piktag_tags WHERE name = v_tag_name LIMIT 1;
          END;
        END IF;

        IF v_tag_id IS NOT NULL THEN
          INSERT INTO piktag_connection_tags (connection_id, tag_id, is_private)
          VALUES (v_conn_id, v_tag_id, true)
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;

    UPDATE piktag_local_contacts
       SET promoted_to_connection_id = v_conn_id,
           promoted_at = now()
     WHERE id = v_local_contact.id;


    -- ── backlog #2 (2026-07-05): the owner's magic-moment story ──────
    -- trg_notify_friend already inserted a GENERIC 'friend' row when we
    -- created the owner-side connection above. Old builds only know that
    -- type, so we KEEP it — but stamp it source='promote' so new builds
    -- can hide it and render only the dedicated row below. No separate
    -- push either: the generic friend push already hit the lock screen;
    -- a second one would double-notify.
    UPDATE piktag_notifications
       SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('source', 'promote')
     WHERE user_id = v_local_contact.owner_user_id
       AND type = 'friend'
       AND data->>'friend_user_id' = p_user_id::text
       AND created_at > now() - interval '2 minutes';

    IF public.is_notification_category_enabled(v_local_contact.owner_user_id, 'contact_joined') THEN
      -- Non-empty SQL body (CLAUDE.md rule) — the client's i18n template
      -- enriches it; this English fallback is what legacy renderers show.
      v_notif_body := COALESCE(NULLIF(v_local_contact.name, ''), COALESCE(v_new_fullname, 'Someone'))
        || ' just joined PikTag - you saved them as a contact. You are already connected and your tags carried over.';
      INSERT INTO piktag_notifications (user_id, type, title, body, data)
      VALUES (
        v_local_contact.owner_user_id,
        'contact_joined',
        '',
        v_notif_body,
        jsonb_build_object(
          'actor_user_id',  p_user_id,
          'friend_user_id', p_user_id,
          'connection_id',  v_conn_id,
          'username',       COALESCE(v_new_username, v_new_fullname, ''),
          'avatar_url',     v_new_avatar,
          'saved_name',     v_local_contact.name,
          'saved_at',       v_local_contact.created_at,
          'tag_names',      to_jsonb(COALESCE(v_local_contact.tags, '{}'::text[])),
          'source',         'promote'
        )
      );
    END IF;

    v_promoted_count := v_promoted_count + 1;
  END LOOP;

  RETURN v_promoted_count;
END;
$$;
