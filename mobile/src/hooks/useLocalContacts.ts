// useLocalContacts.ts
//
// Read/write surface for piktag_local_contacts — the user's CRM-style
// address book of people they've tagged but who haven't registered
// PikTag yet. Encapsulates the fetch + add + update + delete cycle so
// LocalContactsScreen and ContactSyncScreen don't each duplicate the
// supabase glue.
//
// Promotion (when a tagged contact later signs up) is handled
// server-side by the AFTER INSERT trigger on piktag_profiles defined
// in 20260507120000_local_contacts.sql — the client just creates
// rows, the server handles the rest.

import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { ensureTagsRegistered } from '../lib/ensureTags';
import { CACHE_KEYS, getPersistentCache, setPersistentCache } from '../lib/dataCache';
import { checkOffline } from '../lib/netStatus';
import { useAuth } from './useAuth';

// Rows kept on disk. A user with more than 500 un-promoted contacts is
// not scrolling past 500 with no signal, and the list is ordered newest
// first, so the cap keeps exactly the cards they just scanned.
const LOCAL_CONTACTS_CACHE_MAX = 500;

export type LocalContact = {
  id: string;
  owner_user_id: string;
  phone_normalized: string | null;
  // Mobile/cell number, separate from the landline in phone_normalized
  // (migration 20260712000000_local_contact_mobile_phone.sql). A card
  // scan can carry both — the promotion trigger matches phone OR
  // mobile OR email, so this is a full third match arm, not cosmetic.
  mobile_normalized: string | null;
  email_lower: string | null;
  name: string;
  avatar_url: string | null;
  met_at: string | null;
  met_location: string | null;
  // `headline` mirrors piktag_profiles.headline (職稱) so the
  // local-contact format maps 1:1 to the member format on fusion.
  // `note` is legacy free text kept only for backward-compatible
  // reads (no longer written by the editor).
  headline: string | null;
  note: string | null;
  birthday: string | null;
  // Mailing/office address — populated by the card-scan flow
  // (scan-business-card edge fn extracts it alongside name/phone/
  // email/job_title) or by manual entry. Migration:
  // 20260523000000_local_contact_address.sql.
  address: string | null;
  // Website (company URL / personal site / portfolio / Calendly / …).
  // The scan-business-card edge fn already extracted this; until
  // 20260526000000_local_contact_website.sql there was no column to
  // store it so the value was silently dropped. Now it's persisted
  // and surfaced as a tappable linkCard on the contact detail.
  website: string | null;
  tags: string[];
  // When the owner last sent their contact card to this person (寄我的
  // 聯絡資料, backlog #3). Drives the 已寄出 CTA state; 7-day re-send.
  intro_sent_at: string | null;
  promoted_to_connection_id: string | null;
  promoted_at: string | null;
  created_at: string;
};

export type AddLocalContactInput = {
  name: string;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  tags?: string[];
  avatar_url?: string | null;
  met_at?: string | null;
  met_location?: string | null;
  headline?: string | null;
  note?: string | null;
  birthday?: string | null;
  address?: string | null;
  website?: string | null;
  // How this contact was created, stamped by the calling screen so the
  // admin dashboard can count card-scan-originated contacts precisely.
  // card_scan (掃名片) / manual (手動新增) / import (匯入通訊錄).
  source?: 'card_scan' | 'manual' | 'import';
};

