# Event Tag QR Code Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the center `#` button into an Event Tag Launch Pad with QR code generation, tag presets, and scan-to-add-friend flow.

**Architecture:** Redesign the existing `AddTagScreen` modal into a two-state screen (Setup → QR Display). Add new `ScanResultScreen` for the post-scan friend-adding flow. Create two new Supabase tables (`piktag_tag_presets`, `piktag_scan_sessions`) and add `scan_session_id` column to existing `piktag_connections`. Move old tag management into `ProfileScreen`.

**Tech Stack:** React Native (Expo 54), Supabase, react-native-qrcode-svg, TypeScript

**DB Note:** `piktag_connections` already has `met_date` (date) and `met_location` (text) columns. The column for friend reference is `friend_id` (not `connected_user_id` as in the TypeScript type).

---

## Task 1: Database Migrations

**Files:**
- Supabase MCP: project `utlhlkhlzirfjmvcrerm`

**Step 1: Create `piktag_tag_presets` table**

```sql
CREATE TABLE public.piktag_tag_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  location text DEFAULT '',
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz DEFAULT now()
);

ALTER TABLE public.piktag_tag_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own presets"
  ON public.piktag_tag_presets
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

**Step 2: Create `piktag_scan_sessions` table**

```sql
CREATE TABLE public.piktag_scan_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preset_id uuid REFERENCES public.piktag_tag_presets(id) ON DELETE SET NULL,
  event_date date NOT NULL DEFAULT CURRENT_DATE,
  event_location text DEFAULT '',
  event_tags text[] DEFAULT '{}',
  qr_code_data text NOT NULL,
  scan_count integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '24 hours')
);

ALTER TABLE public.piktag_scan_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own scan sessions"
  ON public.piktag_scan_sessions
  FOR ALL
  USING (auth.uid() = host_user_id)
  WITH CHECK (auth.uid() = host_user_id);

CREATE POLICY "Anyone can read active scan sessions"
  ON public.piktag_scan_sessions
  FOR SELECT
  USING (is_active = true);
```

**Step 3: Add `scan_session_id` to `piktag_connections`**

```sql
ALTER TABLE public.piktag_connections
  ADD COLUMN scan_session_id uuid REFERENCES public.piktag_scan_sessions(id) ON DELETE SET NULL;
```

**Step 4: Verify tables created**

Run: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'piktag_%' ORDER BY table_name;`

Expected: See `piktag_tag_presets` and `piktag_scan_sessions` in the results.

**Step 5: Commit** — No local file changes for this task (DB only).

---

## Task 2: Add New TypeScript Types

**Files:**
- Modify: `/Users/aimand/.gemini/File/PikTag-mobile/mobile/src/types/index.ts`

**Step 1: Add `TagPreset` and `ScanSession` types**

Append the following after the existing `TagSnapshot` type (after line 148):

```typescript
export type TagPreset = {
  id: string;
  user_id: string;
  name: string;
  location: string;
  tags: string[];
  created_at: string;
  last_used_at: string;
};

export type ScanSession = {
  id: string;
  host_user_id: string;
  preset_id: string | null;
  event_date: string;
  event_location: string;
  event_tags: string[];
  qr_code_data: string;
  scan_count: number;
  is_active: boolean;
  created_at: string;
  expires_at: string;
  host_user?: PiktagProfile; // joined
};
```

**Step 2: Update `Connection` type to add `scan_session_id`**

In the `Connection` type (around line 47-61), add `scan_session_id` field after `contract_expiry`:

```typescript
export type Connection = {
  id: string;
  user_id: string;
  connected_user_id: string;
  nickname: string | null;
  note: string | null;
  met_at: string | null;
  met_location: string | null;
  birthday: string | null;
  anniversary: string | null;
  contract_expiry: string | null;
  scan_session_id: string | null;
  created_at: string;
  updated_at?: string;
  connected_user?: PiktagProfile; // joined
};
```

**Step 3: Commit**

```bash
cd /Users/aimand/.gemini/File/PikTag-mobile
git add mobile/src/types/index.ts
git commit -m "feat: add TagPreset and ScanSession types, update Connection type"
```

---

## Task 3: Build the Event Tag Setup Screen (new AddTagScreen)

This is the core screen. Replace the entire content of AddTagScreen with the new Event Tag Launch Pad.

**Files:**
- Rewrite: `/Users/aimand/.gemini/File/PikTag-mobile/mobile/src/screens/AddTagScreen.tsx`

