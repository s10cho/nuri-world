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
// 의존성 없음 — Node 24 내장 WebSocket으로 CDP를 직접 말한다.
//
// 대기는 전부 "그 화면이 실제로 떴는지" 폴링으로 확인한다. 앱이 부팅 때 음원·그림을
// 프리로드하느라 로딩 화면이 수십 초 머무를 수 있어, 고정 sleep으로는 로딩 화면이 찍힌다.

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JAMO, TOWER_STAGES, VILLAGE_STAGES } from '../js/data.js';

const APP_URL = process.env.APP_URL || 'https://s10cho.github.io/nuri-world/';
const OUT_DIR = fileURLToPath(new URL('../store/screenshots/', import.meta.url));
const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const WIDTH = 1920;
const HEIGHT = 1080;

// 부팅(프리로드)은 넉넉히, 화면 전환은 짧게
const BOOT_TIMEOUT = 120_000;
const STEP_TIMEOUT = 20_000;

// ---- 진행 상태 주입 ---------------------------------------------------------
// 스토어 스크린샷은 "이미 어느 정도 해 본 아이"의 화면이라야 보기 좋다.
// 네 왕국을 다 깬 상태로 두면 지도에 별이 차고 성(보스)도 열리며 도감도 가득 찬다.
// 축제는 잠가 둔다 — 엔딩을 스포일러로 노출할 이유가 없다.
const SEED = {
  sound: true,
  introSeen: true,
  stars: {
    meadow: [3, 3, 3, 3, 3],
    lake: [3, 3, 3, 3, 3],
    tower: [3, 3, 3, 3, 3],
    village: [3, 3, 3, 3, 3],
    castle: [-1],
  },
  festivalSeen: false,
  residents: VILLAGE_STAGES.flatMap(st => st.words.map(w => w.w)),
  // 도감의 '자모'와 '만든 글자'는 둘 다 이 배열에서 센다(dex.js). 자모 40개만 넣으면
  // 만든 글자가 0/25로 남아 "다 깬 아이"의 화면과 어긋나므로 조합 글자도 함께 넣는다.
  jamo: [
    ...Object.keys(JAMO),
    ...TOWER_STAGES.flatMap(st => st.targets.map(t => t.s)),
  ],
};

// ---- CDP 최소 클라이언트 ----------------------------------------------------
class CDP {
  /** @param {string} wsUrl */
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    return new CDP(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      const slot = this.pending.get(msg.id);
      if (!slot) return; // 이벤트는 쓰지 않는다 — 대기는 전부 폴링
      this.pending.delete(msg.id);
      msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 페이지에서 식을 평가하고 값을 돌려받는다 */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    }
    return r.result.value;
  }

  close() { this.ws.close(); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 조건이 참이 될 때까지 기다린다 (앱이 그 화면을 실제로 그렸는지 확인) */
async function waitFor(cdp, expr, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    // 평가 자체가 실패할 수 있다(전환 중 DOM 교체) — 실패는 '아직'으로 본다
    const ok = await cdp.eval(`(() => { try { return !!(${expr}); } catch { return false; } })()`);
    if (ok) return;
    await sleep(250);
  }
  throw new Error(`시간 초과: ${label} (${expr})`);
}

// ---- 페이지 조작 헬퍼 -------------------------------------------------------

/** n번째 요소를 누른다 */
const clickNth = (sel, n) => `(() => {
  const els = document.querySelectorAll(${JSON.stringify(sel)});
  if (!els[${n}]) return 'MISS: ${sel}[${n}] (' + els.length + '개 있음)';
  els[${n}].click();
  return 'OK';
})()`;

/** 주어진 글자 중 하나가 들어 있는 버튼을 누른다 */
const clickText = (...texts) => `(() => {
  const want = ${JSON.stringify(texts)};
  const els = [...document.querySelectorAll('button')];
  const hit = els.find(e => want.some(t => e.textContent.includes(t)));
  if (!hit) return 'MISS: ' + want.join('/');
  hit.click();
  return 'OK';
})()`;

// 화면이 떴는지 판별하는 조건들
// 로딩 화면은 프리로드가 끝나도 자동으로 넘어가지 않는다 — '시작하기'를 눌러야 한다
// (그 클릭이 오디오 잠금 해제 제스처를 겸한다). 그래서 부팅은 두 박자다.
const AT_LOADED = `document.querySelector('.load-done')`;
const AT_TITLE = `document.querySelector('.title-logo')`;
const AT_MAP = `document.querySelectorAll('.map-spot').length >= 5`;
const AT_KINGDOM = `document.querySelectorAll('.stage-pad').length > 0`;
// 게임 화면은 껍데기가 먼저 붙고 문제·선택지는 인트로 내레이션이 끝난 뒤에 그려진다.
// 껍데기만 보고 찍으면 가운데가 텅 빈 컷이 나오므로, 실제로 고를 것이 생겼는지까지 본다.
const AT_GAME = `(() => {
  const a = document.querySelector('.game-area');
  if (!a) return false;
  return a.querySelectorAll('.choices > *, .letter-card, .build-slot, .word-display').length >= 2;
})()`;
const AT_DEX = `document.querySelector('.dex-grid')`;
// 스테이지는 활동을 순서대로 돌리며 상단 점(round-dots)을 채운다.
// 첫 점이 done이 되면 다음 활동(초원 1스테이지 기준 '듣기')으로 넘어간 것이다.
const AT_NEXT_ACTIVITY = `document.querySelectorAll('.round-dots .dot.done').length >= 1`;

/** 지금 떠 있는 화면이 무엇인지 확인 (조용한 실패 방지) */
const probe = `(() => {
  const marks = ['title-logo', 'map-spot', 'stage-pads', 'game-area', 'dex-grid'];
  return marks.filter(m => document.querySelector('.' + m)).join(',') || '?';
})()`;

