import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwind(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'فزعتك',
        short_name: 'فزعتك',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        display: 'standalone',
        background_color: '#0a2552',
        theme_color: '#0f3f8f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // App shell is cached; API calls are never served from cache (data must be live).
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:4000' } },
});
