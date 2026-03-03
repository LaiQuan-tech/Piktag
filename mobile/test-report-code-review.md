# Code Review Report

## Critical Issues (will cause crash/error)

- **[LocationContactsScreen.tsx:109-118]**: The `addr` variable is used outside its `try` block scope. The variable `addr` is declared with `const [addr]` on line 65 inside a nested `try` block (lines 64-71), but is referenced again on line 114 in the `metHere` filter callback, which runs outside that `try` block. In JavaScript, `const`/`let` are block-scoped, so `addr` is not accessible in the outer scope. This will cause a `ReferenceError: addr is not defined` crash at runtime whenever there are connections with `met_location` set, because the filter function on line 114 references `addr` which is only in scope within lines 64-71.

- **[SearchScreen.tsx:415-419]**: Operator precedence bug in `showTags` boolean expression. The expression is:
  ```
  const showTags =
    activeCategory !== 'nearby' &&
    activeCategory !== 'verified' &&
    activeCategory !== 'recent' ||
    activeCategory === 'nearby_tags';
  ```
  Due to `&&` having higher precedence than `||`, this evaluates as `(A && B && C) || D`. This means `showTags` is **always true** when `activeCategory === 'nearby_tags'`, but it is also incorrectly true when `activeCategory` is anything other than `'nearby'`, `'verified'`, or `'recent'` (e.g., `null` or `'popular'`), even during search results for profiles. The likely intended logic requires parentheses: `(activeCategory !== 'nearby' && activeCategory !== 'verified' && activeCategory !== 'recent') || activeCategory === 'nearby_tags'`, or more likely a completely different grouping. As written, tags will incorrectly show alongside profile-only categories.

- **[SocialStatsScreen.tsx:113-121]**: Nested `await` inside `Promise.all` creates a sequential dependency that defeats parallelism and can cause unexpected behavior. The `connectionTagsResult` query contains a nested `await` for fetching connection IDs:
  ```
  .in('connection_id',
    (await supabase.from('piktag_connections').select('id').eq('user_id', user.id)).data?.map(...) || []
  )
  ```
  This inner `await` runs sequentially **before** `Promise.all` even starts, because JavaScript evaluates the arguments to `Promise.all` eagerly. If `data` is null (e.g., network error), it falls back to `[]` which is safe, but the nested await means this query blocks all other parallel queries from starting. This is a performance bug and architectural issue, though it does not crash.

- **[AppNavigator.tsx]**: `NotificationsScreen` is never imported or registered in any navigator. The file exists at `src/screens/NotificationsScreen.tsx` but is not imported in `AppNavigator.tsx` and has no route defined in any stack or tab navigator. This means the Notifications screen is completely unreachable from navigation. Any attempt to navigate to it will crash.

## Major Issues (incorrect behavior)

- **[FriendDetailScreen.tsx:339-348]**: `handleOpenLink` fires a Supabase insert for click tracking but never checks the result for errors. The `.then(() => {})` swallows all errors silently. More critically, if the Supabase insert fails (e.g., RLS policy violation, network error), the user will have no indication. The `Linking.openURL(url).catch(() => {})` also silently swallows errors for invalid URLs -- the user will tap a link and nothing happens with no error feedback.

- **[FriendDetailScreen.tsx:357-362]**: The date validation regex `^\d{1,2}-\d{1,2}$` allows invalid dates like `99-99` or `0-0`. The subsequent padding `dateStr.padStart(5, '0')` will only work correctly for strings like `3-15` -> `03-15` but will produce incorrect results for `12-5` because `padStart(5, '0')` pads the total string to 5 characters, turning `12-5` into `012-5` instead of the intended `12-05`. The logic should pad month and day separately.

- **[FriendDetailScreen.tsx:394-401]**: `formatReminderDate` creates a `new Date(dateStr)` from strings like `2000-03-15`. The `new Date()` constructor with date-only strings is parsed as UTC, so `d.getMonth()` and `d.getDate()` using local time may return the wrong day depending on timezone offset (e.g., UTC-8 would shift `2000-03-15T00:00:00Z` to March 14 in local time).