// ---- 캡처 시나리오 ----------------------------------------------------------
// learn·build·word·boss는 각 스테이지의 "첫 활동"이라 스테이지에 들어가는 것만으로 찍힌다.
// (listen은 learn을 끝내야 나오는 두 번째 활동이라 여기서 다루지 않는다)
// 타이틀 → 지도. 스테이지로 들어가는 컷은 모두 이 두 걸음을 앞에 둔다.
const TO_MAP = { do: clickText('모험 시작'), until: AT_MAP };

/** 지도에서 n번째 왕국의 1스테이지로 들어간다 */
const intoStage = n => [
  TO_MAP,
  { do: clickNth('.map-spot', n), until: AT_KINGDOM },
  { do: clickNth('.stage-pad', 0), until: AT_GAME },
];

const SHOTS = [
  {
    file: '01-title.png',
    desc: '타이틀',
    steps: [],
  },
  {
    file: '02-map.png',
    desc: '왕국 지도',
    steps: [TO_MAP],
  },
  {
    file: '03-learn.png',
    desc: '글자 배우기 (기억의 초원 1스테이지)',
    steps: intoStage(0),
  },
  {
    file: '04-listen.png',
    desc: '듣기 게임 — 소리를 듣고 글자 고르기',
    // 배우기를 '다음 글자'로 끝까지 넘기면 같은 스테이지의 다음 활동인 듣기가 시작된다
    steps: [
      ...intoStage(0),
      // 마지막 글자에서는 버튼 문구가 '다 만났어요! ✅'로 바뀐다
      { do: clickText('다음 글자', '다 만났어요'), until: AT_NEXT_ACTIVITY, repeat: true },
    ],
  },
  {
    file: '05-build.png',
    desc: '글자 조각의 탑 — 자음+모음 조합',
    steps: intoStage(2),
  },
  {
    file: '06-word.png',
    desc: '이름 없는 마을 — 낱말 완성',
    steps: intoStage(3),
  },
  {
    file: '07-boss.png',
    desc: '최종 결전 — 보스전',
    steps: intoStage(4),
  },
  {
    file: '08-dex.png',
    desc: '도감 — 모은 자모 40 · 주민 20',
    steps: [{ do: clickText('도감'), until: AT_DEX }],
  },
];

// 전환 페이드(500ms)와 등장 애니메이션이 끝나고 찍히도록 한 박자 둔다
const SETTLE = 1200;

/** 앱을 처음부터 띄워 타이틀 화면까지 데려간다 */
async function bootToTitle(cdp, label) {
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, AT_LOADED, BOOT_TIMEOUT, `${label}: 프리로드`);
  const r = await cdp.eval(clickNth('.load-start', 0));
  if (typeof r === 'string' && r.startsWith('MISS')) throw new Error(`${label}: ${r}`);
  await waitFor(cdp, AT_TITLE, STEP_TIMEOUT, `${label}: 타이틀`);
  await cdp.eval('document.fonts.ready.then(() => "fonts")');
  await sleep(SETTLE);
}

// ---- 실행 -------------------------------------------------------------------
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const profile = await mkdtemp(join(tmpdir(), 'nuri-shot-'));

  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-gpu',
    'about:blank',
  ], { stdio: 'ignore' });

  let cdp;
  try {
    let targets;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        targets = await res.json();
        if (targets.some(t => t.type === 'page')) break;
      } catch { /* 아직 안 떴다 */ }
    }
    const page = targets?.find(t => t.type === 'page');
    if (!page) throw new Error('Chrome 디버깅 대상을 찾지 못했다');

    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
    });

    // 진행 상태를 심는다 (origin이 잡힌 뒤라야 localStorage를 쓸 수 있다)
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, AT_LOADED, BOOT_TIMEOUT, '첫 부팅(프리로드)');
    await cdp.eval(
      `localStorage.setItem('nuri-hangul-kingdom-v1', ${JSON.stringify(JSON.stringify(SEED))}), 'seeded'`,
    );

    for (const shot of SHOTS) {
      // 각 컷은 타이틀에서 다시 출발한다 — 화면 간 상태가 섞이지 않게.
      await bootToTitle(cdp, shot.file);

      for (const step of shot.steps) {
        if (step.repeat) {
          // 조건이 찰 때까지 같은 버튼을 계속 누른다(예: '다음 글자'로 배우기 끝내기).
          // 마지막 클릭 뒤에는 버튼이 사라지므로 도중의 MISS는 정상이다.
          const deadline = Date.now() + STEP_TIMEOUT;
          let done = false;
          while (Date.now() < deadline) {
            if (await cdp.eval(`(() => { try { return !!(${step.until}); } catch { return false; } })()`)) {
              done = true;
              break;
            }
            await cdp.eval(step.do);
            await sleep(900);
          }
          if (!done) throw new Error(`시간 초과: ${shot.file} (반복 클릭)`);
        } else {
          const r = await cdp.eval(step.do);
          if (typeof r === 'string' && r.startsWith('MISS')) {
            throw new Error(`${shot.file}: ${r}`);
          }
          await waitFor(cdp, step.until, STEP_TIMEOUT, shot.file);
        }
        await sleep(SETTLE);
      }

      const where = await cdp.eval(probe);
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      await writeFile(join(OUT_DIR, shot.file), Buffer.from(data, 'base64'));
      console.log(`✓ ${shot.file}  ${shot.desc}  [${where}]`);
    }
  } finally {
    cdp?.close();
    chrome.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(err => {
  console.error('실패:', err.message);
  process.exit(1);
});
