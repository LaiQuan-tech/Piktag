# PikTag Database Verification Test Report

**Project:** kbwfdskulxnhjckdvghj (Supabase)
**Test User:** verify3 (`9b2b6291-e1e7-43c1-ac50-8fb358251aea`)
**Date:** 2026-02-26
**Overall Result:** **29/29 PASSED**

---

## 1. Table Existence Tests

| # | Table | Status |
|---|-------|--------|
| 1.1 | `piktag_connections` | PASS |
| 1.2 | `piktag_tags` | PASS |
| 1.3 | `piktag_biolinks` | PASS |
| 1.4 | `piktag_biolink_clicks` | PASS |
| 1.5 | `piktag_tag_snapshots` | PASS |
| 1.6 | `piktag_notifications` | PASS |
| 1.7 | `piktag_notes` | PASS |
| 1.8 | `piktag_profiles` | PASS |

**Details:** All 8 required tables found. Additionally discovered 7 extra tables:
`piktag_connection_tags`, `piktag_conversation_participants`, `piktag_conversations`, `piktag_follows`, `piktag_invites`, `piktag_messages`, `piktag_user_tags`

**Query Result:**
```json
["piktag_biolink_clicks","piktag_biolinks","piktag_connection_tags","piktag_connections",
 "piktag_conversation_participants","piktag_conversations","piktag_follows","piktag_invites",
 "piktag_messages","piktag_notes","piktag_notifications","piktag_profiles",
 "piktag_tag_snapshots","piktag_tags","piktag_user_tags"]
```

---

## 2. Column Existence Tests (CRM Fields)

| # | Column | Data Type | Status |
|---|--------|-----------|--------|
| 2.1 | `birthday` | date | PASS |
| 2.2 | `anniversary` | date | PASS |
| 2.3 | `contract_expiry` | date | PASS |

**Details:** All 3 CRM date columns exist on `piktag_connections` with correct `date` type.

---

## 3. Test Data Integrity

| # | Test | Expected | Actual | Status |
|---|------|----------|--------|--------|
| 3.1 | verify3 connections count | >= 3 | **3** | PASS |
| 3.2 | Total tags count | >= 5 | **7** | PASS |
| 3.3 | verify3 notifications count | >= 4 | **5** | PASS |
| 3.4 | Total biolinks count | >= 2 | **3** | PASS |
| 3.5 | verify3 notes count | >= 1 | **1** | PASS |
| 3.6 | Connections with birthday today (02-26) | >= 1 | **1** | PASS |
| 3.7 | Connections with anniversary today (02-26) | >= 1 | **1** | PASS |

**Details:** All data integrity thresholds met. The test user has sufficient seed data for all verification checks. Birthday and anniversary "today" queries correctly match Feb 26 records.

---

## 4. Trigger Tests

| # | Trigger | Event | Table | Status |
|---|---------|-------|-------|--------|
| 4.1 | `on_biolink_click` | INSERT | piktag_biolink_clicks | PASS |
| 4.2 | `on_tag_snapshot` | INSERT | piktag_tag_snapshots | PASS |

**Details:** Both triggers are active and bound to the correct tables with INSERT event manipulation.

---

## 5. Function Tests

| # | Function | Status |
|---|----------|--------|
| 5.1 | `notify_biolink_click` | PASS |
| 5.2 | `check_tag_trending` | PASS |

**Details:** Both functions exist in the `public` schema.

---

## 6. RLS Policy Tests

| # | Table | Policy Count | Policies | Status |
|---|-------|:------------:|----------|--------|
| 6.1 | `piktag_biolink_clicks` | 3 | Biolink owners can view clicks, Users can view own clicks, Users can insert clicks | PASS |
| 6.2 | `piktag_biolinks` | 4 | biolinks_insert, biolinks_update, biolinks_select, biolinks_delete | PASS |
| 6.3 | `piktag_connection_tags` | 3 | connection_tags_delete, connection_tags_select, connection_tags_insert | PASS |
| 6.4 | `piktag_connections` | 4 | connections_update, connections_select, connections_insert, connections_delete | PASS |
| 6.5 | `piktag_conversation_participants` | 2 | participants_insert, participants_select | PASS |
| 6.6 | `piktag_conversations` | 2 | conversations_insert, conversations_select | PASS |
| 6.7 | `piktag_follows` | 3 | follows_select, follows_delete, follows_insert | PASS |
| 6.8 | `piktag_invites` | 1 | Users can manage own invites | PASS |
| 6.9 | `piktag_messages` | 2 | messages_select, messages_insert | PASS |
| 6.10 | `piktag_notes` | 5 | notes_delete, Users can manage own notes, notes_insert, notes_update, notes_select | PASS |
| 6.11 | `piktag_notifications` | 2 | notifications_update, notifications_select | PASS |
| 6.12 | `piktag_profiles` | 3 | profiles_select, profiles_insert, profiles_update | PASS |
| 6.13 | `piktag_tag_snapshots` | 1 | Anyone can read tag snapshots | PASS |
| 6.14 | `piktag_tags` | 2 | tags_insert, tags_select | PASS |
| 6.15 | `piktag_user_tags` | 3 | user_tags_delete, user_tags_insert, user_tags_select | PASS |

