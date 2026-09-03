// 헤드리스 크롬으로 앱을 몰고 다니는 공용 장치.
// 스토어 스크린샷(capture-store-screenshots.mjs)과 레이아웃 검사(audit-layout.mjs)가 함께 쓴다.
//
// 의존성 없음 — Node 24 내장 WebSocket으로 CDP를 직접 말한다.
// 대기는 전부 "그 화면이 실제로 떴는지" 폴링으로 확인한다. 앱이 부팅 때 음원·그림을
// 프리로드하느라 로딩 화면이 수십 초 머무를 수 있어, 고정 sleep으로는 로딩 화면이 잡힌다.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { JAMO, TOWER_STAGES, VILLAGE_STAGES } from '../js/data.js';

export const APP_URL = process.env.APP_URL || 'https://s10cho.github.io/nuri-world/';
const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT || 9333);

export const BOOT_TIMEOUT = 120_000;
export const STEP_TIMEOUT = 20_000;
/** 전환 페이드(500ms)와 등장 애니메이션이 끝나기를 기다리는 한 박자 */
export const SETTLE = 1200;

// ---- 진행 상태 주입 ---------------------------------------------------------
// "이미 어느 정도 해 본 아이"의 화면이라야 지도에 별이 차고 성(보스)도 열리며 도감도 찬다.
// 축제는 잠가 둔다 — 엔딩을 스포일러로 노출할 이유가 없다.
export const SEED = {
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
  // 도감의 '자모'와 '만든 글자'는 둘 다 이 배열에서 센다(dex.js).
  jamo: [
    ...Object.keys(JAMO),
    ...TOWER_STAGES.flatMap(st => st.targets.map(t => t.s)),
  ],
};

