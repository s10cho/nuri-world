// 스토어 등록용 스크린샷 캡처 — 1920×1080(16:9) 가로.
//
// Google Play는 짧은 변 1080px 이상 · 16:9 가로를 갖춘 스크린샷 4장 이상이어야
// 큰 추천 영역에 노출된다. 브라우저 창 캡처로는 그 크기를 정확히 맞출 수 없어
// headless Chrome을 DevTools Protocol로 직접 몰아 화면별로 찍는다.
//
//   node tools/capture-store-screenshots.mjs
//   APP_URL=http://localhost:4173/nuri-world/ node tools/capture-store-screenshots.mjs
//
// 기본 대상은 배포된 GitHub Pages다(빌드 없이 현재 배포본 그대로 찍힌다).
//
// 앱을 몰고 다니는 장치(CDP·화면 이동·진행상태 시드)는 tools/app-drive.mjs 가 갖고 있다.
// 레이아웃 검사(audit-layout.mjs)와 같은 것을 쓰므로, 화면 구조가 바뀌면 그쪽 한 곳만 고치면 된다.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APP_URL, SCENES, withChrome, seedProgress, bootToTitle, runSteps, probe,
} from './app-drive.mjs';

// 검증용으로 다른 곳에 찍고 싶을 때: SHOT_OUT_DIR=/tmp/shots node tools/...
const OUT_DIR = process.env.SHOT_OUT_DIR
  || fileURLToPath(new URL('../store/screenshots/', import.meta.url));
const WIDTH = 1920;
const HEIGHT = 1080;

// 스토어에 올릴 컷과 파일명. SCENES 중 여기 없는 화면(예: 스테이지 선택)은 찍지 않는다.
const FILES = {
  title:  '01-title.png',
  map:    '02-map.png',
  learn:  '03-learn.png',
  listen: '04-listen.png',
  build:  '05-build.png',
  word:   '06-word.png',
  boss:   '07-boss.png',
  dex:    '08-dex.png',
};

await mkdir(OUT_DIR, { recursive: true });

await withChrome({ width: WIDTH, height: HEIGHT }, async cdp => {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
  });
  console.log(`대상: ${APP_URL}`);
  await seedProgress(cdp);

  for (const scene of SCENES) {
    const file = FILES[scene.id];
    if (!file) continue;

    // 각 컷은 타이틀에서 다시 출발한다 — 화면 간 상태가 섞이지 않게.
    await bootToTitle(cdp, file);
    await runSteps(cdp, scene.steps, file);

    const where = await cdp.eval(probe);
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    await writeFile(join(OUT_DIR, file), Buffer.from(data, 'base64'));
    console.log(`✓ ${file}  ${scene.desc}  [${where}]`);
  }
});
