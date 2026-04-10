# Central demo data

All demo/placeholder data for the application lives in `demoData.ts`. Pages and services import from here so that:

- **Consistency** – Same users, files, calendars, permissions, etc. across Drive, Calendar, Users, Groups, Email Delegation, Shared Drives, Email Signatures, and Security Audit.
- **Single toggle** – Demo mode is controlled by `VITE_DEMO_MODE`; use `isDemoMode()` from this module instead of reading the env var elsewhere.
- **Easier testing and deployment** – To disable demo mode (e.g. production or integration tests), set `VITE_DEMO_MODE=false` or omit it. No need to hunt for inline demo data in multiple files.

## Usage

```ts
import { isDemoMode, users, driveFiles, getDemoCalendarEvents } from '../data/demoData';

if (isDemoMode()) {
  setData(users);
}
```

## Disabling demo mode

- **Local / env:** In `frontend/.env` or `frontend/.env.local`, set `VITE_DEMO_MODE=false` or remove the variable.
- **Build:** Ensure the build environment does not set `VITE_DEMO_MODE=true` for production.
