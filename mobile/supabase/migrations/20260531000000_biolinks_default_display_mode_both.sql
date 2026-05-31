-- 20260531000000_biolinks_default_display_mode_both.sql
--
-- Flip the biolink default display mode from 'card' to 'both'.
-- Founder direction 2026-05-31: *"原本預設顯示方式是「清單卡片」，
-- 請改成「全部顯示」，我們盡可能把功能都列出來，要不顯示在請使用者
-- 去變更即可"*. The North Star reasoning: every biolink is an
-- add-opportunity surface — defaulting to MAX visibility (icon row
-- AND card row) raises the probability that a viewer notices the
-- connection point, even at a small visual cost. Opt-down is one
-- tap in the edit modal; opt-up (from 'card' to 'both') was a
-- forgotten-default the user had no incentive to discover.
--
-- Two changes here:
--   1) Column default for NEW rows → 'both'. The inline-add flow
--      doesn't pass display_mode in its insert; it relies on the
--      column default. After this migration every new biolink
--      created via that path lands as 'both'.
--   2) Backfill EXISTING rows where display_mode = 'card'. Reasoning:
--      pre-launch the only way a row got 'card' was the old default
--      — the segmented control existed in the edit modal but most
--      users never opened it. Treating the existing 'card' rows as
--      "implicit default" rather than "explicit choice" is the
--      pre-launch-safe call (loud caveat: post-launch we would NOT
--      do this — by then 'card' may be a deliberate user choice
--      and a server backfill would silently override it).
--
-- Rows already at 'icon' (compact-only) or 'both' (max-visibility)
-- are untouched. Onboarding inserts pass `'icon'` explicitly and
-- stay as-is — that's a separate design decision (compact start
-- for the streamlined onboarding flow); revisit if founder asks.

ALTER TABLE piktag_biolinks ALTER COLUMN display_mode SET DEFAULT 'both';

UPDATE piktag_biolinks
SET display_mode = 'both'
WHERE display_mode = 'card';
