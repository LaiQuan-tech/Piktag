# System Patterns: PikTag

## Tech Stack
- **Framework**: Expo (React Native) for Mobile; Next.js for Web.
- **Language**: TypeScript throughout the stack.
- **Backend-as-a-Service**: Supabase
  - **Database**: PostgreSQL with Row-Level Security (RLS).
  - **Authentication**: Supabase Auth (Email, OAuth).
  - **Realtime**: Subscription to table changes for notifications and click tracking.
  - **Edge Functions**: Daily CRM checks and tag suggestions.
- **UI System**: "Liquid Glass" design language.
  - **Styling**: `lucide-react-native` for icons, `expo-linear-gradient` for glassmorphism effects.
  - **Theming**: Unified `theme.ts` with accent and glass color tokens.

## Architecture Patterns
- **Directory Structure**:
  - `mobile/src/screens`: Functional page components.
  - `mobile/src/components`: Reusable UI elements (e.g., `QrCodeModal`).
  - `mobile/src/lib`: Database client and shared utility libraries.
  - `mobile/src/navigation`: Expo Router / React Navigation stack definitions.
  - `mobile/src/hooks`: Custom hooks for Auth and data fetching.
- **Data Flow**:
  - Unidirectional data flow from Supabase via custom hooks.
  - Supabase Triggers handle secondary actions (e.g., updating notifications on biolink clicks).
- **Communication**: i18next for multi-language support (AR, BN, EN, ES, FR, HI, JA, PT, RU, ZH-CN, ZH-TW).

## Repository Structure
The repository is a hybrid containing:
- `app/`, `public/`, `src/`: Next.js Web application.
- `mobile/`: Expo Mobile application (Primary focus for Phase 2/3).
- Root files (`App.tsx`, `app.json`): Often mirrors or facilitates the mobile build process.

## Key System Components
- **Sync Sentinel**: Logic for detected collaboration via AntiGravity.
- **GEO Discovery**: Integration of `expo-location` with Supabase PostGIS-style queries.
- **CRM Engine**: Edge functions running scheduled tasks for reminder generation.
