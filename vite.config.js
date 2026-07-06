import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages 서브패스(https://s10cho.github.io/nuri-world/)에 배포되므로 base 지정.
// public/ 는 Vite publicDir(기본값) — 자산은 그대로 dist 루트로 복사되어
// {base}assets/... 로 서빙된다. 코드는 문서 기준 상대경로 'assets/...' 로 참조하므로
// dev(/nuri-world/) · preview · 배포 모두 동일하게 해석된다.
export default defineConfig({
  base: '/nuri-world/',
  build: {
    outDir: 'dist',
    target: 'es2022',
    assetsInlineLimit: 0, // 배경 이미지는 인라인하지 않고 파일로 유지
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  plugins: [
    // PWA: 오프라인 동작 + 홈 화면 설치. 앱셸(JS/CSS/HTML)은 프리캐시,
    // 용량 큰 이미지와 Google Fonts는 런타임 캐싱(CacheFirst)해 재방문·오프라인 대비.
    VitePWA({
      registerType: 'autoUpdate', // 새 배포 시 백그라운드 갱신 후 다음 로드에 적용
      includeAssets: ['favicon.ico', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png'],
      manifest: {
        name: '누리의 한글 왕국',
        short_name: '누리의 한글 왕국',
        description: '미취학 아동을 위한 한글 학습 모험 게임',
        lang: 'ko',
        start_url: '.',
        scope: '.',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#59b8f2',
        theme_color: '#59b8f2',
        icons: [
          { src: 'assets/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'assets/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // 앱셸만 프리캐시(작음). 이미지·오디오는 런타임 캐싱으로 다운로드-온-유즈.
        globPatterns: ['**/*.{js,css,html}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // 배경·캐릭터 이미지 — 오프라인은 캐시 즉시 서빙, 온라인은 백그라운드 재검증.
            // public 이미지는 콘텐츠 해시가 없어 CacheFirst면 같은 파일명 재배포 시
            // 옛 아트를 무기한 서빙 → SWR로 온라인 방문마다 조용히 갱신(ETag 304라 저비용).
            urlPattern: ({ url }) => url.pathname.includes('/assets/images/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'nuri-images',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // 어린이 친화 폰트(Jua) — 오프라인에서도 유지
            urlPattern: ({ url }) =>
              url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
