import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
            },
          },
          {
            urlPattern: /^https:\/\/tilecache\.rainviewer\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'rainviewer-tiles',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7
              },
            },
          }
        ]
      },
      manifest: {
        name: 'GriboLocation',
        short_name: 'Gribo',
        description: 'Mushroom Hunting GPS Tracker',
        theme_color: '#1e293b',
        display: "standalone",
        icons: [
          {
            src: 'https://cdn-icons-png.flaticon.com/512/3594/3594247.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  // Use esbuild for CSS minify — lightningcss native binary missing on this platform
  build: {
    cssMinify: false,
    minify: 'esbuild',
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});