**Step 1: Write the complete new AddTagScreen**

The new screen has two states:
- **Setup Mode** (`showQr === false`): date picker, location input, custom tag chips, save-as-preset button, generate QR CTA
- **QR Display Mode** (`showQr === true`): large QR code, event info display, scan count, back-to-edit button

Key implementation details:

```typescript
// State management:
const [mode, setMode] = useState<'setup' | 'qr'>('setup');
const [eventDate, setEventDate] = useState(new Date().toISOString().split('T')[0]); // today
const [eventLocation, setEventLocation] = useState('');
const [eventTags, setEventTags] = useState<string[]>([]);
const [tagInput, setTagInput] = useState('');
const [scanSession, setScanSession] = useState<ScanSession | null>(null);
const [presetsVisible, setPresetsVisible] = useState(false);
const [presets, setPresets] = useState<TagPreset[]>([]);
const [savingPreset, setSavingPreset] = useState(false);
const [presetNameInput, setPresetNameInput] = useState('');
const [showPresetNameInput, setShowPresetNameInput] = useState(false);
```

Header layout:
- Left: Close button (X icon) — `navigation.goBack()`
- Center: Title "# 準備社交"
- Right: Star icon (⭐) — opens presets panel `setPresetsVisible(true)`

Setup mode sections:
1. **Date field**: Shows `eventDate`, tappable to show a simple text input for date (format YYYY-MM-DD). Pre-filled with today.
2. **Location field**: TextInput for `eventLocation`, placeholder "輸入活動地點..."
3. **Custom tags section**: TextInput + add button to push to `eventTags[]`, display as removable chips
4. **Save as template button**: Opens inline name input, saves to `piktag_tag_presets`
5. **Generate QR Code button** (primary CTA, yellow): Creates a `piktag_scan_sessions` row, encodes data as base64 JSON in QR payload, switches to `mode = 'qr'`

QR mode sections:
1. **Header**: "← 返回編輯" left, Share icon right
2. **QR Code**: Using `react-native-qrcode-svg`, value = `https://piktag.app/connect?data=<base64>`
3. **Event info**: date + location + tag chips below QR
4. **Scan count**: fetched from `scanSession.scan_count`
5. **Edit button**: switches back to `mode = 'setup'`

QR payload structure (base64-encoded JSON):
```json
{
  "type": "piktag_connect",
  "v": 1,
  "sid": "<scan_session_id>",
  "uid": "<user_id>",
  "name": "<display_name>",
  "date": "2026-03-09",
  "loc": "台北 101",
  "tags": ["Web3Taipei", "區塊鏈"]
}
```

Supabase operations:
- `generateQrCode()`: Insert into `piktag_scan_sessions`, get back the session ID
- `savePreset()`: Insert into `piktag_tag_presets`
- `loadPresets()`: Select from `piktag_tag_presets` where `user_id = auth.uid()` ordered by `last_used_at desc`
- `applyPreset(preset)`: Fill `eventLocation` and `eventTags` from preset, update `last_used_at`

**Presets panel**: Render as a Modal (bottom sheet style) listing all presets. Each preset card shows name, location, tags. "套用" (Apply) button fills the form. Long-press shows delete confirmation.

UI style notes:
- Follow existing PikTag style: `COLORS.piktag500` for primary buttons, `COLORS.gray100` for input backgrounds
- Rounded chips for tags (borderRadius: 9999)
- Section spacing: paddingTop 24, section titles fontSize 16 fontWeight 700
- Primary CTA: backgroundColor piktag500, borderRadius 14, paddingVertical 14

**Step 2: Verify it compiles**

Check the Expo web preview at `http://localhost:8082` — click the # tab, verify setup form appears.

**Step 3: Commit**

```bash
git add mobile/src/screens/AddTagScreen.tsx
git commit -m "feat: redesign AddTagScreen as Event Tag Launch Pad with QR generation"
```

---

## Task 4: Build the ScanResultScreen

**Files:**
- Create: `/Users/aimand/.gemini/File/PikTag-mobile/mobile/src/screens/ScanResultScreen.tsx`
- Modify: `/Users/aimand/.gemini/File/PikTag-mobile/mobile/src/navigation/AppNavigator.tsx`

**Step 1: Create ScanResultScreen**

This screen is shown after scanning a QR code. It receives decoded QR data via route params.

Route params:
```typescript
type ScanResultParams = {
  sessionId: string;
  hostUserId: string;
  hostName: string;
  eventDate: string;
  eventLocation: string;
  hostTags: string[];
};
```

