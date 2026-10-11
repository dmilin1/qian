/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** Served from https://dmilin1.github.io/qian/ in production. */
const BASE = '/qian/'
/** Light paper color (src/index.css --paper): splash background and browser chrome. */
const PAPER = '#f6f1e7'

export default defineConfig(({ command, isPreview }) => ({
  // The dev server stays at "/" for convenience; `vite build` and `vite preview` use the
  // GitHub Pages base so the preview matches production exactly.
  base: command === 'build' || isPreview ? BASE : '/',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Separate long-lived chunks: a code-only deploy keeps the word data and React cached
          // (and vice versa when only words.json changes).
          groups: [
            { name: 'words', test: /[\\/]src[\\/]data[\\/]words\.json$/ },
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
          ],
        },
      },
    },
    // The words chunk is ~600 kB of JSON data (1000 words with examples), not code.
    chunkSizeWarningLimit: 700,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registration happens in src/components/PwaUpdater.tsx (useRegisterSW).
      injectRegister: false,
      // No service worker in `vite dev`: it would cache modules and fight HMR.
      devOptions: { enabled: false },
      // Icons and favicons are precached through globPatterns below.
      includeManifestIcons: false,
      manifest: {
        id: BASE,
        name: '千 qian - Mandarin by ear',
        short_name: 'qian',
        description: 'Learn the 1000 most common Mandarin words by ear: Taiwan Mandarin audio, tone-colored pinyin and spaced repetition.',
        lang: 'en',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        theme_color: PAPER,
        background_color: PAPER,
        categories: ['education'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + data (words.json and the audio manifest are bundled into the JS).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
        // Audio is never precached (~2000 clips); it is cached at runtime or via Settings.
        globIgnores: ['**/audio/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/audio\//],
        cleanupOutdatedCaches: true,
        // Take control on the first visit, so the app works offline right away.
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: /\/audio\//,
            handler: 'CacheFirst',
            options: {
              // Same cache as Settings > "Download all audio" (src/features/settings/audioCache.ts).
              cacheName: 'qian-audio',
              // No ExpirationPlugin: it would evict clips the learner downloaded on purpose.
              cacheableResponse: { statuses: [200] },
              // Serve 206 slices of cached clips to <audio> Range requests (Safari needs this).
              rangeRequests: true,
              plugins: [
                {
                  // <audio> asks for "Range: bytes=0-"; a 206 can't be cached, so fetch the
                  // whole clip (200) on a miss. Later requests get sliced from the cache.
                  requestWillFetch: async ({ request }: { request: Request }) =>
                    request.headers.has('range') ? new Request(request.url, { credentials: 'same-origin' }) : request,
                },
              ],
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
}))