**Details:** 40 RLS policies across 15 tables. All piktag tables have at least one policy. Full CRUD coverage on core tables (connections, biolinks, notes). Read-only public access on tag_snapshots.

---

## 7. Biolink Click Tracking Test (Trigger Integration)

| Step | Description | Result | Status |
|------|-------------|--------|--------|
| 7.1 | Get biolink ID | `7e080737-74de-4467-8b7d-a613ac5e42d3` | PASS |
| 7.2 | Count biolink_click notifications before insert | 1 | -- |
| 7.3 | Insert test click | Insert succeeded (no error) | PASS |
| 7.4 | Count biolink_click notifications after insert | 2 | PASS |

**Details:** The `on_biolink_click` trigger fired the `notify_biolink_click` function correctly. Notification count increased from 1 to 2 after inserting a click, confirming the trigger-to-notification pipeline works end-to-end.

---

## 8. On This Day Data Test

| # | Connection ID | Nickname | Met At | Status |
|---|---------------|----------|--------|--------|
| 8.1 | `b26a20fa-e293-4b6c-ac2b-bf8baabcef8e` | 小花 | 2024-02-26 | PASS |
| 8.2 | `0eb077fe-0022-4a3f-9739-31462acb6d19` | Auto哥 | 2025-02-26 | PASS |

**Details:** 2 connections have `met_at` dates matching today (Feb 26) from previous years. The "On This Day" feature would display: "You met 小花 2 years ago" and "You met Auto哥 1 year ago."

---

## 9. Profile GPS Data Test

| # | Username | Latitude | Longitude | Status |
|---|----------|----------|-----------|--------|
| 9.1 | verify3 | 25.033 | 121.5654 | PASS |
| 9.2 | flowtest | 25.034 | 121.566 | PASS |
| 9.3 | autotest2 | 25.032 | 121.564 | PASS |

**Details:** 3 profiles have GPS coordinates populated. All coordinates are in the Taipei area (~25.03N, 121.56E), confirming realistic test data. The proximity/map features have sufficient data.

---

## 10. Edge Function Tests

| # | Function | Slug | Status | Deployed | Result |
|---|----------|------|--------|----------|--------|
| 10.1 | `daily-crm-check` | daily-crm-check | ACTIVE | Yes | PASS |
| 10.2 | `suggest-tags` | suggest-tags | ACTIVE | Yes | PASS |

**Details:** Both edge functions are deployed and ACTIVE.
- `suggest-tags` (ID: `63cdf9b9-867f-4b5e-afda-dfa8993b8fb4`) -- verify_jwt: false
- `daily-crm-check` (ID: `2ec2db9f-4f23-4248-bf1a-67c6d65a344b`) -- verify_jwt: false

---

## Summary

| Category | Tests | Passed | Failed |
|----------|:-----:|:------:|:------:|
| 1. Table Existence | 8 | 8 | 0 |
| 2. Column Existence (CRM) | 3 | 3 | 0 |
| 3. Data Integrity | 7 | 7 | 0 |
| 4. Triggers | 2 | 2 | 0 |
| 5. Functions | 2 | 2 | 0 |
| 6. RLS Policies | 1 | 1 | 0 |
| 7. Click Tracking (Integration) | 2 | 2 | 0 |
| 8. On This Day | 1 | 1 | 0 |
| 9. Profile GPS | 1 | 1 | 0 |
| 10. Edge Functions | 2 | 2 | 0 |
| **TOTAL** | **29** | **29** | **0** |

**All 29 tests PASSED.** The PikTag Supabase database is fully operational with correct schema, seed data, triggers, functions, RLS policies, and edge functions.