Screen layout:
1. **Header**: "加為好友" title, close button
2. **Host profile section**: Avatar + name (fetched from `piktag_profiles` using `hostUserId`)
3. **"對方的標籤" section**: Display `hostTags` as selectable chips. Each chip is tappable to toggle selection. "全選" toggle.
4. **"我的標籤" section**: Fetch current user's active event tags from their most recent active scan session (or user_tags as fallback). Display as selectable chips. "全選" toggle.
5. **"確認加為好友" button** (primary CTA):
   - Creates a `piktag_connections` row with `user_id`, `friend_id`, `met_date`, `met_location`, `scan_session_id`
   - Creates `piktag_connection_tags` rows for each selected tag
   - Increments `scan_count` on the scan session
   - Navigates back to home

State:
```typescript
const [hostProfile, setHostProfile] = useState<PiktagProfile | null>(null);
const [selectedHostTags, setSelectedHostTags] = useState<Set<string>>(new Set());
const [selectedMyTags, setSelectedMyTags] = useState<Set<string>>(new Set());
const [myEventTags, setMyEventTags] = useState<string[]>([]);
const [loading, setLoading] = useState(true);
const [submitting, setSubmitting] = useState(false);
```

On mount:
1. Fetch host profile from `piktag_profiles` where `id = hostUserId`
2. Fetch current user's tags from `piktag_user_tags` joined with `piktag_tags`
3. Pre-select all tags from both sides

On confirm:
1. Ensure or find tags in `piktag_tags` table for each selected tag name
2. Insert connection into `piktag_connections`
3. Insert selected tags into `piktag_connection_tags`
4. Update scan session `scan_count` via RPC or direct increment
5. Navigate to HomeTab

**Step 2: Register ScanResultScreen in AppNavigator**

In `/Users/aimand/.gemini/File/PikTag-mobile/mobile/src/navigation/AppNavigator.tsx`:

Add import at line ~36:
```typescript
import ScanResultScreen from '../screens/ScanResultScreen';
```

Add as a modal screen in `MainNavigator` (after line 204, after `AddTagModal`):
```typescript
<RootStack.Screen
  name="ScanResult"
  component={ScanResultScreen}
  options={{ presentation: 'modal' }}
/>
```

**Step 3: Verify it compiles**

Check that the app still loads without errors.

**Step 4: Commit**

```bash
git add mobile/src/screens/ScanResultScreen.tsx mobile/src/navigation/AppNavigator.tsx
git commit -m "feat: add ScanResultScreen for post-scan friend adding flow"
```

---

## Task 5: Move Tag Management to ProfileScreen

**Files:**
- Modify: `/Users/aimand/.gemini/File/PikTag-mobile/mobile/src/screens/ProfileScreen.tsx`
- Modify: `/Users/aimand/.gemini/File/PikTag-mobile/mobile/src/navigation/AppNavigator.tsx`

**Step 1: Create ManageTagsScreen**

Create a new file `/Users/aimand/.gemini/File/PikTag-mobile/mobile/src/screens/ManageTagsScreen.tsx`.

This is essentially the OLD `AddTagScreen` code (the current 571-line file before our Task 3 rewrite). Copy the original logic but change:
- Screen name to `ManageTagsScreen`
- Header title from "標籤管理" stays the same
- Navigation uses `navigation.goBack()` (same as before)

The key sections remain:
1. My Tags — with remove buttons and privacy toggle
2. Add Tag — input with # prefix, privacy toggle (公開/私人)
3. Popular Tags — popular tag chips

**Step 2: Add ManageTagsScreen to ProfileStack**

In `AppNavigator.tsx`, add import:
```typescript
import ManageTagsScreen from '../screens/ManageTagsScreen';
```

Add screen to `ProfileStackNavigator` (after line 93):
```typescript
<ProfileStack.Screen name="ManageTags" component={ManageTagsScreen} />
```

**Step 3: Add "管理我的標籤" button to ProfileScreen**

In `ProfileScreen.tsx`, add a `Tag` icon import from lucide-react-native.

After the action buttons row (after line 284, after the `</View>` closing `actionButtonsRow`), add a new button:

```tsx
{/* Manage Tags Button */}
<TouchableOpacity
  style={styles.manageTagsButton}
  activeOpacity={0.7}
  onPress={() => navigation.navigate('ManageTags')}
>
  <Tag size={18} color={COLORS.piktag600} />
  <Text style={styles.manageTagsText}>管理我的標籤</Text>
</TouchableOpacity>
```

