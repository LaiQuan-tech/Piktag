# PikTag — Claude working memory

> Auto-loaded every session. Read this first. The North Star below is the
> lens for **every** product/UX/scope decision — when in doubt, optimize for it.

## Product North Star — set by the founder (remember this)

**The core of PikTag IS AI tag recommendation: in each context, recommend
the *right* tags.** Everything else serves this.

Why tags are the engine (not a feature — the whole thesis):
- Tags let a user **reactivate dormant connections** by searching tags
  (活化舊有人脈).
- Tags **match new friends** — semantic-concept matching that works across
  language/wording (媒合新朋友).

Therefore the priorities, in order:

1. **Optimize every friend-add opportunity to the extreme.** Every moment a
   connection could happen — QR scan, scan-a-card, search, Ask, contact
   import, share link — must be as frictionless and as likely-to-convert as
   possible. Treat each as precious.
2. **Get non-members in, and get good tag data built on them.** A non-member
   local contact with strong tags is future serendipity fuel. The flows to
   record them, to detect when a scanned person is *already* a member (→
   connect, don't file a dead contact), and to convert non-members to
   members must be excellent.

**How to apply (do this, don't just nod):** when weighing any trade-off,
prefer the option that (a) protects/strengthens AI-tag quality &
cross-language concept matching, (b) increases a real friend-add or
non-member-onboarding conversion, (c) reduces friction on the
`scan → tag → connect` and `search-tag → reactivate` loops. If a request
works *against* this, say so honestly (中肯) rather than just complying.

## How the founder works (keep doing this)

- **中肯 / trust-but-verify.** Give honest, balanced advice; push back with
  reasoning when something is wrong or disproportionate. Verify claims
  (incl. your own and agents') against the actual code/DB before asserting.
  The founder values honest correction over compliance.
- **Don't reinvent; match existing patterns/design.** Reuse canonical
  components, RPCs, styles. Deviating "to be clever" is a defect here.
- **Shared UI = ONE shared component, never per-screen style copies.**
  Per-screen drift (a chip/row/button slightly different on each screen)
  is a recurring defect the founder keeps catching. If a UI element
  exists on >1 screen, it must be a single component reused everywhere —
  fixing it by "aligning the style values" is a stopgap, extracting the
  component is the fix. Canonical shared elements so far:
  `components/TagChip.tsx` (the removable "#tag ×" chip — used by
  EditLocalContact / AddTag / EditProfile "我的標籤"); the AI-suggestion
  chip pattern (gray pill, no "+", purple press-flash, cap 3, opt-in);
  the "尚未加入 PikTag" not-joined row in ConnectionsScreen (local
  contacts + pending scans). Before building any chip/row/pill, check
  if one of these (or an existing component) already covers it.
- **Every change:** `tsc` clean → commit → push. i18n spans **19 locales**
  (`mobile/src/i18n/locales/*.json`) — keep all in sync (JSON round-trip
  into the right block; verify the key landed where intended).
- **DB migrations auto-apply** on push to `main` via
  `.github/workflows/supabase-deploy.yml` (the `db-push` job runs
  `supabase db push` against the linked project). DO NOT ask the
  founder to run SQL by hand — commit, push, watch CI. Files MUST
  use 14-digit `YYYYMMDDHHMMSS_name.sql` format (one row per file in
  `supabase_migrations.schema_migrations` keyed on the prefix —
  duplicate prefixes break the CLI; see 2026-05-27 8-digit incident).
  Keep migrations idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE` /
  `ON CONFLICT DO NOTHING`) so CI re-runs and manual edits don't
  collide. Supabase ref `kbwfdskulxnhjckdvghj`.
- **Repo layout:** real mobile app = `mobile/`; landing = `landing/`
  (Vercel, `dist` gitignored, rebuilt on push; meta in
  `landing/api/*` + `landing/public/*` + `src/main.tsx`). The top-level
  `/src` is a STALE DUPLICATE — ignore it. Repo `LaiQuan-tech/Piktag`.
- **iOS TestFlight** builds on push to `mobile/**` (excl. supabase/scripts);
  `concurrency: cancel-in-progress` collapses bursts. Apple's per-app daily
  upload cap is real → batch mobile commits; a hit is a soft 24h wait.
- **Dark mode is shipped.** Settings → toggle. Canonical pattern for
  any new theme-aware code (founder, 2026-05-23, after three full
  waves of mechanical migration across 80+ files):

  ```tsx
  import { useTheme } from '../context/ThemeContext';
  // ...
  function MyComponent() {
    const { colors, isDark } = useTheme();
    const styles = useMemo(() => makeStyles(colors), [colors]);
    // ...
    return <View style={styles.x}>...</View>;
  }
  function makeStyles(c: ColorPalette) {
    return StyleSheet.create({
      x: { backgroundColor: c.background, color: c.text },
      // ...
    });
  }
  ```

  **EVERY function component that uses `styles` needs its own hooks**
  — including file-scope `React.memo(...)` sub-components (e.g.
  ConnectionsScreen's `ConnectionItem`, the skeleton variants in
  `SkeletonLoader.tsx`). They can't capture `styles` / `colors`
  from a parent's closure. Same for plain helper functions that
  need colors — pass `colors: ColorPalette` as a parameter (see
  `getBiolinkIcon` in FriendDetailScreen).

  **`useCallback`/`useMemo` that builds themed JSX MUST list
  `styles` + `colors` in its deps** — `renderItem`, `listHeader`,
  memoized style arrays, etc. `styles` is a fresh object each theme
  switch; a callback that omits it from deps freezes on whatever
  theme rendered first (the symptom: black list rows on a white
  page, or vice-versa, after the launch theme settles). Plain
  inline `renderItem={() => …}` is safe (recreated each render);
  the trap is only the memoized form.

  StatusBar: `barStyle={isDark ? 'light-content' : 'dark-content'}`.

  NEVER reintroduce hardcoded `COLORS.X` in styles (`COLORS` is the
  light-mode constant only; use it ONLY for true brand-fixed colors
  like #FFFFFF on a piktag500-saturated CTA where the white is
  *intentionally* fixed regardless of theme).

_(Founder explicitly asked the North Star be remembered — 2026-05.)_
