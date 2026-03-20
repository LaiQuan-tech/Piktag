# Test Plan: PikTag-mobile

## Overview
This test plan ensures the stability of the PikTag mobile application (Expo) and its integration with Supabase.

## 1. Environment Verification
- **Goal**: Ensure the local environment is correctly configured.
- **Steps**:
  1. Run `npm install` in the `mobile/` directory.
  2. Check for the presence of `.env` with `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- **Acceptance Criteria**: All dependencies install without errors; environment variables are reachable.

## 2. Build & Startup
- **Goal**: Verify the app can start in web/mobile simulation.
- **Steps**:
  1. Run `npm run web` in `mobile/`.
  2. Verify the Expo QR code or browser window appears.
- **Acceptance Criteria**: App loads the Login/Onboarding screen without crashing.

## 3. CRM Functionality Verification (Manual/Automated)
- **Goal**: Validate birthday and anniversary reminders.
- **Steps**:
  1. Create a connection with a birthday set to the current date.
  2. Refresh the Home Screen.
- **Acceptance Criteria**: The "Today's Reminder" card displays the newly created connection.

## 4. Biolink Click Tracking
- **Goal**: Verify that clicking a social link triggers a notification.
- **Steps**:
  1. Navigate to a Friend Detail page.
  2. Click on a social link (e.g., Instagram).
  3. Check the Notifications tab.
- **Acceptance Criteria**: A new notification entry for "Link Clicked" appears.

## 5. Geo-Location Discovery
- **Goal**: Test location-based contact filtering.
- **Steps**:
  1. Grants location permissions to the app.
  2. Navigate to "Who do I know in this location" from Settings.
- **Acceptance Criteria**: Displays contacts sorted by proximity to the simulated location.

## 6. Regression Testing (Post-Fix)
- **Goal**: Ensure fixed bugs don't resurface.
- **Steps**:
  1. Verify Bell icon navigation to Notifications.
  2. Check Search categories (`SearchScreen`).
- **Acceptance Criteria**: All critical fixes from 2026-02-26 remain functional.