/**
 * Best-effort phone normalization. Strips spaces / dashes / parens
 * and prepends "+" if a country prefix is missing on a digits-only
 * input. Not a full libphonenumber pass — that's overkill for this
 * use case where we just need consistent dedupe keys, not perfectly
 * E.164. The promotion trigger does an exact-match comparison, so
 * "+886912345678" must come out the same on both sides; both the
 * sender and the eventual registrant will be normalized through
 * this same function.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.replace(/[\s\-().]/g, '');
  if (!trimmed) return null;
  // If it already starts with +, keep as-is. If it starts with 00,
  // strip + (international dialing prefix). If it's just digits and
  // looks like a Taiwan-local number (starts with 09, 8-10 digits),
  // best-effort prepend +886. Otherwise leave as-is.
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('00')) return '+' + trimmed.slice(2);
  if (/^09\d{8}$/.test(trimmed)) return '+886' + trimmed.slice(1);
  return trimmed;
}

export function useLocalContacts() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [contacts, setContacts] = useState<LocalContact[]>([]);
  const [loading, setLoading] = useState(false);
  // Set the first time the server answers for this account. The disk
  // hydration below refuses to paint after that, so a slow AsyncStorage
  // read can never overwrite fresher server rows.
  const liveFetchDoneRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId) return;
    // ── No signal ────────────────────────────────────────────────────
    // These are SERVER rows with (until now) no snapshot, so at an event
    // with no signal every business card the user had scanned simply
    // disappeared from the friends list — the core product moment. The
    // hydration effect below has already painted the cached copy;
    // returning here writes NOTHING, so the snapshot is untouched.
    if (await checkOffline()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('piktag_local_contacts')
        .select('*')
        // Only un-promoted rows surface here; once a contact registers
        // and the trigger fires, they appear in piktag_connections
        // and are no longer "local". Filtering at the SQL level keeps
        // the list tight without any client-side post-filtering.
        .is('promoted_to_connection_id', null)
        .order('created_at', { ascending: false });
      // `!error && data` is the whole guarantee. supabase-js RESOLVES
      // with { data: null, error } when the request never left the
      // phone, so this is also the transport-failure branch: we neither
      // blank the list nor write the snapshot. A user who genuinely has
      // no contacts still refreshes normally — an empty ARRAY with no
      // error is a real answer and is written as one.
      if (!error && data) {
        const rows = data as LocalContact[];
        liveFetchDoneRef.current = true;
        setContacts(rows);
        void setPersistentCache(
          CACHE_KEYS.LOCAL_CONTACTS,
          userId,
          rows.slice(0, LOCAL_CONTACTS_CACHE_MAX),
        );
      }
    } catch (err) {
      console.warn('[useLocalContacts] refresh failed:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Stale-while-revalidate, disk layer. Paints the last known contacts
  // immediately so the list is not empty at a venue, then `refresh`
  // overwrites it when the network answers.
  //
  // Only `refresh` writes the snapshot, deliberately: add/update/remove
  // below mutate this instance's `contacts`, and several screens mount
  // their own copy of this hook whose list may never have loaded. One of
  // those writing its near-empty state back would be precisely the
  // "a failed fetch degrades a good snapshot" bug. They only ever run
  // online anyway, so the next refresh records them.
  useEffect(() => {
    liveFetchDoneRef.current = false;
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const cached = await getPersistentCache<LocalContact[]>(
        CACHE_KEYS.LOCAL_CONTACTS,
        userId,
      );
      if (cancelled || liveFetchDoneRef.current) return;
      if (!Array.isArray(cached) || cached.length === 0) return;
      // Never clobber rows that already landed from the network.
      setContacts((prev) => (prev.length > 0 ? prev : cached));
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(
    async (input: AddLocalContactInput): Promise<LocalContact | null> => {
      if (!user) return null;
      const phone = normalizePhone(input.phone || null);
      const mobile = normalizePhone(input.mobile || null);
      const email = input.email ? input.email.trim().toLowerCase() : null;
      try {
        const { data, error } = await supabase
          .from('piktag_local_contacts')
          .insert({
            owner_user_id: user.id,
            name: input.name.trim(),
            phone_normalized: phone,
            mobile_normalized: mobile,
            email_lower: email,
            tags: input.tags ?? [],
            avatar_url: input.avatar_url ?? null,
            met_at: input.met_at ?? null,
            met_location: input.met_location ?? null,
            headline: input.headline ?? null,
            note: input.note ?? null,
            birthday: input.birthday ?? null,
            address: input.address ?? null,
            website: input.website ?? null,
            source: input.source ?? null,
          })
          .select()
          .single();
        if (error || !data) {
          console.warn('[useLocalContacts] add error:', error?.message);
          return null;
        }
        setContacts((prev) => [data as LocalContact, ...prev]);
        // Register the contact's tags in the global tag registry so the
        // concept linker can semantic-link them (text[] tags have no FK,
        // so nothing else would). Fire-and-forget — best-effort.
        if (input.tags && input.tags.length > 0) {
          void ensureTagsRegistered(input.tags);
        }
        return data as LocalContact;
      } catch (err) {
        console.warn('[useLocalContacts] add exception:', err);
        return null;
      }
    },
    [user],
  );

  const update = useCallback(
    async (id: string, patch: Partial<LocalContact>): Promise<boolean> => {
      try {
        const { data, error } = await supabase
          .from('piktag_local_contacts')
          .update(patch)
          .eq('id', id)
          .select()
          .single();
        if (error || !data) return false;
        setContacts((prev) =>
          prev.map((c) => (c.id === id ? (data as LocalContact) : c)),
        );
        // Keep contact tags in the global registry so they get
        // concept-linked (see add()). Fire-and-forget — best-effort.
        if (patch.tags && patch.tags.length > 0) {
          void ensureTagsRegistered(patch.tags);
        }
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('piktag_local_contacts')
        .delete()
        .eq('id', id);
      if (error) return false;
      setContacts((prev) => prev.filter((c) => c.id !== id));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { contacts, loading, refresh, add, update, remove };
}
