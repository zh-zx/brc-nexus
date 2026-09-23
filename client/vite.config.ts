import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico'],
      manifest: {
        name: 'CCCAP·BRC 种质资源管理系统',
        short_name: 'CCCAP BRC',
        description: 'CCCAP（国际马铃薯中心亚太中心）种质资源管理系统 - CCCAP Germplasm Resource Management',
        theme_color: '#2e7d32',
        background_color: '#f0fdf4',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // 主 JS 约 3.1MB，必须纳入预缓存，保证 HTML/CSS/JS 缓存状态一致（否则会出现"无样式"错配）
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
              networkTimeoutSeconds: 5
            }
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7800',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:7800',
        ws: true
      }
    }
  }
});
