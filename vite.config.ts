import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      remoteBindings: process.env.HOPON_OFFLINE !== '1',
      config: config => process.env.HOPON_OFFLINE === '1' ? { vars: { ...config.vars, HOPON_OFFLINE: '1' } } : {},
    }),
    tanstackStart(),
    react(),
  ],
})
