#!/bin/bash
# Local UI development with mocked API (MSW). No backend or Google OAuth required.
# Uses the same auth flow shape as production: session token + API responses are mocked.

cd "$(dirname "$0")/frontend"
export VITE_USE_MSW=true
npm run dev
