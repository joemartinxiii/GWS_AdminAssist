#!/bin/bash
# Start frontend in demo mode

cd "$(dirname "$0")/frontend"

# Set demo mode environment variable
export VITE_DEMO_MODE=true

# Start the dev server
npm run dev
