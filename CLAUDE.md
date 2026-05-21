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
- **DB migrations** are applied **manually** via Supabase SQL Editor by the
  founder; make them idempotent. Supabase ref `kbwfdskulxnhjckdvghj`.
- **Repo layout:** real mobile app = `mobile/`; landing = `landing/`
  (Vercel, `dist` gitignored, rebuilt on push; meta in
  `landing/api/*` + `landing/public/*` + `src/main.tsx`). The top-level
  `/src` is a STALE DUPLICATE — ignore it. Repo `LaiQuan-tech/Piktag`.
- **iOS TestFlight** builds on push to `mobile/**` (excl. supabase/scripts);
  `concurrency: cancel-in-progress` collapses bursts. Apple's per-app daily
  upload cap is real → batch mobile commits; a hit is a soft 24h wait.
- **Dark mode is post-launch, NOT pre-launch.** Scaffolding is built
  (`ThemeContext` + `COLORS_DARK` palette + Settings has a handler
  wired but no UI). Founder considered shipping pre-launch
  2026-05-23 and we tried; **the migration is bigger than it looks**
  because many screens have file-scope `React.memo(...)` sub-components
  that read `styles` / `colors` from file scope (e.g.
  ConnectionsScreen's `ConnectionItem`, FriendDetail / Search /
  EditProfile all have this pattern). A mechanical `const styles =
  StyleSheet.create({...})` → `function makeStyles(c)` refactor breaks
  those sub-components with `Cannot find name 'styles'`. Real fix per
  sub-component: give it its own `useTheme()` + `useMemo(makeStyles)`,
  which means rewriting prop types + every call site. Realistic effort
  is **5-7 hours focused work + 2h dual-mode QA**, not 2-3 hours. Do
  it post-launch as v1.1. Until then, **new code SHOULD still use
  `useTheme()` + factory `makeStyles`** so we don't accumulate more
  files to migrate later.

_(Founder explicitly asked the North Star be remembered — 2026-05.)_