- **[ConnectionsScreen.tsx:651]**: The header displays a hardcoded date and location string `#2025年3月29日` and `#台北市大安區`. This appears to be a development placeholder that was never replaced with dynamic values. Users will always see this static date regardless of the actual date.

- **[SocialStatsScreen.tsx:263-284]**: The time range selector (`week`/`month`/`all`) UI is rendered and the state `timeRange` is updated, but `fetchStats` is not re-called when `timeRange` changes. The displayed data always shows "all time" stats regardless of which time range button is selected. The `useEffect` on line 70-72 only depends on `[user]`, not on `timeRange`, so changing the time range has zero effect on the displayed data. The stat cards always show the same numbers.

- **[SocialStatsScreen.tsx:139-143]**: The biolink clicks query fetches **all** biolink clicks in the database that were not clicked by the current user (`.not('clicker_user_id', 'eq', user.id)`), then client-side filters for the user's own biolinks. For a large dataset this could return thousands of irrelevant rows. More importantly, it lacks a server-side filter for the user's own biolinks, making it extremely inefficient.

- **[ConnectionsScreen.tsx:196]**: Empty `catch {}` block in `fetchOnThisDay` silently swallows all errors with no logging. Same issue on lines 228 (`fetchCrmReminders`). If these functions fail, the user gets no feedback and debugging is impossible.

- **[types/index.ts]**: The `Connection` type is missing `birthday`, `anniversary`, and `contract_expiry` fields that are used extensively in `FriendDetailScreen.tsx` (lines 121-123) and `ConnectionsScreen.tsx` (lines 216-223). This means TypeScript will report type errors when accessing `connData.birthday`, `connData.anniversary`, `connData.contract_expiry`, `c.birthday`, `c.anniversary`, and `c.contract_expiry`. The code likely compiles only because of `any` type casts elsewhere, but this is a type safety gap.

- **[NotificationsScreen.tsx:33-53]**: The CRM tab filter checks for notification types `'biolink_click'`, `'reminder'`, `'birthday'`, `'anniversary'`, `'contract_expiry'`, but there is no notification type for "on this day" events or "note" events. If the server sends notification types that are not in any filter (e.g., `'on_this_day'`, `'note_added'`, `'message'`), they will appear in the "All" tab but not in any specific tab, making them undiscoverable.

- **[SearchScreen.tsx:199-206]**: The nearby profiles distance sorting uses Euclidean distance on lat/lng coordinates (`Math.sqrt(Math.pow(...))`) instead of haversine distance. This is inaccurate because 1 degree of longitude varies by latitude. Near the equator 1 degree longitude is ~111km, but at 60N it is ~55km. In Taiwan (latitude ~25), the distortion is moderate but still causes incorrect ordering of nearby profiles.

- **[ConnectionsScreen.tsx:404-408]**: When the user selects "nearby" sort, their profile location is silently updated in Supabase with `.then(() => {})`. This fire-and-forget pattern means if the update fails, the user's profile location could be stale or missing. The same pattern appears in `SearchScreen.tsx:179-183` and `LocationContactsScreen.tsx:74-78`.

## Minor Issues (cosmetic/improvement)

- **[FriendDetailScreen.tsx:82]**: `route.params || {}` provides a fallback, but if `route.params` is undefined, both `connectionId` and `friendId` will be undefined, and the component will show a loading spinner forever (since `fetchData` returns early when `!friendId`). There is no user-facing error or fallback for missing params.

- **[FriendDetailScreen.tsx:344-345]**: The `handleOpenLink` Supabase insert `.then(() => {})` is a fire-and-forget pattern. The empty `.then()` callback is unnecessary and could be removed or replaced with proper error handling.

