# Event Tag QR Code - Design Document

## Date: 2026-03-09

## Overview

Transform the center `#` button from a personal tag manager into an **Event Tag Launch Pad** — enabling users to quickly set up event-specific tags (date, location, custom tags), generate a QR code for new contacts to scan, and streamline the friend-adding process with tag matching.

## User Stories

1. As a user attending an event, I want to quickly set up tags (date, location, custom) so I can share them via QR code with new contacts.
2. As a user, I want to save frequently used tag combinations as templates so I can reuse them at recurring events.
3. As a scanning user (existing), I want to see both my tags and the host's tags so I can choose which ones to apply when adding a friend.
4. As a scanning user (new), I want to be guided to register so I can complete the friend connection later.

## Approach

**Chosen: Redesign existing `#` Modal (Option B)**

- Keep the 5-tab navigation structure intact
- Repurpose AddTagScreen modal as the new Event Tag Launch Pad
- Move original "manage personal tags" functionality to ProfileScreen
- Minimal navigation changes, maximum impact

## Screen Designs

### 1. # Button -> Event Tag Launch Pad (New AddTagScreen)

**State A: Setup Mode (Default)**
- Header: Close (X) left, Presets star icon right
- Title: "# Ready to Network" / "# 準備社交"
- Date field: defaults to today, tap to open date picker
- Location field: text input for venue name
- Custom tags: add/remove tag chips
- "Save as Template" button
- Primary CTA: "Generate QR Code" (yellow/gold)

**State B: QR Code Display Mode**
- Header: Back arrow left, Share icon right
- Large QR Code centered
- Below QR: date, location, tag chips displayed
- Scan count statistic
- "Edit Tag Settings" button to return to setup

### 2. Presets Panel (Top-right star button)

- Bottom sheet or side panel listing saved templates
- Each template card shows: name, date pattern, location, tags
- Tap "Apply" to load template into setup form
- Long-press to delete a template
- Sorted by last_used_at descending

### 3. Scan & Add Friend Flow

**For existing PikTag users:**
- New screen: `ScanResultScreen`
- Shows scanned user's avatar, name, username
- Two sections:
  - "Their Tags": host's event tags (date, location, custom) — individually selectable
  - "My Tags": scanner's own active tags — individually selectable
- "Select All" toggle per section
- Primary CTA: "Confirm Add Friend"
- On confirm: creates Connection with selected tags as ConnectionTags

**For non-users:**
- QR code encodes a deep link URL
- Opens web landing page showing host's public tag info
- Download App CTA + pending friend invitation
- After registration, auto-prompt to complete the friend connection

### 4. Other Page Adjustments

| Page | Change |
|------|--------|
| **ProfileScreen** | Add "Manage My Tags" entry point (migrated from old AddTagScreen) |
| **FriendDetailScreen** | Show "Met At" section with date + location from connection tags |
| **AppNavigator** | # tab press opens redesigned AddTagScreen modal |
| **ConnectionsScreen** | No changes needed — new friends appear with event tags |

## Data Model Changes

### New Table: `piktag_tag_presets`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | FK to piktag_profiles |
| name | text | Template name (e.g., "Web3 Taipei Weekly") |
| location | text | Default location |
| tags | text[] | Array of custom tag names |
| created_at | timestamptz | Creation timestamp |
| last_used_at | timestamptz | Last usage timestamp |

### New Table: `piktag_scan_sessions`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| host_user_id | uuid | FK to piktag_profiles (QR code displayer) |
| preset_id | uuid | FK to piktag_tag_presets (nullable) |
| event_date | date | Event date |
| event_location | text | Event location |
| event_tags | text[] | Custom tags for this session |
| qr_code_data | text | Encoded QR payload |
| scan_count | integer | Number of scans |
| is_active | boolean | Whether session is still active |
| created_at | timestamptz | Creation timestamp |
| expires_at | timestamptz | Expiration (default: end of day) |

### Modified Table: `piktag_connections`

Add columns:
- `met_date` (date) — when the connection was made
- `met_location` (text) — where the connection was made
- `scan_session_id` (uuid, nullable) — FK to scan_sessions

### New TypeScript Types

```typescript
interface TagPreset {
  id: string;
  user_id: string;
  name: string;
  location: string;
  tags: string[];
  created_at: string;
  last_used_at: string;
}

interface ScanSession {
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
}
```

## QR Code Payload Structure

```json
{
  "type": "piktag_connect",
  "version": 1,
  "session_id": "uuid",
  "user_id": "uuid",
  "username": "string",
  "display_name": "string",
  "event_date": "2026-03-09",
  "event_location": "Taipei 101",
  "tags": ["Web3Taipei", "Blockchain"]
}
```

Encoded as: `piktag://connect?data=<base64_encoded_json>`

For non-app users, fallback URL: `https://piktag.app/connect?data=<base64_encoded_json>`

## Key Technical Decisions

1. **QR uses deep link** — `piktag://connect?data=...` with web fallback for non-users
2. **Session expiry** — scan sessions default to end-of-day expiry
3. **Tag presets are user-scoped** — each user manages their own templates
4. **Connection tags** — selected tags from both sides are stored as ConnectionTags with source metadata
5. **Existing camera** — app already has `expo-camera` dependency for QR scanning
