# Privacy & Terms Audit

Audited files:
- `/Users/aimand/.gemini/File/PikTag-mobile/web/public/privacy.html` (Last updated: March 30, 2026)
- `/Users/aimand/.gemini/File/PikTag-mobile/web/public/terms.html` (Last updated: March 30, 2026)

Declared Data Safety categories: Name, Email, User ID, Other Info, Precise Location (optional), Photos (optional), Contacts (optional), App Interactions, User-Generated Content, Crash Logs, Diagnostic Data, Device ID.

Declared third parties: Supabase, Google Sign-In, Apple Sign-In, Sentry (crash), PostHog (analytics).

Delete account URL: https://pikt.ag/delete-account.

Target audience: 13+.

---

## Privacy Policy (privacy.html)

### Missing (blocking for Google Play)

- **Crash logs via Sentry NOT disclosed.** Data Safety declares Crash Logs, but Sentry is not named in the policy. Google Play requires every third-party SDK that collects crash/diagnostic data to be disclosed.
- **Diagnostic data via PostHog NOT disclosed.** Data Safety declares Diagnostic Data, but PostHog / analytics are not mentioned. The only analytics-adjacent statement is "Usage data: interactions, QR scans, tag activity" which does not identify the processor.
- **Device IDs / push tokens NOT disclosed.** Data Safety declares Device ID. Policy does not mention device identifiers, advertising IDs, APNs/FCM push tokens, or installation IDs.
- **Photos NOT disclosed.** Data Safety declares Photos (optional). Policy lists "profile photo" only; it does not cover camera/photo library access for tags, QR scans of images, or any gallery usage.
- **Precise Location NOT disclosed.** Data Safety declares Precise Location (optional), but the policy only says "approximate location for nearby features." This is a direct mismatch with what was declared to Google Play and must be reconciled (either update policy to cover precise location, or amend Data Safety).
- **Google Sign-In and Apple Sign-In NOT listed as service providers.** Only "Supabase" and "Google for AI features" are named. Identity providers must be disclosed.
- **Account deletion URL (https://pikt.ag/delete-account) NOT linked.** The policy says users can delete "from Settings" but does not surface the public web URL submitted to Google Play. Play reviewers expect a clickable link.
- **User rights are incomplete.** Only delete/deactivate are mentioned. Missing: right to access, right to correct, right to export/portability. Required under Google Play user data policy and GDPR/CCPA.
- **Children's privacy policy contradicts the declared audience.** Policy says "not intended for users under 13" but the declared target audience is "13+" (i.e., 13-year-olds are in scope). The section should clarify that the minimum age is 13, not imply under-13 is the only cutoff; and if targeting minors 13-17, should reference appropriate safeguards. Additionally, no COPPA statement is present (U.S. users under 13).

### Missing (should add)

- **International data transfers.** Supabase, Sentry, PostHog, and Google are all U.S./EU-hosted. Policy has no data-transfer clause (GDPR Art. 44 / standard contractual clauses).
- **Legal bases for processing** (GDPR) — consent, contract, legitimate interest.
- **Separate privacy contact vs. support contact** is present (privacy@pikt.ag) but no postal address / data controller identity beyond "PikTag Inc."
- **AI features disclosure.** "Google for AI features" is vague — should specify which Google AI service, what data is sent, and whether prompts include user content.
- **Notifications / push token purpose.** No mention that push notifications require a device token.
- **Data categories table** mapping each category to purpose + retention + sharing (Google Play strongly prefers this; Data Safety form mirrors it).
- **Security incident / breach notification commitment.**
- **Do Not Sell / Share (CCPA)** statement for California users.
- **Cookies / local storage** on the web properties (privacy.html itself, biolink pages).

### Already covered

- Last-updated date present (March 30, 2026).
- Contact email: privacy@pikt.ag.
- "We do NOT sell your personal information" statement.
- Account info, profile data, contacts (with permission), usage data named.
- Retention: 30 days after deletion.
- Supabase named as storage provider with Row Level Security note.
- Policy update notification commitment.
- Privacy controls (4 visibility levels, block/report) described.

---

## Terms of Service (terms.html)

### Missing (blocking for Google Play)

- None blocking for Play submission (Play scrutinizes the Privacy Policy, not ToS, for data-handling. ToS is adequate for submission.)

### Missing (should add)

- **Minimum age wording is thin.** Says "at least 13" but no language about parental consent for 13–17 where local law requires (e.g., South Korea, some EU states set minimum consent age at 16).
- **DMCA / copyright takedown process.** User-generated content (biolinks, tags, photos) is in scope and Play expects a takedown mechanism. Missing designated DMCA agent or takedown email.
- **User content license scope.** Current license ("grant PikTag a license to display your public content") is vague. Should specify: non-exclusive, worldwide, royalty-free, duration, sublicense rights, and that it terminates on deletion (subject to backup retention).
- **Warranty disclaimer should be ALL CAPS** per common-law enforceability conventions (currently lowercase).
- **Limitation of liability cap.** No dollar/amount cap or 12-month fee cap — pure indirect-damages exclusion is weaker than standard.
- **Indemnification clause** by user for their content / misuse.
- **Dispute resolution / venue** — governing law is Taiwan but no venue/arbitration clause or class-action waiver.
- **Changes to Terms** — no clause describing how Terms can be updated and how users are notified (privacy policy has one; terms does not).
- **Severability, entire agreement, assignment, force majeure** — standard boilerplate missing.
- **Subscription / payment terms** are deferred ("Pricing will be announced separately"). Once IAP launches, Play requires refund policy and auto-renewal disclosures before the update ships.
- **Export controls / sanctions** — standard clause absent.
- **Account termination grace period.** Termination section is one-sided (PikTag may terminate); should state data-retention behavior on user-initiated termination too, and any reactivation window.

### Already covered

- Age requirement (13+) present.
- User-generated content ownership and license grant.
- Prohibited uses (harass, spam, fake accounts, scraping, reverse-engineer).
- Termination by PikTag with appeal path (support@pikt.ag).
- Disclaimer of warranties ("as is").
- Limitation of liability (indirect/incidental/consequential).
- Governing law (Taiwan).
- Contact (support@pikt.ag).
- Last-updated date (March 30, 2026).
- QR code / tag rules.
- Account security responsibility.

---

## Verdict

**NEEDS UPDATE** — Privacy Policy is not compliant with the Data Safety declaration. This is a material mismatch and is the #1 reason Google Play rejects apps at policy review.

### Top 3 fixes (privacy.html)

1. **Add a "Third-party service providers" section listing Sentry (crash reporting), PostHog (product analytics), Supabase (database/auth), Google Sign-In, Apple Sign-In, and any Google AI service used.** Name each, state what data flows there, and link to their policies.
2. **Add disclosure for Crash Logs, Diagnostic Data, Device IDs / push tokens, Photos (camera + library), and Precise Location** so the policy matches every category declared in Data Safety. Precise Location wording in particular currently says "approximate" — either fix policy or fix the Data Safety form (they must agree).
3. **Add user rights (access / correct / delete / export), link https://pikt.ag/delete-account, and fix the Children section** to align with the declared 13+ audience (include COPPA statement for U.S. under-13, parental-consent note for jurisdictions requiring it, and remove the "not intended for users under 13" framing that contradicts the Play audience declaration).

Terms of Service is acceptable for initial Play submission but should pick up DMCA takedown, dispute-resolution venue, and a proper UGC license scope before public launch.