- **[FriendDetailScreen.tsx:519]**: The "manage tags" button (`<TouchableOpacity>` on line 519) has no `onPress` handler that does anything meaningful -- it is essentially a dead button.

- **[ConnectionsScreen.tsx:187-193]**: `fetchOnThisDay` filters connections client-side by matching month and day. This fetches ALL connections with `met_at` from the server and filters in memory. For users with hundreds of connections, this is wasteful.

- **[SearchScreen.tsx:100-103]**: `loadPopularTags` and `loadRecentSearches` are called in a `useEffect` with no dependency array cleanup. The functions are not wrapped in `useCallback` and are called directly, which works but could cause stale closure issues if the component is unmounted and remounted quickly.

- **[SearchScreen.tsx:139]**: The `catch {} finally {` syntax lacks a space before `finally` which, while syntactically valid, is unusual formatting.

- **[LocationContactsScreen.tsx:199]**: The FlatList `data={[...contacts]}` creates a new array copy on every render, which is unnecessary and causes the FlatList to re-render all items even if `contacts` has not changed.

- **[LocationContactsScreen.tsx:204-261]**: The `ListFooterComponent` renders `metLocationContacts` manually with `.map()` instead of including them in the FlatList data. This means the footer content does not benefit from FlatList virtualization, which could be a performance issue if there are many met-location contacts.

- **[SettingsScreen.tsx:70]**: `setIsPublic(data.is_public)` does not handle the case where `data.is_public` is `null` or `undefined`. If the database field is nullable, this could set the switch to an indeterminate state.

- **[SocialStatsScreen.tsx:346-349]**: The top tag bar width uses a string percentage `${...}%` which is not valid in React Native's `width` style property. React Native requires `width` to be a number (pixels) or a `DimensionValue`. A string like `"85%"` may work in some RN versions but is technically incorrect and may cause warnings.

- **[ConnectionsScreen.tsx:489]**: `getSortedConnections()` is called on every render (not memoized with `useMemo`). While it is wrapped in `useCallback`, it is invoked directly as `const sortedConnections = getSortedConnections()`, meaning it runs every render. Using `useMemo` would be more appropriate for a computed value.

- **[FriendDetailScreen.tsx:508-514]**: Navigating to chat uses `navigation.navigate('LikesTab', { screen: 'ChatDetail', params: {...} })`. This navigates across tab navigators which works but creates a UX inconsistency -- the user leaves the Home tab and ends up on the Likes tab. The user may not realize they have switched tabs.

- **[theme.ts]**: Missing `gray300` color constant. `ContactSyncScreen.tsx` references `COLORS.gray300` but it is not defined in the theme. This will evaluate to `undefined`, which React Native may ignore or cause a style warning.

- **[NotificationsScreen.tsx:182-218]**: Tapping a notification only marks it as read but does not navigate to the related content (e.g., tapping a follow notification should navigate to that user's profile). This is a missing feature that makes notifications less useful.

- **[FriendDetailScreen.tsx:106-218]**: The `fetchData` function makes 8+ sequential Supabase queries (connection, profile, tags, notes, biolinks, my connections, friend connections, my tags, friend connections list, friend tags). This results in a waterfall of network requests. Many of these could be parallelized with `Promise.all` to significantly reduce load time.

## Summary

Total issues found: 26 (Critical: 4, Major: 10, Minor: 12)

### Key Risk Areas:

1. **LocationContactsScreen** has a guaranteed crash due to `addr` variable scope issue.
2. **SearchScreen** has a logic bug in `showTags` due to operator precedence that causes incorrect content display.
3. **AppNavigator** is missing the NotificationsScreen route entirely, making notifications unreachable.
4. **SocialStatsScreen** time range selector is non-functional (UI only, no data filtering).
5. **Connection type** is missing CRM fields (`birthday`, `anniversary`, `contract_expiry`), which undermines type safety across multiple screens.
6. **FriendDetailScreen** date parsing has timezone and validation issues that will produce incorrect results for some users.
