// 스토어 등록용 스크린샷 캡처 — Play(가로 16:9) · App Store(iPhone 6.9" · iPad 13").
//
// 스토어마다 요구 규격이 다르고 창 캡처로는 정확히 맞출 수 없어, headless Chrome 을
// DevTools Protocol 로 직접 몰아 화면별로 찍는다.
//
//   node tools/capture-store-screenshots.mjs                 # 세 규격 전부
//   node tools/capture-store-screenshots.mjs ios-6.9         # 하나만
//   APP_URL=http://localhost:4173/nuri-world/ node tools/capture-store-screenshots.mjs
//
// 기본 대상은 배포된 GitHub Pages 다. **제출용으로 찍을 때는 로컬 미리보기를 쓸 것** —
// Pages 배포가 밀려 있으면 옛 화면이 찍힌다.
//
//   npm run build && npm run preview &
//   APP_URL=http://localhost:4173/nuri-world/ npm run shots:store
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
const OUT_ROOT = process.env.SHOT_OUT_DIR
  || fileURLToPath(new URL('../', import.meta.url));

// 스토어별 규격. w·h 는 CSS 픽셀(= 그 기기의 논리 해상도)이고, 실제 파일 크기는 w×dpr 이다.
// CSS 픽셀로 잡아야 그 기기에서 실제로 적용되는 레이아웃(미디어 쿼리)이 그대로 찍힌다.
// 단순히 큰 뷰포트로 찍어 늘리면 태블릿 레이아웃이 폰 스크린샷에 들어가 버린다.
// App Store 컷은 fastlane 이 찾는 자리에 바로 떨군다 — `fastlane ios screenshots` 가
// fastlane/screenshots/<로케일>/ 을 그대로 읽는다. deliver 는 파일명이 아니라 **해상도**로
// 기기를 판별하므로, 두 규격이 한 폴더에 섞여도 되고 이름만 겹치지 않으면 된다.
const IOS_DIR = 'fastlane/screenshots/ko';

// PNG 로 찍으면 두 규격 합쳐 85MB 다. 배경이 사진 같은 일러스트라 JPEG 가 잘 맞고,
// q90 이면 20MB 로 줄면서 글자 윤곽·어두운 그라데이션 모두 눈에 띄는 손상이 없다
// (q85 와 파일 크기가 같아 q90 을 쓴다). App Store 는 JPG·PNG 를 모두 받는다.
const DEVICES = {
  // Google Play — 짧은 변 1080px 이상 · 16:9 가로라야 큰 추천 영역에 노출된다.
  'play': {
    dir: 'store/screenshots', w: 1920, h: 1080, dpr: 1, fmt: 'png', out: '1920×1080',
  },
  // App Store iPhone 6.9"(아이폰 16/17 Pro Max) 가로. 논리 956×440 @3x → 2868×1320.
  'ios-6.9': {
    dir: IOS_DIR, w: 956, h: 440, dpr: 3, fmt: 'jpeg', quality: 90,
    prefix: 'iphone69-', out: '2868×1320',
  },
  // App Store iPad 13"(아이패드 프로 M4) 가로. 논리 1376×1032 @2x → 2752×2064.
  // 앱이 iPad 를 지원한다고 선언하므로(Info.plist) 이 규격이 필수다.
  'ipad-13': {
    dir: IOS_DIR, w: 1376, h: 1032, dpr: 2, fmt: 'jpeg', quality: 90,
    prefix: 'ipad13-', out: '2752×2064',
  },
};
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

const picked = process.argv.slice(2).filter(a => !a.startsWith('-'));
for (const name of picked) {
  if (!DEVICES[name]) {
    console.error(`알 수 없는 규격: ${name} (가능: ${Object.keys(DEVICES).join(', ')})`);
    process.exit(1);
  }
}
const TARGETS = (picked.length ? picked : Object.keys(DEVICES)).map(n => [n, DEVICES[n]]);

for (const [name, dev] of TARGETS) {
  const outDir = join(OUT_ROOT, dev.dir);
  await mkdir(outDir, { recursive: true });
  console.log(`\n■ ${name} — ${dev.out} (논리 ${dev.w}×${dev.h} @${dev.dpr}x) → ${dev.dir}/`);

  await withChrome({ width: dev.w, height: dev.h }, async cdp => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: dev.w, height: dev.h, deviceScaleFactor: dev.dpr, mobile: false,
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
        format: dev.fmt,
        ...(dev.quality ? { quality: dev.quality } : {}),
        captureBeyondViewport: false,
      });
      const name = (dev.prefix || '') + file.replace(/\.png$/, dev.fmt === 'jpeg' ? '.jpg' : '.png');
      await writeFile(join(outDir, name), Buffer.from(data, 'base64'));
      console.log(`✓ ${name}  ${scene.desc}  [${where}]`);
    }
  });
}
