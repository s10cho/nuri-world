import { defineConfig } from 'vite';

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
});
