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

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export type LocalContact = {
  id: string;
  owner_user_id: string;
  phone_normalized: string | null;
  email_lower: string | null;
  name: string;
  avatar_url: string | null;
  met_at: string | null;
  met_location: string | null;
  note: string | null;
  birthday: string | null;
  tags: string[];
  promoted_to_connection_id: string | null;
  promoted_at: string | null;
  created_at: string;
};

export type AddLocalContactInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  tags?: string[];
  avatar_url?: string | null;
  met_at?: string | null;
  met_location?: string | null;
  note?: string | null;
  birthday?: string | null;
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
  const [contacts, setContacts] = useState<LocalContact[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
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
      if (!error && data) setContacts(data as LocalContact[]);
    } catch (err) {
      console.warn('[useLocalContacts] refresh failed:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(
    async (input: AddLocalContactInput): Promise<LocalContact | null> => {
      if (!user) return null;
      const phone = normalizePhone(input.phone || null);
      const email = input.email ? input.email.trim().toLowerCase() : null;
      try {
        const { data, error } = await supabase
          .from('piktag_local_contacts')
          .insert({
            owner_user_id: user.id,
            name: input.name.trim(),
            phone_normalized: phone,
            email_lower: email,
            tags: input.tags ?? [],
            avatar_url: input.avatar_url ?? null,
            met_at: input.met_at ?? null,
            met_location: input.met_location ?? null,
            note: input.note ?? null,
            birthday: input.birthday ?? null,
          })
          .select()
          .single();
        if (error || !data) {
          console.warn('[useLocalContacts] add error:', error?.message);
          return null;
        }
        setContacts((prev) => [data as LocalContact, ...prev]);
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
