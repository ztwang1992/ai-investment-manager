import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The manifest takes literal colors only: keep this the same as --color-bg in src/styles/tokens.css
const BACKGROUND = '#f5ead8';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'AI Investment Manager',
        short_name: 'AI Invest',
        description: 'Every broker, every currency, one portfolio, merged by what you actually own. With an AI advisor that runs on your own key.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: BACKGROUND,
        theme_color: BACKGROUND,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Fonts and icons are precached too, so the app looks complete when opened offline
        globPatterns: ['**/*.{js,css,html,woff2,png}'],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'worker/**/*.test.ts'],
  },
});