// ---- CDP 최소 클라이언트 ----------------------------------------------------
export class CDP {
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

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 조건이 참이 될 때까지 기다린다 (앱이 그 화면을 실제로 그렸는지 확인) */
export async function waitFor(cdp, expr, timeout, label) {
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
export const clickNth = (sel, n) => `(() => {
  const els = document.querySelectorAll(${JSON.stringify(sel)});
  if (!els[${n}]) return 'MISS: ${sel}[${n}] (' + els.length + '개 있음)';
  els[${n}].click();
  return 'OK';
})()`;

/** 주어진 글자 중 하나가 들어 있는 버튼을 누른다 */
export const clickText = (...texts) => `(() => {
  const want = ${JSON.stringify(texts)};
  const els = [...document.querySelectorAll('button')];
  const hit = els.find(e => want.some(t => e.textContent.includes(t)));
  if (!hit) return 'MISS: ' + want.join('/');
  hit.click();
  return 'OK';
})()`;

// ---- 화면이 떴는지 판별하는 조건들 ------------------------------------------
// 로딩 화면은 프리로드가 끝나도 자동으로 넘어가지 않는다 — '시작하기'를 눌러야 한다
// (그 클릭이 오디오 잠금 해제 제스처를 겸한다). 그래서 부팅은 두 박자다.
export const AT_LOADED = `document.querySelector('.load-done')`;
export const AT_TITLE = `document.querySelector('.title-logo')`;
export const AT_MAP = `document.querySelectorAll('.map-spot').length >= 5`;
export const AT_KINGDOM = `document.querySelectorAll('.stage-pad').length > 0`;
// 게임 화면은 껍데기가 먼저 붙고 문제·선택지는 인트로 내레이션이 끝난 뒤에 그려진다.
export const AT_GAME = `(() => {
  const a = document.querySelector('.game-area');
  if (!a) return false;
  return a.querySelectorAll('.choices > *, .letter-card, .build-slot, .word-display').length >= 2;
})()`;
export const AT_DEX = `document.querySelector('.dex-grid')`;
// 스테이지는 활동을 순서대로 돌리며 상단 점(round-dots)을 채운다.
export const AT_NEXT_ACTIVITY = `document.querySelectorAll('.round-dots .dot.done').length >= 1`;

/** 지금 떠 있는 화면이 무엇인지 확인 (조용한 실패 방지) */
export const probe = `(() => {
  const marks = ['title-logo', 'map-spot', 'stage-pads', 'game-area', 'dex-grid', 'load-bar'];
  return marks.filter(m => document.querySelector('.' + m)).join(',') || '?';
})()`;

// ---- 화면 시나리오 ----------------------------------------------------------
// learn·build·word·boss는 각 스테이지의 "첫 활동"이라 스테이지에 들어가는 것만으로 도달한다.
const TO_MAP = { do: clickText('모험 시작'), until: AT_MAP };

/** 지도에서 n번째 왕국의 1스테이지로 들어간다 */
const intoStage = n => [
  TO_MAP,
  { do: clickNth('.map-spot', n), until: AT_KINGDOM },
  { do: clickNth('.stage-pad', 0), until: AT_GAME },
];

/** @type {{ id: string, desc: string, steps: any[] }[]} */
export const SCENES = [
  { id: 'title',   desc: '타이틀',                         steps: [] },
  { id: 'map',     desc: '왕국 지도',                       steps: [TO_MAP] },
  { id: 'kingdom', desc: '스테이지 선택 (기억의 초원)',      steps: [TO_MAP, { do: clickNth('.map-spot', 0), until: AT_KINGDOM }] },
  { id: 'learn',   desc: '글자 배우기 (기억의 초원 1)',      steps: intoStage(0) },
  {
    id: 'listen',
    desc: '듣기 게임 — 소리 듣고 글자 고르기',
    // 배우기를 '다음 글자'로 끝까지 넘기면 같은 스테이지의 다음 활동인 듣기가 시작된다
    steps: [
      ...intoStage(0),
      { do: clickText('다음 글자', '다 만났어요'), until: AT_NEXT_ACTIVITY, repeat: true },
    ],
  },
  { id: 'build',   desc: '글자 조각의 탑 — 자음+모음 조합',  steps: intoStage(2) },
  { id: 'word',    desc: '이름 없는 마을 — 낱말 완성',       steps: intoStage(3) },
  { id: 'boss',    desc: '최종 결전 — 보스전',              steps: intoStage(4) },
  { id: 'dex',     desc: '도감',                            steps: [{ do: clickText('도감'), until: AT_DEX }] },
];

// ---- 실행 헬퍼 --------------------------------------------------------------

/** 앱을 처음부터 띄워 타이틀 화면까지 데려간다 */
export async function bootToTitle(cdp, label) {
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, AT_LOADED, BOOT_TIMEOUT, `${label}: 프리로드`);
  const r = await cdp.eval(clickNth('.load-start', 0));
  if (typeof r === 'string' && r.startsWith('MISS')) throw new Error(`${label}: ${r}`);
  await waitFor(cdp, AT_TITLE, STEP_TIMEOUT, `${label}: 타이틀`);
  await cdp.eval('document.fonts.ready.then(() => "fonts")');
  await sleep(SETTLE);
}

/** 시나리오의 단계들을 차례로 실행한다 */
export async function runSteps(cdp, steps, label) {
  for (const step of steps) {
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
      if (!done) throw new Error(`시간 초과: ${label} (반복 클릭)`);
    } else {
      const r = await cdp.eval(step.do);
      if (typeof r === 'string' && r.startsWith('MISS')) throw new Error(`${label}: ${r}`);
      await waitFor(cdp, step.until, STEP_TIMEOUT, label);
    }
    await sleep(SETTLE);
  }
}

/**
 * 헤드리스 크롬을 띄우고 CDP를 연결한 뒤 fn(cdp)를 실행한다. 끝나면 반드시 정리한다.
 * @param {{ width: number, height: number }} size 초기 창 크기
 * @param {(cdp: CDP) => Promise<void>} fn
 */
export async function withChrome(size, fn) {
  const profile = await mkdtemp(join(tmpdir(), 'nuri-drive-'));
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${size.width},${size.height}`,
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
    await fn(cdp);
  } finally {
    cdp?.close();
    chrome.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

/** 진행 상태를 심는다 (origin이 잡힌 뒤라야 localStorage를 쓸 수 있다) */
export async function seedProgress(cdp) {
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, AT_LOADED, BOOT_TIMEOUT, '첫 부팅(프리로드)');
  await cdp.eval(
    `localStorage.setItem('nuri-hangul-kingdom-v1', ${JSON.stringify(JSON.stringify(SEED))}), 'seeded'`,
  );
}
