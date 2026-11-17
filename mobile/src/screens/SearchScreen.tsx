import React, { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ListRenderItemInfo,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Search, Hash, Clock, X } from 'lucide-react-native';
import RingedAvatar from '../components/RingedAvatar';
import CoachMark from '../components/CoachMark';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import {
  CACHE_KEYS,
  getPersistentCache,
  setPersistentCache,
} from '../lib/dataCache';
import { stripSearchStopwords, filterLoneStopwordTokens } from '../lib/searchStopwords';
import { ilikeEscape, hashDisplay } from '../lib/normalizeTag';
import { extractSearchIntent } from '../lib/extractSearchIntent';
import { semanticTagSearch } from '../lib/semanticTagSearch';
import * as ExpoCrypto from 'expo-crypto';
import { sanitizeQueryForTelemetry } from '../lib/sanitizeTelemetry';
import { BORDER_RADIUS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../hooks/useAuth';
import { useNetInfoReconnect } from '../hooks/useNetInfoReconnect';
import { useNetInfo } from '../hooks/useNetInfo';
import { useLoadDeadline } from '../hooks/useLoadDeadline';
import { checkOffline } from '../lib/netStatus';
import { useRotatingPlaceholder } from '../hooks/useRotatingPlaceholder';
import ErrorState from '../components/ErrorState';
import LogoLoader from '../components/loaders/LogoLoader';

// ════════════════════════════════════════════════════════════════════
// Search = the viewer's OWN network only (founder 2026-11-18, personal
// network tool; docs/PLAN-2026-11-tool-simplification.md stage 3).
//
// Explore-strangers, nearby people, global popular tags, the FoF boost
// and the friends map were removed from this screen. What is left:
//   • member friends (the viewer's piktag_connections rows)
//   • non-member contacts (the viewer's un-promoted piktag_local_contacts)
// matched by name / nickname / headline / note / met_location, and by
// tags: the viewer's own private + public tags on each friend
// (piktag_connection_tags), each friend's PUBLIC self-tags
// (piktag_user_tags), event tags of the scan session the connection came
// from, and the contact's own tags[].
//
// HOW STRANGERS ARE KEPT OUT: every person this screen can render comes
// from the in-memory NetworkIndex, and the index is built from exactly
// two queries — piktag_connections .eq('user_id', me) and
// piktag_local_contacts .eq('owner_user_id', me). Every tag query is
// keyed by ids from those two result sets (connection ids / friend ids /
// their scan-session ids) and attached back onto those same people. No
// RPC or query on this screen returns people; the server is only asked
// to translate a query string into concept ids (tag_aliases /
// tag_alias_locale_overrides / piktag_tags), which are then matched
// against the index on the client. There is no path for a non-friend to
// enter the result list.
//
// SPEED: matching runs on the device against the index, so name and tag
// hits paint on every keystroke with no round-trip. The only network
// step per query is the cross-language concept lookup (same two literal
// paths as search_users: tag name / alias), debounced and cached per
// keyword; its results merge in when they land.
// ════════════════════════════════════════════════════════════════════

// ── Recent searches: per-account, on disk ────────────────────────────
// Was the device-global `piktag_recent_searches` key (user A's queries
// leaked to user B on a shared phone). Now CACHE_KEYS.RECENT_SEARCHES,
// keyed by user id and swept on sign-out. The legacy key is DELETED,
// never read as a fallback.
const LEGACY_RECENT_SEARCHES_KEY = 'piktag_recent_searches';
const MAX_RECENT_SEARCHES = 10;

// Browse-mode category filter (by semantic_type) only shows when ≥2
// categories each have ≥ this many tags (founder 2026-06-09).
const MIN_TAGS_PER_CATEGORY = 6;

// Tag wall progressive reveal (pure in-memory, no network on scroll).
const WALL_PAGE = 20;
const WALL_MAX = 100;

// Index snapshot bounds. Android AsyncStorage reads a single entry
// through a ~2MB CursorWindow, so the snapshot is compacted (tag
// dictionary + per-person indexes) and kept under ~1MB of JSON; people
// past the budget are dropped from the SNAPSHOT only (the live index
// keeps everyone).
const SNAPSHOT_BUDGET_CHARS = 1_000_000;
const SNAPSHOT_MAX_TAGS_PER_PERSON = 40;
const INDEX_SNAPSHOT_VERSION = 3;
// Free-text fields (note can be long) are capped in the haystack.
const INFO_HAY_MAX = 200;

// One shared collator: people are sorted by name ONCE when an index is
// built/decoded; per-keystroke sorts are stable and never re-compare
// names.
const NAME_COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base' });

// Debounce for the cross-language concept lookup. Local matches do not
// wait for it.
const EXPANSION_DEBOUNCE_MS = 250;

// ── Network index types ──────────────────────────────────────────────

// One tag on one person. `key` is the identity used for matching and
// for the wall: 'c:<concept_id>' when the tag belongs to a concept (so
// crystal / 水晶 / ねこ siblings collapse into one key), else
// 't:<tag_id>', else 'n:<lowercased name>' for plain strings that never
// resolved to a piktag_tags row.
type NetTag = { key: string; name: string; st: string | null };

type NetPerson = {
  kind: 'friend' | 'contact';
  // profile id for friends, local-contact id for contacts
  id: string;
  connectionId: string | null;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  // lowercased haystacks
  nameHay: string;
  infoHay: string;
  tags: NetTag[];
};

// Compact on-disk form: tags = [key, name, semantic_type] dictionary;
// each person = [kind, id, connectionId, name, username, avatarUrl,
// nameHay, infoHay, tagIndexes].
type SnapshotTag = [string, string, string | null];
type SnapshotPerson = [
  'f' | 'c',
  string,
  string | null,
  string,
  string | null,
  string | null,
  string,
  string,
  number[],
];
type IndexSnapshot = { v: number; tags: SnapshotTag[]; people: SnapshotPerson[] };

type WallTag = {
  key: string;
  name: string;
  semantic_type: string | null;
  count: number;
};

type ResultRow =
  | { kind: 'friend'; person: NetPerson }
  | { kind: 'contact'; person: NetPerson };

const lower = (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : '');
const infoHayOf = (parts: unknown[]): string => parts.map(lower).filter(Boolean).join(' ').slice(0, INFO_HAY_MAX);

function sortByName(people: NetPerson[]): NetPerson[] {
  return people.sort((a, b) => NAME_COLLATOR.compare(a.name, b.name));
}

function encodeSnapshot(people: NetPerson[]): IndexSnapshot {
  const tagIndex = new Map<string, number>();
  const tags: SnapshotTag[] = [];
  const out: SnapshotPerson[] = [];
  let size = 32;
  // Members first: if the budget runs out, non-member contacts go first.
  const ordered = [...people.filter((p) => p.kind === 'friend'), ...people.filter((p) => p.kind === 'contact')];
  for (const p of ordered) {
    const idx: number[] = [];
    const newTags: SnapshotTag[] = [];
    for (const tg of p.tags.slice(0, SNAPSHOT_MAX_TAGS_PER_PERSON)) {
      const sig = tg.key + '\u0001' + tg.name;
      let i = tagIndex.get(sig);
      if (i === undefined) {
        i = tags.length + newTags.length;
        newTags.push([tg.key, tg.name, tg.st]);
      }
      idx.push(i);
    }
    const row: SnapshotPerson = [
      p.kind === 'friend' ? 'f' : 'c',
      p.id,
      p.connectionId,
      p.name,
      p.username,
      p.avatarUrl,
      p.nameHay,
      p.infoHay,
      idx,
    ];
    const added = JSON.stringify(row).length + (newTags.length ? JSON.stringify(newTags).length : 0) + 2;
    if (size + added > SNAPSHOT_BUDGET_CHARS) break;
    size += added;
    for (const nt of newTags) {
      tagIndex.set(nt[0] + '\u0001' + nt[1], tags.length);
      tags.push(nt);
    }
    out.push(row);
  }
  return { v: INDEX_SNAPSHOT_VERSION, tags, people: out };
}

function decodeSnapshot(snap: unknown): NetPerson[] | null {
  const s = snap as IndexSnapshot | null;
  if (!s || s.v !== INDEX_SNAPSHOT_VERSION || !Array.isArray(s.tags) || !Array.isArray(s.people)) return null;
  const people: NetPerson[] = [];
  for (const r of s.people) {
    if (!Array.isArray(r) || r.length < 9) continue;
    const tags: NetTag[] = [];
    for (const i of Array.isArray(r[8]) ? r[8] : []) {
      const tg = s.tags[i];
      if (tg) tags.push({ key: tg[0], name: tg[1], st: tg[2] ?? null });
    }
    people.push({
      kind: r[0] === 'f' ? 'friend' : 'contact',
      id: r[1],
      connectionId: r[2],
      name: r[3] || '',
      username: r[4],
      avatarUrl: r[5],
      nameHay: r[6] || '',
      infoHay: r[7] || '',
      tags,
    });
  }
  return sortByName(people);
}

// Strip the display prefix ConnectionsScreen writes into its snapshot
// (bidi mark + '#') so offline fallback tags compare as plain names.
const plainTagName = (s: string): string => s.replace(/^[‎‏؜]*#?/, '').trim();

function tagKeyOf(tag: { id?: string | null; concept_id?: string | null; name?: string | null }): string | null {
  if (tag.concept_id) return 'c:' + tag.concept_id;
  if (tag.id) return 't:' + tag.id;
  const n = lower(tag.name).trim();
  return n ? 'n:' + n : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Pages a PostgREST select past the 1000-row default cap. Returns null
// on ANY error so callers can refuse to install a partial index.
async function fetchPaged<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
  maxPages = 20,
): Promise<T[] | null> {
  const out: T[] = [];
  for (let p = 0; p < maxPages; p++) {
    const from = p * pageSize;
    const { data, error } = await page(from, from + pageSize - 1);
    if (error || !Array.isArray(data)) return null;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}

function qualifyingTagCategories(tagList: WallTag[]): string[] {
  const counts = new Map<string, number>();
  for (const tg of tagList) {
    if (tg.semantic_type) counts.set(tg.semantic_type, (counts.get(tg.semantic_type) || 0) + 1);
  }
  const qualifying = [...counts.entries()]
    .filter(([, n]) => n >= MIN_TAGS_PER_CATEGORY)
    .map(([k]) => k);
  return qualifying.length >= 2 ? qualifying : [];
}

// Query → content keywords (stopword-stripped, lowercased).
function parseKeywords(query: string): string[] {
  const raw = query.trim().replace(/#/g, '');
  if (!raw) return [];
  let keywords = stripSearchStopwords(raw)
    .split(/[\s,，、]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  keywords = filterLoneStopwordTokens(keywords);
  if (keywords.length === 0) keywords = [raw];
  return [...new Set(keywords.map((k) => k.toLowerCase()))].slice(0, 6);
}

// ── Build the index from the server ─────────────────────────────────
// Every query here is scoped to the viewer: connections by user_id,
// contacts by owner_user_id, and everything else keyed by ids taken from
// those two result sets. Returns null on failure (caller keeps whatever
// index/snapshot it already has).
async function fetchNetworkIndex(uid: string): Promise<NetPerson[] | null> {
  const [conns, contacts, blocksRes] = await Promise.all([
    fetchPaged<any>((from, to) =>
      supabase
        .from('piktag_connections')
        .select(
          'id, connected_user_id, nickname, note, met_location, scan_session_id, connected_user:piktag_profiles!connected_user_id(id, username, full_name, avatar_url, headline, is_official)',
        )
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to),
    ),
    fetchPaged<any>((from, to) =>
      supabase
        .from('piktag_local_contacts')
        .select('id, name, avatar_url, headline, note, met_location, tags')
        .eq('owner_user_id', uid)
        .is('promoted_to_connection_id', null)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to),
    ),
    // People the viewer blocked. block_user does NOT delete the
    // connection row, so without this a blocked person would still show
    // up in results, wall counts and tag filters (search_users excluded
    // blocks both ways). RLS only exposes rows where the viewer is the
    // BLOCKER; the reverse direction (someone blocked the viewer) cannot
    // be read from the client — fully matching the old behaviour needs a
    // SECURITY DEFINER RPC returning both directions.
    fetchPaged<any>((from, to) =>
      supabase
        .from('piktag_blocks')
        .select('blocked_id')
        .eq('blocker_id', uid)
        .order('blocked_id')
        .range(from, to),
    ),
  ]);
  // Fail closed: if we cannot tell who is blocked, install nothing.
  if (!conns || !contacts || !blocksRes) return null;
  const blocked = new Set<string>(blocksRes.map((b: any) => String(b?.blocked_id)).filter(Boolean));

  // De-dupe friends by profile id; drop self.
  const friendRows: any[] = [];
  const seenFriend = new Set<string>();
  for (const c of conns) {
    const pid = c?.connected_user_id;
    if (!pid || !c?.id || pid === uid || blocked.has(String(pid)) || seenFriend.has(pid)) continue;
    seenFriend.add(pid);
    friendRows.push(c);
  }
  const connIds = friendRows.map((c) => String(c.id));
  const friendIds = friendRows.map((c) => String(c.connected_user_id));
  const sessionIds = [
    ...new Set(friendRows.map((c) => c.scan_session_id).filter(Boolean).map(String)),
  ];

  const [connTagChunks, selfTagChunks, sessionChunks] = await Promise.all([
    Promise.all(
      chunk(connIds, 50).map((ids) =>
        fetchPaged<any>((from, to) =>
          supabase
            .from('piktag_connection_tags')
            .select('connection_id, tag:piktag_tags!tag_id(id, name, concept_id, semantic_type)')
            .in('connection_id', ids)
            .order('id')
            .range(from, to),
        ),
      ),
    ),
    Promise.all(
      chunk(friendIds, 50).map((ids) =>
        fetchPaged<any>((from, to) =>
          supabase
            .from('piktag_user_tags')
            .select('user_id, tag:piktag_tags!tag_id(id, name, concept_id, semantic_type)')
            .in('user_id', ids)
            .eq('is_private', false)
            .order('id')
            .range(from, to),
        ),
      ),
    ),
    Promise.all(
      chunk(sessionIds, 100).map((ids) =>
        fetchPaged<any>((from, to) =>
          supabase
            .from('piktag_scan_sessions')
            .select('id, event_tags')
            .in('id', ids)
            .order('id')
            .range(from, to),
        ),
      ),
    ),
  ]);
  if (connTagChunks.some((r) => r === null) || selfTagChunks.some((r) => r === null)) {
    return null;
  }
  // Scan sessions are best-effort: RLS only lets the HOST read a session,
  // so a missing row is normal, and an error just means no event tags.
  const sessionTags = new Map<string, string[]>();
  for (const rows of sessionChunks) {
    for (const s of rows || []) {
      if (s?.id && Array.isArray(s.event_tags)) {
        sessionTags.set(String(s.id), s.event_tags.filter((x: unknown) => typeof x === 'string'));
      }
    }
  }

  // Plain strings (contact tags, event tags) → piktag_tags rows, so a
  // contact tagged "crystal" shares the concept key of a friend tagged
  // 水晶. Best-effort: unresolved strings fall back to a name key.
  const plainStrings = new Set<string>();
  for (const c of contacts) {
    for (const s of Array.isArray(c?.tags) ? c.tags : []) {
      if (typeof s === 'string' && s.trim()) plainStrings.add(s.trim());
    }
  }
  for (const arr of sessionTags.values()) for (const s of arr) if (s.trim()) plainStrings.add(s.trim());
  const nameToKey = new Map<string, { key: string; st: string | null }>();
  const resolveChunks = await Promise.all(
    chunk([...plainStrings], 50).map((names) =>
      supabase.from('piktag_tags').select('id, name, concept_id, semantic_type').in('name', names),
    ),
  );
  for (const r of resolveChunks) {
    for (const t of (r?.data || []) as any[]) {
      const k = tagKeyOf(t);
      if (k && t?.name) nameToKey.set(lower(t.name), { key: k, st: t.semantic_type ?? null });
    }
  }

  const connTagsById = new Map<string, NetTag[]>();
  const addTag = (map: Map<string, NetTag[]>, owner: string, tag: any) => {
    if (!tag?.name) return;
    const k = tagKeyOf(tag);
    if (!k) return;
    // Keep the name→key map complete so case-variant plain strings
    // ("Remittance" vs "remittance") still land on the same key.
    if (!nameToKey.has(lower(tag.name))) {
      nameToKey.set(lower(tag.name), { key: k, st: tag.semantic_type ?? null });
    }
    const arr = map.get(owner) || [];
    arr.push({ key: k, name: tag.name, st: tag.semantic_type ?? null });
    map.set(owner, arr);
  };
  for (const rows of connTagChunks) for (const r of rows || []) addTag(connTagsById, String(r.connection_id), r.tag);
  const selfTagsById = new Map<string, NetTag[]>();
  for (const rows of selfTagChunks) for (const r of rows || []) addTag(selfTagsById, String(r.user_id), r.tag);

  const plainTag = (s: string): NetTag => {
    const hit = nameToKey.get(lower(s.trim()));
    return { key: hit?.key ?? 'n:' + lower(s.trim()), name: s.trim(), st: hit?.st ?? null };
  };
  const dedupeTags = (tags: NetTag[]): NetTag[] => {
    const seen = new Set<string>();
    const out: NetTag[] = [];
    for (const t of tags) {
      const sig = t.key + '|' + lower(t.name);
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(t);
    }
    return out;
  };

  const people: NetPerson[] = [];
  for (const c of friendRows) {
    const p = c.connected_user || {};
    const pid = String(c.connected_user_id);
    // @piktag is everyone's auto-friend and carries teaching tags; it
    // must never pad tag results (CLAUDE.md 排序面 #4). Name search
    // still finds it.
    const official = p.is_official === true;
    const tags = official
      ? []
      : dedupeTags([
          ...(connTagsById.get(String(c.id)) || []),
          ...(selfTagsById.get(pid) || []),
          ...(c.scan_session_id ? (sessionTags.get(String(c.scan_session_id)) || []).map(plainTag) : []),
        ]);
    people.push({
      kind: 'friend',
      id: pid,
      connectionId: String(c.id),
      name: p.full_name || p.username || c.nickname || '',
      username: p.username ?? null,
      avatarUrl: p.avatar_url ?? null,
      nameHay: [p.full_name, p.username, c.nickname].map(lower).join(' '),
      infoHay: infoHayOf([p.headline, c.note, c.met_location]),
      tags,
    });
  }
  for (const c of contacts) {
    if (!c?.id) continue;
    people.push({
      kind: 'contact',
      id: String(c.id),
      connectionId: null,
      name: c.name || '',
      username: null,
      avatarUrl: c.avatar_url ?? null,
      nameHay: lower(c.name),
      infoHay: infoHayOf([c.headline, c.note, c.met_location]),
      tags: dedupeTags(
        (Array.isArray(c.tags) ? c.tags : [])
          .filter((s: unknown): s is string => typeof s === 'string' && !!s.trim())
          .map(plainTag),
      ),
    });
  }
  return sortByName(people);
}

// Offline fallback when no index snapshot exists yet: the CONNECTIONS
// (ConnectionsScreen) and LOCAL_CONTACTS (useLocalContacts) snapshots
// are already on disk. Name keys only — no concept merging offline.
async function buildIndexFromLegacySnapshots(uid: string): Promise<NetPerson[] | null> {
  const [cachedConns, cachedContacts] = await Promise.all([
    getPersistentCache<any[]>(CACHE_KEYS.CONNECTIONS, uid),
    getPersistentCache<any[]>(CACHE_KEYS.LOCAL_CONTACTS, uid),
  ]);
  if (!Array.isArray(cachedConns) && !Array.isArray(cachedContacts)) return null;
  const toTags = (arr: unknown): NetTag[] =>
    (Array.isArray(arr) ? arr : [])
      .filter((s): s is string => typeof s === 'string')
      .map(plainTagName)
      .filter(Boolean)
      .map((n) => ({ key: 'n:' + lower(n), name: n, st: null }));
  const people: NetPerson[] = [];
  for (const c of Array.isArray(cachedConns) ? cachedConns : []) {
    const p = c?.connected_user || {};
    const pid = c?.connected_user_id ?? p?.id;
    if (!pid || !c?.id) continue;
    people.push({
      kind: 'friend',
      id: String(pid),
      connectionId: String(c.id),
      name: p.full_name || p.username || c.nickname || '',
      username: p.username ?? null,
      avatarUrl: p.avatar_url ?? null,
      nameHay: [p.full_name, p.username, c.nickname].map(lower).join(' '),
      infoHay: infoHayOf([c.note, c.met_location]),
      tags: toTags(c.tags),
    });
  }
  for (const c of Array.isArray(cachedContacts) ? cachedContacts : []) {
    if (!c?.id || c?.promoted_to_connection_id) continue;
    people.push({
      kind: 'contact',
      id: String(c.id),
      connectionId: null,
      name: c.name || '',
      username: null,
      avatarUrl: c.avatar_url ?? null,
      nameHay: lower(c.name),
      infoHay: infoHayOf([c.headline, c.note, c.met_location]),
      tags: toTags(c.tags),
    });
  }
  return sortByName(people);
}

// Query string → concept keys, via the same two literal paths
// search_users uses (tag name / alias), plus the viewer-locale alias
// overrides. Returns ONLY concept ids — never people — so it cannot
// widen the result set beyond the index. null on transport failure.
async function fetchConceptKeys(kw: string, locale: string): Promise<Set<string> | null> {
  const pattern = `%${ilikeEscape(kw)}%`;
  const [aliasRes, overrideRes, nameRes] = await Promise.all([
    supabase.from('tag_aliases').select('concept_id').ilike('alias', pattern).limit(200),
    supabase
      .from('tag_alias_locale_overrides')
      .select('concept_id')
      .ilike('alias', pattern)
      .eq('locale', locale)
      .limit(20),
    supabase
      .from('piktag_tags')
      .select('concept_id')
      .ilike('name', pattern)
      .not('concept_id', 'is', null)
      .limit(200),
  ]);
  if (aliasRes.error || nameRes.error) return null;
  const keys = new Set<string>();
  for (const r of [aliasRes, overrideRes, nameRes]) {
    for (const row of (r.data || []) as any[]) {
      if (row?.concept_id) keys.add('c:' + row.concept_id);
    }
  }
  return keys;
}

// ── Memoized list item components ──

type ProfileCardProps = {
  person: NetPerson;
  onPress: (person: NetPerson) => void;
  t: (key: string, opts?: any) => string;
};

const ProfileCard = React.memo(function ProfileCard({ person, onPress, t }: ProfileCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const handlePress = useCallback(() => onPress(person), [onPress, person]);
  return (
    <TouchableOpacity style={styles.profileCard} onPress={handlePress} activeOpacity={0.7}>
      <RingedAvatar size={51} ringStyle="subtle" name={person.name} avatarUrl={person.avatarUrl} />
      <View style={styles.profileInfo}>
        <View style={styles.profileNameRow}>
          <Text style={styles.profileName} numberOfLines={1}>
            {person.name || t('common.unnamed')}
          </Text>
        </View>
        {person.username ? (
          <Text style={styles.profileUsername} numberOfLines={1}>
            @{person.username}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
});

// A local contact (non-member). Owner-private by construction.
const LocalContactCard = React.memo(function LocalContactCard({ person, onPress, t }: ProfileCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const handlePress = useCallback(() => onPress(person), [onPress, person]);
  return (
    <TouchableOpacity style={styles.profileCard} onPress={handlePress} activeOpacity={0.7}>
      <RingedAvatar size={51} ringStyle="subtle" name={person.name || '?'} avatarUrl={person.avatarUrl} />
      <View style={styles.profileInfo}>
        <View style={styles.profileNameRow}>
          <Text style={styles.profileName} numberOfLines={1}>
            {person.name || '?'}
          </Text>
        </View>
        <Text style={styles.profileUsername} numberOfLines={1}>
          {t('connections.notJoinedBadge', { defaultValue: '尚未加入 PikTag' })}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

type TagCardProps = {
  tag: WallTag;
  isSelected?: boolean;
  onPress: (tag: WallTag) => void;
  countSuffix: string;
  showSemanticType?: boolean;
  semanticTypeLabel?: string;
};

const TagCard = React.memo(function TagCard({ tag, isSelected, onPress, countSuffix, showSemanticType, semanticTypeLabel }: TagCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={[styles.tagCard, isSelected && styles.tagCardHighlighted]}
      activeOpacity={0.7}
      onPress={() => onPress(tag)}
    >
      <View style={styles.tagCardRow}>
        <Hash size={14} color={isSelected ? '#FFFFFF' : colors.piktag500} strokeWidth={2.5} />
        <Text style={[styles.tagName, isSelected && styles.tagNameHighlighted]} numberOfLines={1}>
          {tag.name}
        </Text>
        {showSemanticType && semanticTypeLabel ? (
          <View style={[styles.semanticBadge, isSelected && styles.semanticBadgeSelected]}>
            <Text style={[styles.semanticBadgeText, isSelected && styles.semanticBadgeTextSelected]}>{semanticTypeLabel}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.tagCountRow}>
        <Text style={[styles.tagCount, isSelected && styles.tagCountHighlighted]}>
          {tag.count}{countSuffix}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

type RecentSearchItemProps = {
  query: string;
  onPress: (query: string) => void;
  onDelete: (query: string) => void;
  deleteLabel: string;
};

const RecentSearchItem = React.memo(function RecentSearchItem({ query, onPress, onDelete, deleteLabel }: RecentSearchItemProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const handlePress = useCallback(() => onPress(query), [onPress, query]);
  const handleDeletePress = useCallback(() => onDelete(query), [onDelete, query]);
  return (
    <View style={styles.recentSearchItem}>
      <TouchableOpacity style={styles.recentSearchItemLeft} onPress={handlePress} activeOpacity={0.7}>
        <Clock size={16} color={colors.gray400} />
        <Text style={styles.recentSearchText} numberOfLines={1}>{query}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={handleDeletePress}
        style={styles.recentSearchDeleteBtn}
        activeOpacity={0.6}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel={deleteLabel}
        accessibilityRole="button"
      >
        <X size={14} color={colors.gray400} />
      </TouchableOpacity>
    </View>
  );
});

// ── Main component ──

type SearchScreenProps = {
  navigation: any;
};

export default function SearchScreen({ navigation }: SearchScreenProps) {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const { isConnected } = useNetInfo();

  const [isFocused, setIsFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Rotating prompt placeholder. Hints that carry {{city}} are "near me"
  // prompts — nearby search is gone, so they are skipped rather than
  // rewritten (i18n keys are cleaned up in stage 4).
  const promptHints = useMemo(() => {
    const raw = t('search.promptHints', { returnObjects: true });
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const kept = (raw as string[]).filter((h) => typeof h === 'string' && !h.includes('{{city}}'));
    return kept.length > 0 ? kept : null;
  }, [t]);
  const placeholder = useRotatingPlaceholder(promptHints, t('search.searchPlaceholder'));

  // ── Network index ─────────────────────────────────────────────────
  const [people, setPeople] = useState<NetPerson[] | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const peopleRef = useRef<NetPerson[] | null>(null);
  peopleRef.current = people;
  // Identity guard: a fetch started for one account must never install
  // its index after a sign-out / account switch.
  const activeUidRef = useRef<string | null>(uid);
  activeUidRef.current = uid;
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fetch bookkeeping. `indexInFlight` holds the uid whose fetch is
  // running, so a stale fetch for a previous account cannot block (or be
  // mistaken for) the current one.
  const lastIndexFetchAt = useRef(0);
  const indexInFlight = useRef<string | null>(null);
  const refreshIndexRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  // Hydrate from disk first (instant paint, and the only source offline).
  // This is the ONE place the offline fallback (legacy snapshots) runs.
  const hydratedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!uid || hydratedForRef.current === uid) return;
    hydratedForRef.current = uid;
    // Account switch: drop the previous account's fetch state so the new
    // account's first fetch is neither blocked nor cooled down.
    indexInFlight.current = null;
    lastIndexFetchAt.current = 0;
    setPeople(null);
    let cancelled = false;
    void (async () => {
      const snap = await getPersistentCache<unknown>(CACHE_KEYS.SEARCH_BOOTSTRAP, uid);
      let fromDisk: NetPerson[] | null = decodeSnapshot(snap);
      if (!fromDisk && (await checkOffline())) {
        fromDisk = await buildIndexFromLegacySnapshots(uid);
      }
      if (cancelled || !isMountedRef.current || !fromDisk || activeUidRef.current !== uid) return;
      // Never clobber a live index that already landed.
      setPeople((prev) => prev ?? fromDisk);
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const refreshIndex = useCallback(
    async (force = false) => {
      if (!uid || indexInFlight.current === uid) return;
      const now = Date.now();
      if (!force && now - lastIndexFetchAt.current < 30_000) return;
      // Claim the slot BEFORE any await so the mount call and the focus
      // call that fires in the same tick cannot both start a fetch.
      indexInFlight.current = uid;
      if (await checkOffline()) {
        if (indexInFlight.current === uid) indexInFlight.current = null;
        // Offline: hydrate already painted the disk index (or the legacy
        // fallback). Building a fallback here raced it and could throw
        // away the better compact snapshot.
        if (isMountedRef.current) setIndexLoading(false);
        return;
      }
      lastIndexFetchAt.current = now;
      if (!peopleRef.current) setIndexLoading(true);
      try {
        const fresh = await fetchNetworkIndex(uid);
        if (!isMountedRef.current || activeUidRef.current !== uid) return;
        if (fresh) {
          setPeople(fresh);
          void setPersistentCache<IndexSnapshot>(CACHE_KEYS.SEARCH_BOOTSTRAP, uid, encodeSnapshot(fresh));
        } else {
          // Allow an immediate retry; keep whatever index is on screen.
          lastIndexFetchAt.current = 0;
        }
      } catch (err) {
        console.warn('[SearchScreen] network index failed:', err);
        lastIndexFetchAt.current = 0;
      } finally {
        if (indexInFlight.current === uid) indexInFlight.current = null;
        if (isMountedRef.current) {
          setIndexLoading(false);
          // The account changed while this fetch ran: fetch for the
          // current account now (the current closure, not this one).
          if (activeUidRef.current && activeUidRef.current !== uid) {
            void refreshIndexRef.current(true);
          }
        }
      }
    },
    [uid],
  );
  refreshIndexRef.current = refreshIndex;

  useEffect(() => {
    void refreshIndex(true);
  }, [refreshIndex]);
  useFocusEffect(
    useCallback(() => {
      void refreshIndex();
    }, [refreshIndex]),
  );
  useNetInfoReconnect(
    useCallback(() => {
      void refreshIndex(true);
    }, [refreshIndex]),
  );
  // A dead request must not spin forever.
  useLoadDeadline(indexLoading && !people, () => {
    setIndexLoading(false);
  });

  // ── Derived: tag universe of the viewer's network ─────────────────
  const { wallTags, tagNameEntries } = useMemo(() => {
    const byKey = new Map<string, { names: Map<string, number>; st: string | null; ids: Set<string> }>();
    for (const p of people || []) {
      for (const tg of p.tags) {
        let e = byKey.get(tg.key);
        if (!e) {
          e = { names: new Map(), st: tg.st, ids: new Set() };
          byKey.set(tg.key, e);
        }
        e.names.set(tg.name, (e.names.get(tg.name) || 0) + 1);
        if (!e.st && tg.st) e.st = tg.st;
        e.ids.add(p.kind + ':' + p.id);
      }
    }
    const wall: WallTag[] = [];
    const entries: { key: string; lname: string }[] = [];
    for (const [key, e] of byKey) {
      let best = '';
      let bestN = -1;
      for (const [n, c] of e.names) {
        if (c > bestN) {
          best = n;
          bestN = c;
        }
        entries.push({ key, lname: n.toLowerCase() });
      }
      wall.push({ key, name: best, semantic_type: e.st, count: e.ids.size });
    }
    // Stable sort: ties keep the name order the index was built in.
    wall.sort((a, b) => b.count - a.count);
    return { wallTags: wall, tagNameEntries: entries };
  }, [people]);
  const wallTagByKey = useMemo(() => {
    const m = new Map<string, WallTag>();
    for (const w of wallTags) m.set(w.key, w);
    return m;
  }, [wallTags]);

  // ── Query state ───────────────────────────────────────────────────
  const trimmedQuery = searchQuery.trim();
  // Matching reads the DEFERRED query so a big index never blocks the
  // keystroke itself; the input stays responsive and results follow.
  const deferredTrimmedQuery = useDeferredValue(searchQuery).trim();
  // Tag-filter mode: people who carry ALL of these tag keys.
  const [filterTags, setFilterTags] = useState<WallTag[]>([]);
  const filterMode = filterTags.length > 0;
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [selectedTagCategory, setSelectedTagCategory] = useState<string | null>(null);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  // AI zero-result recovery (submit only): keywords extracted for a
  // specific query string; dropped as soon as the text changes.
  const [recovery, setRecovery] = useState<{ query: string; keywords: string[] } | null>(null);
  const [recovering, setRecovering] = useState(false);
  const activeRecovery = recovery && recovery.query === trimmedQuery ? recovery : null;

  const keywords = useMemo(
    () => (activeRecovery ? activeRecovery.keywords.map((k) => k.toLowerCase()) : parseKeywords(deferredTrimmedQuery)),
    [activeRecovery, deferredTrimmedQuery],
  );

  // Cross-language concept expansion, cached per keyword for the session.
  const expansionCacheRef = useRef(new Map<string, Set<string>>());
  // Words whose lookup is on the wire — never sent twice concurrently.
  const expansionInFlightRef = useRef(new Set<string>());
  // Words whose lookup just failed (or was skipped offline) → not
  // "pending" for a short while, so the dead-end state can render.
  const expansionFailedAtRef = useRef(new Map<string, number>());
  const [expansionVersion, setExpansionVersion] = useState(0);
  const [expansionPending, setExpansionPending] = useState(false);
  const keywordsSig = keywords.join('\u0001');
  useEffect(() => {
    if (filterMode) {
      setExpansionPending(false);
      return;
    }
    const now = Date.now();
    const needed = keywords.filter(
      (k) =>
        k.length >= 2 &&
        !expansionCacheRef.current.has(k) &&
        now - (expansionFailedAtRef.current.get(k) ?? 0) > 10_000,
    );
    setExpansionPending(needed.length > 0);
    // In-flight words resolve on their own and bump expansionVersion,
    // which re-runs this effect.
    const toFetch = needed.filter((k) => !expansionInFlightRef.current.has(k));
    if (toFetch.length === 0) return;
    const timer = setTimeout(() => {
      for (const k of toFetch) expansionInFlightRef.current.add(k);
      void (async () => {
        const markFailed = () => {
          const at = Date.now();
          for (const k of toFetch) {
            if (!expansionCacheRef.current.has(k)) expansionFailedAtRef.current.set(k, at);
          }
        };
        try {
          if (await checkOffline()) {
            markFailed();
            return;
          }
          const locale = i18n.language || '';
          const results = await Promise.all(toFetch.map((k) => fetchConceptKeys(k, locale).catch(() => null)));
          results.forEach((r, i) => {
            if (r) expansionCacheRef.current.set(toFetch[i], r);
          });
          markFailed();
        } finally {
          for (const k of toFetch) expansionInFlightRef.current.delete(k);
          if (isMountedRef.current) setExpansionVersion((v) => v + 1);
        }
      })();
    }, EXPANSION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // keywordsSig captures `keywords`; expansionVersion re-evaluates
    // after an in-flight lookup lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywordsSig, filterMode, i18n.language, expansionVersion]);

  // ── Matching (on-device, every keystroke) ─────────────────────────
  const { results, matchedTags } = useMemo(() => {
    const list = people || [];
    if (filterMode) {
      const need = filterTags.map((f) => f.key);
      const out: ResultRow[] = [];
      for (const p of list) {
        const keys = new Set(p.tags.map((tg) => tg.key));
        if (need.every((k) => keys.has(k))) out.push({ kind: p.kind, person: p });
      }
      // `list` is already in NAME_COLLATOR order; a stable sort on kind
      // keeps that order inside each group.
      out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'friend' ? -1 : 1));
      return { results: out, matchedTags: [] as WallTag[] };
    }
    if (keywords.length === 0) return { results: [] as ResultRow[], matchedTags: [] as WallTag[] };

    // Per keyword: tag keys in this network whose name contains it
    // (local concept siblings come along for free, since keys are
    // concept-level) + concept keys the server resolved for it.
    const perKw = keywords.map((kw) => {
      const keys = new Set<string>();
      for (const e of tagNameEntries) if (e.lname.includes(kw)) keys.add(e.key);
      const exp = expansionCacheRef.current.get(kw);
      if (exp) for (const k of exp) if (wallTagByKey.has(k)) keys.add(k);
      return { kw, keys };
    });

    const scored: { row: ResultRow; matched: number; score: number }[] = [];
    for (const p of list) {
      let matched = 0;
      let score = 0;
      for (const { kw, keys } of perKw) {
        let hit = 0;
        if (p.nameHay.includes(kw)) hit = 3;
        if (hit < 2 && keys.size > 0 && p.tags.some((tg) => keys.has(tg.key))) hit = 2;
        if (hit === 0 && p.infoHay.includes(kw)) hit = 1;
        if (hit > 0) {
          matched++;
          score += hit;
        }
      }
      if (matched > 0) scored.push({ row: { kind: p.kind, person: p }, matched, score });
    }
    scored.sort(
      (a, b) =>
        b.matched - a.matched ||
        b.score - a.score ||
        // ties keep the index's NAME_COLLATOR order (stable sort)
        (a.row.kind === b.row.kind ? 0 : a.row.kind === 'friend' ? -1 : 1),
    );

    const tagKeys = new Set<string>();
    for (const { keys } of perKw) for (const k of keys) tagKeys.add(k);
    const tagsOut = [...tagKeys]
      .map((k) => wallTagByKey.get(k))
      .filter((w): w is WallTag => !!w)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    return { results: scored.map((s) => s.row), matchedTags: tagsOut };
    // expansionVersion: the cache ref changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, filterMode, filterTags, keywords, tagNameEntries, wallTagByKey, expansionVersion]);

  // ── Recent searches ───────────────────────────────────────────────
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const recentSearchesRef = useRef(recentSearches);
  recentSearchesRef.current = recentSearches;
  const uidRef = useRef<string | null>(uid);
  uidRef.current = uid;

  const persistRecentSearches = useCallback(async (list: string[]) => {
    const id = uidRef.current;
    if (!id) return;
    await setPersistentCache(CACHE_KEYS.RECENT_SEARCHES, id, list);
  }, []);

  useEffect(() => {
    setRecentSearches([]);
    if (!uid) return;
    void (async () => {
      try {
        await AsyncStorage.removeItem(LEGACY_RECENT_SEARCHES_KEY);
      } catch {}
      try {
        const stored = await getPersistentCache<unknown>(CACHE_KEYS.RECENT_SEARCHES, uid);
        if (Array.isArray(stored) && isMountedRef.current) {
          setRecentSearches(stored.filter((s): s is string => typeof s === 'string'));
        }
      } catch {}
    })();
  }, [uid]);

  const saveRecentSearch = useCallback(
    async (query: string) => {
      try {
        const q = query.trim();
        if (!q) return;
        const updated = [q, ...recentSearchesRef.current.filter((s) => s !== q)].slice(0, MAX_RECENT_SEARCHES);
        setRecentSearches(updated);
        await persistRecentSearches(updated);
      } catch {}
    },
    [persistRecentSearches],
  );

  // ── Committed query (submit / recent tap) ─────────────────────────
  // Live matching runs per keystroke; analytics (impressions, telemetry)
  // and the AI recovery only fire for a COMMITTED query so typing does
  // not flood the tables.
  const [committedQuery, setCommittedQuery] = useState('');
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const pendingRef = useRef(false);
  pendingRef.current = expansionPending || (indexLoading && !people);

  const commitQuery = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q) return;
      setCommittedQuery(q);
      void saveRecentSearch(q);
      // Let in-flight expansion settle (bounded) before judging "zero".
      const started = Date.now();
      while (pendingRef.current && Date.now() - started < 3000) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!isMountedRef.current) return;
      let recoveryTriggered = false;
      let extracted: string[] = [];
      const directHit = resultsRef.current.length > 0;
      if (!directHit && !(await checkOffline())) {
        recoveryTriggered = true;
        setRecovering(true);
        try {
          extracted = await semanticTagSearch(q);
          if (extracted.length === 0) extracted = await extractSearchIntent(q);
          if (isMountedRef.current && extracted.length > 0) {
            setRecovery({ query: q, keywords: extracted });
          }
        } catch (err) {
          console.warn('[SearchScreen] recovery failed:', err);
        } finally {
          if (isMountedRef.current) setRecovering(false);
        }
      }
      const id = uidRef.current;
      if (id) {
        void supabase.from('piktag_search_telemetry').insert({
          user_id: id,
          query: sanitizeQueryForTelemetry(q),
          direct_hit: directHit,
          recovery_triggered: recoveryTriggered,
          extracted_keywords: extracted.length > 0 ? extracted : null,
          final_tag_count: 0,
          final_profile_count: resultsRef.current.filter((r) => r.kind === 'friend').length,
          final_tag_user_count: 0,
          locale: i18n.language || null,
        });
      }
    },
    [saveRecentSearch, i18n.language],
  );

  // ── Handlers ──────────────────────────────────────────────────────
  const searchInputRef = useRef<TextInput>(null);

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
      if (filterMode) setFilterTags([]);
    },
    [filterMode],
  );

  const handleSubmitEditing = useCallback(() => {
    if (searchQuery.trim()) void commitQuery(searchQuery);
  }, [commitQuery, searchQuery]);

  const handleRecentSearchTap = useCallback(
    (query: string) => {
      setFilterTags([]);
      setSearchQuery(query);
      void commitQuery(query);
    },
    [commitQuery],
  );

  const handleDeleteRecentAt = useCallback(
    async (query: string) => {
      const updated = recentSearches.filter((q) => q !== query);
      setRecentSearches(updated);
      try {
        await persistRecentSearches(updated);
      } catch {}
    },
    [recentSearches, persistRecentSearches],
  );

  const handleClearHistory = useCallback(async () => {
    await persistRecentSearches([]);
    setRecentSearches([]);
  }, [persistRecentSearches]);

  const handleTagPress = useCallback((tag: WallTag) => {
    setSelectedKeys((prev) => (prev.includes(tag.key) ? prev.filter((k) => k !== tag.key) : [...prev, tag.key]));
  }, []);

  const applyFilter = useCallback(
    (keys: string[]) => {
      const tags = keys.map((k) => wallTagByKey.get(k)).filter((w): w is WallTag => !!w);
      setSelectedKeys([]);
      if (tags.length === 0) return;
      setFilterTags(tags);
      setSearchQuery(tags.map((w) => w.name).join(' + '));
      setCommittedQuery(tags.map((w) => w.name).join(' + '));
      searchInputRef.current?.blur();
    },
    [wallTagByKey],
  );

  const handleRemoveFilterTag = useCallback(
    (key: string) => {
      const remaining = filterTags.filter((w) => w.key !== key);
      if (remaining.length === 0) {
        setFilterTags([]);
        setSearchQuery('');
        setCommittedQuery('');
        return;
      }
      setFilterTags(remaining);
      setSearchQuery(remaining.map((w) => w.name).join(' + '));
      setCommittedQuery(remaining.map((w) => w.name).join(' + '));
    },
    [filterTags],
  );

  const handleResetToDefault = useCallback(() => {
    setSearchQuery('');
    setCommittedQuery('');
    setSelectedKeys([]);
    setFilterTags([]);
    setRecovery(null);
    setRecovering(false);
    setSelectedTagCategory(null);
    searchInputRef.current?.blur();
  }, []);

  // ── Analytics: impressions + clicks (committed queries only) ──────
  const impressionSigRef = useRef('');
  const searchQueryIdRef = useRef<string | null>(null);
  const isCommitted = filterMode || (committedQuery !== '' && committedQuery === trimmedQuery);
  useEffect(() => {
    if (!uid || !isCommitted || recovering) return;
    if (expansionPending) return;
    const ordered: { id: string; rank: number }[] = [];
    results.forEach((r, i) => {
      if (r.kind === 'friend') ordered.push({ id: r.person.id, rank: i });
    });
    if (ordered.length === 0) return;
    const queryText = trimmedQuery;
    if (!queryText) return;
    const firstConcept =
      (filterMode ? filterTags : matchedTags).find((w) => w.key.startsWith('c:'))?.key.slice(2) ?? null;
    const sig = `${filterMode ? 'intx' : 'text'}|${queryText}|${ordered.map((o) => o.id).join(',')}`;
    if (sig === impressionSigRef.current) return;
    impressionSigRef.current = sig;
    searchQueryIdRef.current = ExpoCrypto.randomUUID();
    const rows = ordered.map(({ id, rank }) => ({
      searcher_id: uid,
      target_user_id: id,
      concept_id: firstConcept,
      query_text: queryText,
      rank_position: rank,
      surface: 'search',
      query_id: searchQueryIdRef.current,
    }));
    try {
      void supabase
        .from('piktag_search_impressions')
        .insert(rows)
        .then(({ error }) => {
          if (error) {
            const code = (error as any).code;
            if (code !== '42P01' && code !== 'PGRST205') {
              console.warn('[SearchScreen] impression log failed:', error.message);
            }
          }
        });
    } catch (err) {
      console.warn('[SearchScreen] impression log failed:', err);
    }
  }, [uid, isCommitted, recovering, expansionPending, results, trimmedQuery, filterMode, filterTags, matchedTags]);

  const handlePersonPress = useCallback(
    (person: NetPerson) => {
      if (trimmedQuery) void saveRecentSearch(trimmedQuery);
      if (person.kind === 'contact') {
        navigation.navigate('LocalContactDetail', { contactId: person.id });
        return;
      }
      if (uid) {
        const keyword = (activeRecovery && activeRecovery.keywords[0]) || trimmedQuery || '(empty)';
        void supabase
          .from('piktag_search_learnings')
          .insert({
            query: trimmedQuery || keyword,
            extracted_keyword: keyword,
            clicked_user_id: person.id,
            searcher_id: uid,
            query_id: searchQueryIdRef.current,
          })
          .then(({ error }) => {
            if (error) {
              const code = (error as any).code;
              if (code !== '42P01' && code !== 'PGRST205') {
                console.warn('[search] click log failed:', error.message);
              }
            }
          });
      }
      if (person.connectionId) {
        navigation.navigate('FriendDetail', { connectionId: person.connectionId, friendId: person.id });
      }
    },
    [navigation, uid, trimmedQuery, activeRecovery, saveRecentSearch],
  );

  // ── Tag wall (default surface) ────────────────────────────────────
  const tagCategories = useMemo(() => qualifyingTagCategories(wallTags.slice(0, WALL_MAX)), [wallTags]);
  const [wallVisibleCount, setWallVisibleCount] = useState(WALL_PAGE);
  useEffect(() => {
    setWallVisibleCount(WALL_PAGE);
  }, [wallTags, selectedTagCategory]);
  const filteredWall = useMemo(() => {
    const active = selectedTagCategory && tagCategories.includes(selectedTagCategory) ? selectedTagCategory : null;
    const base = wallTags.slice(0, WALL_MAX);
    return (active ? base.filter((w) => w.semantic_type === active) : base).slice(0, wallVisibleCount);
  }, [wallTags, selectedTagCategory, tagCategories, wallVisibleCount]);

  const handleListEndReached = useCallback(() => {
    if (trimmedQuery !== '' || filterMode) return;
    const cap = Math.min(wallTags.length, WALL_MAX);
    setWallVisibleCount((c) => (c < cap ? Math.min(c + WALL_PAGE, cap) : c));
  }, [trimmedQuery, filterMode, wallTags.length]);

  const tagCountSuffix = useMemo(() => t('search.tagCountSuffix'), [t]);

  // ── List data ─────────────────────────────────────────────────────
  type ListItem =
    | { type: 'loading' }
    | { type: 'aiThinking' }
    | { type: 'aiKeywordsChip'; keywords: string[] }
    | { type: 'recentHeader' }
    | { type: 'recentItem'; query: string; index: number }
    | { type: 'filterChips' }
    | { type: 'resultsLabel' }
    | { type: 'personItem'; row: ResultRow }
    | { type: 'profilesEmpty'; isDeadEnd: boolean; conceptLabel: string }
    | { type: 'tagsHeader' }
    | { type: 'matchedTagsGrid' }
    | { type: 'tagsHomeHeader' }
    | { type: 'wallGrid' }
    | { type: 'tagsEmpty' }
    | { type: 'indexError' }
    | { type: 'searchError' };

  const listData = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];
    const hasIndex = people !== null;

    if (filterMode) {
      items.push({ type: 'filterChips' });
      if (!hasIndex) {
        items.push({ type: indexLoading ? 'loading' : 'indexError' });
        return items;
      }
      if (results.length > 0) {
        for (const row of results) items.push({ type: 'personItem', row });
      } else {
        items.push({ type: 'profilesEmpty', isDeadEnd: true, conceptLabel: filterTags.map((w) => hashDisplay(w.name)).join(' + ') });
      }
      return items;
    }

    if (trimmedQuery !== '') {
      if (recovering) {
        items.push({ type: 'aiThinking' });
        return items;
      }
      if (!hasIndex) {
        if (indexLoading) items.push({ type: 'loading' });
        else items.push({ type: isConnected ? 'indexError' : 'searchError' });
        return items;
      }
      if (activeRecovery && activeRecovery.keywords.length > 0 && results.length > 0) {
        items.push({ type: 'aiKeywordsChip', keywords: activeRecovery.keywords });
      }
      if (matchedTags.length > 0) {
        items.push({ type: 'tagsHeader' });
        items.push({ type: 'matchedTagsGrid' });
      }
      if (results.length > 0) {
        items.push({ type: 'resultsLabel' });
        for (const row of results) items.push({ type: 'personItem', row });
      } else if (expansionPending) {
        items.push({ type: 'loading' });
      } else {
        const conceptLabel = activeRecovery && activeRecovery.keywords.length > 0
          ? hashDisplay(activeRecovery.keywords[0])
          : trimmedQuery;
        items.push({ type: 'profilesEmpty', isDeadEnd: matchedTags.length === 0, conceptLabel });
      }
      return items;
    }

    if (isFocused && recentSearches.length > 0) {
      items.push({ type: 'recentHeader' });
      recentSearches.forEach((query, index) => items.push({ type: 'recentItem', query, index }));
      return items;
    }

    // Default surface: the tags of the viewer's own network.
    if (!hasIndex) {
      if (indexLoading) items.push({ type: 'loading' });
      else items.push({ type: isConnected ? 'indexError' : 'searchError' });
      return items;
    }
    items.push({ type: 'tagsHomeHeader' });
    items.push({ type: wallTags.length > 0 ? 'wallGrid' : 'tagsEmpty' });
    return items;
  }, [
    people,
    filterMode,
    filterTags,
    indexLoading,
    results,
    trimmedQuery,
    recovering,
    isConnected,
    activeRecovery,
    matchedTags,
    expansionPending,
    isFocused,
    recentSearches,
    wallTags.length,
  ]);

  const keyExtractor = useCallback((item: ListItem, index: number): string => {
    switch (item.type) {
      case 'recentItem':
        return `recent-${item.index}`;
      case 'personItem':
        return `${item.row.kind}-${item.row.person.id}`;
      case 'aiKeywordsChip':
        return 'aiKeywordsChip-' + item.keywords.join(',');
      default:
        return item.type || `item-${index}`;
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ListItem>) => {
      switch (item.type) {
        case 'loading':
          return (
            <View style={styles.loadingContainer}>
              <LogoLoader size={64} />
            </View>
          );

        case 'aiThinking':
          return (
            <View style={styles.loadingContainer}>
              <LogoLoader size={64} />
              <Text style={styles.aiThinkingText}>
                {t('search.aiThinking', { defaultValue: 'Reading your intent…' })}
              </Text>
            </View>
          );

        case 'aiKeywordsChip':
          return (
            <View style={styles.aiChipRow}>
              <Text style={styles.aiChipLabel}>
                {t('search.aiExtractedLabel', { defaultValue: 'PikTag understood you mean:' })}
              </Text>
              <View style={styles.aiChipKeywordsRow}>
                {item.keywords.map((kw) => (
                  <View key={kw} style={styles.aiChipKeyword}>
                    <Text style={styles.aiChipKeywordText}>{hashDisplay(kw)}</Text>
                  </View>
                ))}
              </View>
            </View>
          );

        case 'indexError':
          return <ErrorState onRetry={() => void refreshIndex(true)} />;

        case 'searchError':
          // Offline and nothing was ever synced to this device.
          return (
            <ErrorState
              heading={t('search.noSnapshotTitle', { defaultValue: '還沒同步過你的通訊錄' })}
              subtitle={t('search.noSnapshotBody', {
                defaultValue: '連上網路後會自動同步，之後即使離線也能搜尋你的好友和聯絡人。',
              })}
              onRetry={() => void refreshIndex(true)}
            />
          );

        case 'recentHeader':
          return (
            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabelText}>{t('search.recentSearchesLabel')}</Text>
              <TouchableOpacity onPress={() => void handleClearHistory()} activeOpacity={0.7}>
                <Text style={styles.sectionLabelClear}>{t('search.clearHistory', { defaultValue: '清除' })}</Text>
              </TouchableOpacity>
            </View>
          );

        case 'recentItem':
          return (
            <RecentSearchItem
              query={item.query}
              onPress={handleRecentSearchTap}
              onDelete={handleDeleteRecentAt}
              deleteLabel={t('search.deleteRecentItem', { defaultValue: '刪除這筆紀錄' })}
            />
          );

        case 'filterChips':
          return (
            <View style={styles.selectedChipsRow}>
              {filterTags.map((tag) => (
                <View key={tag.key} style={styles.selectedChip}>
                  <Text style={styles.selectedChipText}>{hashDisplay(tag.name)}</Text>
                  <TouchableOpacity
                    onPress={() => handleRemoveFilterTag(tag.key)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <X size={14} color={'#FFFFFF'} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          );

        case 'resultsLabel':
          return <Text style={styles.resultSectionLabel}>{t('search.searchResultsLabel')}</Text>;

        case 'personItem':
          return item.row.kind === 'friend' ? (
            <ProfileCard person={item.row.person} onPress={handlePersonPress} t={t} />
          ) : (
            <LocalContactCard person={item.row.person} onPress={handlePersonPress} t={t} />
          );

        case 'profilesEmpty':
          if (!item.isDeadEnd) {
            return (
              <View style={styles.emptyStateContainer}>
                <Text style={styles.emptyStateTitle} numberOfLines={2}>
                  {t('search.tabEmptyShort', { defaultValue: '這個分頁還沒有相符的人' })}
                </Text>
              </View>
            );
          }
          return (
            <View style={styles.emptyStateContainer}>
              <Text style={styles.emptyStateTitle} numberOfLines={3}>
                {t('search.deadEndTitle', {
                  concept: item.conceptLabel,
                  defaultValue: '你的人脈裡還沒有「{{concept}}」的人',
                })}
              </Text>
              <Text style={styles.emptyStateHint}>
                {t('search.tryTagSearchHint', { defaultValue: 'Try searching #tags or a different keyword' })}
              </Text>
            </View>
          );

        case 'tagsHeader':
          return <Text style={styles.resultSectionLabel}>{t('search.tagsSectionLabel')}</Text>;

        case 'matchedTagsGrid':
          return (
            <View style={[styles.tagsGrid, styles.matchedTagsGrid]}>
              {matchedTags.map((tag) => (
                <TagCard
                  key={tag.key}
                  tag={tag}
                  isSelected={selectedKeySet.has(tag.key)}
                  onPress={handleTagPress}
                  countSuffix={tagCountSuffix}
                  showSemanticType
                  semanticTypeLabel={tag.semantic_type ? t(`semanticType.${tag.semantic_type}`) : undefined}
                />
              ))}
            </View>
          );

        case 'tagsHomeHeader':
          return (
            <View style={styles.tagsHomeHeader}>
              <Text style={styles.tagsHomeHeaderTitle}>
                <Text style={styles.tagsHomeHeaderHash}>#</Text>
                {t('search.tagsSectionLabel')}
              </Text>
              <Text style={styles.tagsHomeHeaderSubtitle}>
                {t('search.tagsHomePrompt', { defaultValue: '點任一標籤直接找朋友，或用上方搜尋框打一句話' })}
              </Text>
            </View>
          );

        case 'tagsEmpty':
          return <Text style={styles.emptyText}>{t('common.noTags')}</Text>;

        case 'wallGrid':
          return (
            <View>
              {tagCategories.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryChipsRow}>
                  <TouchableOpacity
                    style={[styles.categoryChip, !selectedTagCategory && styles.categoryChipActive]}
                    onPress={() => setSelectedTagCategory(null)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.categoryChipText, !selectedTagCategory && styles.categoryChipTextActive]}>
                      {t('search.allCategories')}
                    </Text>
                  </TouchableOpacity>
                  {tagCategories.map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.categoryChip, selectedTagCategory === cat && styles.categoryChipActive]}
                      onPress={() => setSelectedTagCategory(selectedTagCategory === cat ? null : cat)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.categoryChipText, selectedTagCategory === cat && styles.categoryChipTextActive]}>
                        {t(`semanticType.${cat}`) || cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <View style={styles.tagsGrid}>
                {filteredWall.map((tag) => (
                  <TagCard
                    key={tag.key}
                    tag={tag}
                    isSelected={selectedKeySet.has(tag.key)}
                    onPress={handleTagPress}
                    countSuffix={tagCountSuffix}
                  />
                ))}
              </View>
            </View>
          );

        default:
          return null;
      }
    },
    [
      styles,
      t,
      refreshIndex,
      handleClearHistory,
      handleRecentSearchTap,
      handleDeleteRecentAt,
      filterTags,
      handleRemoveFilterTag,
      handlePersonPress,
      matchedTags,
      selectedKeySet,
      handleTagPress,
      tagCountSuffix,
      tagCategories,
      selectedTagCategory,
      filteredWall,
    ],
  );

  const searchContainerStyle = useMemo(
    () => [styles.searchContainer, isFocused && styles.searchContainerFocused],
    [isFocused, styles],
  );
  // Manual focus fallback (some devices miss the TextInput hit-test).
  const focusSearchInput = useCallback(() => searchInputRef.current?.focus(), []);
  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={topEdges}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('search.headerTitle', { defaultValue: '搜尋' })}</Text>
        </View>
        <Pressable style={searchContainerStyle} onPress={focusSearchInput}>
          <Search size={20} color={colors.gray400} style={styles.searchIcon} pointerEvents="none" />
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder={placeholder}
            placeholderTextColor={colors.gray400}
            value={searchQuery}
            onChangeText={handleSearchChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            returnKeyType="search"
            onSubmitEditing={handleSubmitEditing}
            accessibilityLabel={t('search.searchInputLabel', { defaultValue: '搜尋' })}
            accessibilityRole="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={handleResetToDefault}
              style={styles.searchClearBtn}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('search.clearSearchLabel', { defaultValue: '清除搜尋' })}
              accessibilityRole="button"
            >
              <X size={16} color={colors.gray400} />
            </TouchableOpacity>
          )}
        </Pressable>
      </View>

      <FlatList
        data={listData}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={7}
        initialNumToRender={8}
        onEndReached={handleListEndReached}
        onEndReachedThreshold={0.5}
      />

      {/* Floating bar when tags are selected: filter the viewer's own
          network to people carrying ALL selected tags. */}
      {selectedKeys.length > 0 && (
        <View style={styles.floatingSearchBar}>
          <Text style={styles.floatingSearchText}>
            {selectedKeys.length} {t('search.tagsSelected', { defaultValue: '個標籤已選' })}
          </Text>
          <TouchableOpacity style={styles.floatingClearBtn} onPress={() => setSelectedKeys([])} activeOpacity={0.7}>
            <Text style={styles.floatingClearText}>{t('search.clearAll', { defaultValue: '清除' })}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.floatingSearchBtn} onPress={() => applyFilter(selectedKeys)} activeOpacity={0.8}>
            <Search size={16} color={'#FFFFFF'} />
            <Text style={styles.floatingSearchBtnText}>{t('search.searchBtn', { defaultValue: '搜尋' })}</Text>
          </TouchableOpacity>
        </View>
      )}

      <CoachMark
        hintId="search_intent"
        text={t('coach.searchIntent')}
        style={{ top: 138, left: 24, right: 24 }}
        arrow="up"
      />
    </SafeAreaView>
  );
}

// Stable array reference for SafeAreaView edges
const topEdges: ('top')[] = ['top'];

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  semanticBadge: {
    backgroundColor: c.gray100,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 4,
  },
  semanticBadgeSelected: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  semanticBadgeText: {
    fontSize: 10,
    color: c.gray500,
    fontWeight: '500',
  },
  semanticBadgeTextSelected: {
    color: 'rgba(255,255,255,0.8)',
  },
  floatingSearchBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: c.gray200,
    gap: 10,
  },
  floatingSearchText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: c.gray700,
  },
  floatingClearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  floatingClearText: {
    fontSize: 13,
    color: c.gray500,
  },
  floatingSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.piktag500,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  floatingSearchBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  selectedChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.piktag500,
    borderRadius: 20,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    gap: 6,
  },
  selectedChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: c.white,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: c.white,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    minHeight: 44,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: c.gray900,
    lineHeight: 32,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.gray100,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 48,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  searchContainerFocused: {
    backgroundColor: c.white,
    borderColor: c.piktag500,
    shadowColor: c.piktag200,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 4,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchClearBtn: {
    padding: 4,
    marginLeft: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: c.gray900,
    lineHeight: 22,
    padding: 0,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 100,
  },
  tagsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  matchedTagsGrid: {
    marginBottom: 20,
  },
  tagCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.gray100,
    borderRadius: 9999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 6,
  },
  tagCardHighlighted: {
    backgroundColor: c.piktag500,
  },
  tagCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tagName: {
    fontSize: 14,
    fontWeight: '600',
    color: c.gray900,
    lineHeight: 20,
  },
  tagNameHighlighted: {
    color: '#FFFFFF',
  },
  tagCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  tagCount: {
    fontSize: 11,
    color: c.gray400,
    lineHeight: 14,
  },
  tagCountHighlighted: {
    color: 'rgba(255,255,255,0.7)',
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  aiThinkingText: {
    fontSize: 14,
    fontWeight: '500',
    color: c.gray500,
    marginTop: 14,
    textAlign: 'center',
  },
  aiChipRow: {
    paddingBottom: 12,
  },
  aiChipLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: c.gray500,
    marginBottom: 8,
  },
  aiChipKeywordsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  aiChipKeyword: {
    backgroundColor: c.fill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: BORDER_RADIUS.full,
  },
  aiChipKeywordText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.piktag500,
  },
  emptyText: {
    fontSize: 14,
    color: c.gray400,
    textAlign: 'center',
    paddingVertical: 24,
  },
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: c.gray700,
    textAlign: 'center',
  },
  emptyStateHint: {
    fontSize: 13,
    color: c.gray500,
    textAlign: 'center',
    marginTop: 8,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionLabelText: {
    fontSize: 16,
    fontWeight: '700',
    color: c.gray900,
  },
  sectionLabelClear: {
    fontSize: 13,
    fontWeight: '500',
    color: c.gray400,
  },
  resultSectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: c.gray500,
    marginBottom: 12,
    marginTop: 4,
  },
  tagsHomeHeader: {
    marginBottom: 16,
    marginTop: 4,
  },
  tagsHomeHeaderTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: c.gray900,
    letterSpacing: -0.3,
  },
  tagsHomeHeaderHash: {
    color: c.piktag500,
    fontWeight: '900',
  },
  tagsHomeHeaderSubtitle: {
    fontSize: 13,
    color: c.gray500,
    marginTop: 4,
    lineHeight: 18,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  profileInfo: {
    flex: 1,
    marginLeft: 12,
  },
  profileNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileName: {
    fontSize: 16,
    fontWeight: '600',
    color: c.gray900,
  },
  profileUsername: {
    fontSize: 13,
    color: c.gray500,
    marginTop: 2,
  },
  recentSearchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  recentSearchItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  recentSearchText: {
    flex: 1,
    fontSize: 15,
    color: c.gray700,
  },
  recentSearchDeleteBtn: {
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 4,
  },
  categoryChipsRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    flexDirection: 'row',
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: c.gray100,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  categoryChipActive: {
    backgroundColor: c.piktag50,
    borderColor: c.piktag500,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.gray600,
  },
  categoryChipTextActive: {
    color: c.piktag600,
  },
  });
}
