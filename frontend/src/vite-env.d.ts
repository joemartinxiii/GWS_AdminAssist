/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** When `"true"`, starts MSW with mock API (dev only; use with `npm run dev:msw`). */
  readonly VITE_USE_MSW?: string
  readonly VITE_API_URL: string
  readonly VITE_WORKSPACE_DOMAIN: string
  // Add more VITE_ variables here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
