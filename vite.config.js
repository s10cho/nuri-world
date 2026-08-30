import { rm } from 'node:fs/promises';
import path from 'node:path';

import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { voiceRecorderPlugin } from './tools/vite-plugin-voice-recorder.mjs';

// CAP=1 이면 Capacitor(네이티브 앱) 빌드. 앱은 자산을 루트(capacitor://localhost/,
// https://localhost/)에서 서빙하므로 base:'/' 여야 하고, 오프라인은 네이티브가 자산을
// 번들해 기본 제공하므로 서비스워커(PWA)는 넣지 않는다(커스텀 스킴에서 SW 등록 불안정).
const isNative = process.env.CAP === '1';

// 녹음·검수용 개발 페이지. 웹(GitHub Pages)에는 남겨 둬야 휴대폰으로 녹음을 검증할 수
// 있지만, 스토어에 올라가는 앱 바이너리에 내부 도구가 들어갈 이유는 없다(1.2MB).
// publicDir 복사는 통째로 일어나므로 네이티브 빌드에서만 끝나고 덜어 낸다.
const DEV_PAGES = ['voice-check.html', 'voice-scripts.html', 'voice-recorder.js', 'voice-recorder.css'];

/** @returns {import('vite').Plugin} */
function stripDevPages(outDir) {
  return {
    name: 'nuri-strip-dev-pages',
    apply: 'build',
    async closeBundle() {
      for (const name of DEV_PAGES) await rm(path.join(outDir, name), { force: true });
      this.info?.(`네이티브 빌드: 개발 페이지 ${DEV_PAGES.length}개 제외`);
    },
  };
}

// GitHub Pages 서브패스(https://s10cho.github.io/nuri-world/)에 배포되므로 base 지정.
// public/ 는 Vite publicDir(기본값) — 자산은 그대로 dist 루트로 복사되어
// {base}assets/... 로 서빙된다. 코드는 문서 기준 상대경로 'assets/...' 로 참조하므로
// dev(/nuri-world/) · preview · 배포 모두 동일하게 해석된다.
export default defineConfig({
  base: isNative ? '/' : '/nuri-world/',
  build: {
    outDir: 'dist',
    target: 'es2022',
    assetsInlineLimit: 0, // 배경 이미지는 인라인하지 않고 파일로 유지
  },
  // vitest 는 저장소 전체를 훑는다. .claude/worktrees/ 에는 다른 세션이 만든 작업 사본이
  // 들어 있어, 그대로 두면 같은 테스트가 여러 벌 돌고(13개 → 19개) 옛 코드의 실패까지
  // 섞여 들어온다. 실제 테스트는 tests/ 하나뿐이므로 사본은 제외한다.
  test: { exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'] },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  plugins: [
    // 개발 서버 전용: 녹음 페이지(/voice-scripts.html)가 녹음한 음성을
    // public/assets/audio/ko/ 에 저장하고 manifest를 갱신하는 API. 빌드에는 포함되지 않는다.
    voiceRecorderPlugin(),
    ...(isNative ? [stripDevPages('dist')] : [
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
        // 앱셸 + 서브셋 폰트(작음)를 프리캐시. 이미지는 런타임 캐싱으로 다운로드-온-유즈.
        // 폰트는 이제 자체 호스팅(해시된 woff2)이라 프리캐시로 완전 오프라인.
        globPatterns: ['**/*.{js,css,html,woff2}'],
        navigateFallback: 'index.html',
        // 앱과 별개인 단독 페이지들은 앱 셸로 대체하면 안 된다.
        // (서비스워커가 /voice-check.html 요청을 index.html 로 바꿔치기해 게임이 뜨던 문제)
        navigateFallbackDenylist: [/voice-check\.html$/, /voice-scripts\.html$/, /privacy\.html$/],
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
        ],
      },
    }),
    ]),
  ],
});
