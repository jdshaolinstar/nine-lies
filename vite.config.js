import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works at any URL.
  base: './',
  server: {
    port: 5173,
    fs: {
      // Vite's defaults, plus local config that can hold credentials.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '.mcp.json', '.lingcodedeploy.json', '**/.lingcode/**'],
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
})
