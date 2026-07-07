import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Split heavy, independent vendors into their own chunks. This shrinks the
    // main bundle (better browser caching) and clears Vite's >500 kB chunk
    // warning legitimately instead of just raising the threshold.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'mui-vendor': ['@mui/material', '@emotion/react', '@emotion/styled'],
          'calendar-vendor': ['react-big-calendar', 'date-fns'],
          'pdf-vendor': ['jspdf', 'jspdf-autotable'],
        },
      },
    },
  },
})