Add styles:
```typescript
manageTagsButton: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 1,
  borderColor: COLORS.gray200,
  borderRadius: 12,
  paddingVertical: 12,
  gap: 8,
  marginBottom: 20,
},
manageTagsText: {
  fontSize: 15,
  fontWeight: '600',
  color: COLORS.piktag600,
},
```

**Step 4: Verify navigation flow**

Open Profile tab → tap "管理我的標籤" → should open ManageTagsScreen.

**Step 5: Commit**

```bash
git add mobile/src/screens/ManageTagsScreen.tsx mobile/src/screens/ProfileScreen.tsx mobile/src/navigation/AppNavigator.tsx
git commit -m "feat: move tag management to ProfileScreen, add ManageTagsScreen"
```

---

## Task 6: Update FriendDetailScreen with "Met Via" Info

**Files:**
- Modify: `/Users/aimand/.gemini/File/PikTag-mobile/mobile/src/screens/FriendDetailScreen.tsx`

**Step 1: Enhance "相識紀錄" section**

The FriendDetailScreen already has a "相識紀錄" (Met Record) section at lines 546-581 that shows `metDate`, `metLocation`, and `connectionNote`. This section already works correctly.

The enhancement is to also show **event tags** from the scan session if the connection was made via QR scan.

After fetching connection data (around line 119), also check if `connData.scan_session_id` exists. If so, fetch the scan session's `event_tags`:

```typescript
// Inside fetchData, after setting connection state:
if (connData?.scan_session_id) {
  const { data: sessionData } = await supabase
    .from('piktag_scan_sessions')
    .select('event_tags')
    .eq('id', connData.scan_session_id)
    .single();
  if (sessionData?.event_tags) {
    setEventTags(sessionData.event_tags);
  }
}
```

Add state:
```typescript
const [eventTags, setEventTags] = useState<string[]>([]);
```

In the "相識紀錄" section JSX, after the existing met_location row (around line 569), add event tags display:

```tsx
{eventTags.length > 0 && (
  <>
    <View style={styles.recordDivider} />
    <View style={styles.recordRow}>
      <Tag size={16} color={COLORS.gray400} />
      <Text style={styles.recordLabel}>活動標籤</Text>
      <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {eventTags.map((tag, i) => (
          <View key={i} style={styles.tagChip}>
            <Text style={styles.tagChipText}>#{tag}</Text>
          </View>
        ))}
      </View>
    </View>
  </>
)}
```

Also update the section visibility condition (line 546) to include `eventTags`:
```tsx
{(metDate || metLocation || connectionNote || eventTags.length > 0) && (
```

**Step 2: Verify display**

Open a friend's detail page to ensure the section renders without errors.

**Step 3: Commit**

```bash
git add mobile/src/screens/FriendDetailScreen.tsx
git commit -m "feat: show event tags from scan session in FriendDetailScreen"
```

---

## Task 7: Run Security Advisors and Final Verification

**Step 1: Run Supabase security advisors**

Use Supabase MCP `get_advisors` for project `utlhlkhlzirfjmvcrerm` with type `security` to check for missing RLS policies on the new tables.

**Step 2: Verify all new tables have RLS enabled**

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'piktag_%'
ORDER BY tablename;
```

**Step 3: Test the full flow in browser**

1. Open `http://localhost:8082` (Expo web)
2. Login
3. Tap # button → verify Event Tag Launch Pad opens
4. Set date, location, add tags
5. Tap "產生 QR Code" → verify QR appears
6. Tap star icon → verify presets panel opens
7. Go to Profile → verify "管理我的標籤" button exists
8. Open a friend detail → verify met record section displays

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address security advisor recommendations and final adjustments"
```

---

## Summary of All Files Changed

| Action | File |
|--------|------|
| Rewrite | `mobile/src/screens/AddTagScreen.tsx` |
| Create | `mobile/src/screens/ScanResultScreen.tsx` |
| Create | `mobile/src/screens/ManageTagsScreen.tsx` |
| Modify | `mobile/src/types/index.ts` |
| Modify | `mobile/src/navigation/AppNavigator.tsx` |
| Modify | `mobile/src/screens/ProfileScreen.tsx` |
| Modify | `mobile/src/screens/FriendDetailScreen.tsx` |
| DB | `piktag_tag_presets` table (new) |
| DB | `piktag_scan_sessions` table (new) |
| DB | `piktag_connections` table (add column) |
