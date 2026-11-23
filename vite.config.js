import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works at any URL.
  base: './',
  server: {
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true }, '/api': 'http://localhost:8787' },
    fs: {
      // Vite's defaults, plus local config that can hold credentials.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '.mcp.json', '.lingcodedeploy.json', '**/.lingcode/**'],
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
})
