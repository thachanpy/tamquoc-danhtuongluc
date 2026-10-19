import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Cấu hình Vite + Phaser + PWA.
 * - Dev: proxy `/api` → Fastify (127.0.0.1:3000), giữ nguyên như bản SolidJS cũ.
 * - Build: `vite-plugin-pwa` sinh service worker (workbox) + manifest PWA.
 */
export default defineConfig({
  plugins: [
    VitePWA({
      // Tự cập nhật khi có bản build mới; tự chèn script đăng ký service worker.
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'icons/*.png'],
      manifest: {
        name: 'Tam Quốc: Vô Song',
        short_name: 'Vô Song',
        description: 'Game sưu tầm thẻ tướng Tam Quốc.',
        lang: 'vi',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#030712',
        theme_color: '#2a0f0c',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Chỉ precache "app shell" (JS/CSS/HTML + icon nhỏ). Ảnh tướng/ngọc/âm thanh
        // nạp theo nhu cầu và cache lúc chạy để tránh tải hàng chục MB ngay lần đầu.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          // Dữ liệu người chơi: luôn ra mạng, không cache.
          { urlPattern: /^\/api\//, handler: 'NetworkOnly' },
          {
            // Ảnh tướng/khung/ngọc/theme: hiện bản cache, cập nhật ngầm.
            urlPattern: /\/(generals|frames|gem|theme|icons)\/.*\.(webp|png|svg)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'tq-artwork',
              expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 3600 },
            },
          },
          {
            // Nhạc nền và SFX: ít đổi, ưu tiên cache.
            urlPattern: /\/audio\/.*\.(mp3|wav)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tq-audio',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 24 * 3600 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    target: 'es2022',
    // Bundle Phaser khá lớn — nâng ngưỡng cảnh báo cho gọn log build.
    chunkSizeWarningLimit: 4000,
  },
  optimizeDeps: { include: ['phaser'] },
});
