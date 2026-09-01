// 앱 진입점 + 화면 라우터
import { unlockAudio, stopSpeech } from './audio.js';
import { store } from './store.js';

/** @type {Record<string, ScreenRender>} */
const screens = {};
/** @type {AppScreen | null} */
let current = null;
let navToken = 0;

// ---- 뒤로 가기 ---------------------------------------------------------------
// 안드로이드는 뒤로 가기를 누르면 액티비티가 그대로 끝난다 — Capacitor 에는 처리가 없어서
// 게임 도중이든 지도든 앱이 즉시 꺼진다. 유아용 앱에서 아이가 누르는 버튼이라 그냥 둘 수 없다.
//
// 화면을 옮길 때 히스토리에 한 칸을 쌓아 두고, 뒤로 가기가 그 칸을 소비하면 화면을 되돌린다.
// 네이티브(MainActivity)는 웹뷰에 남은 칸이 있으면 그것부터 쓰고, 없을 때에만 앱을 끝낸다.
// 브라우저·PWA 의 뒤로 가기도 같은 경로로 동작한다.
//
// '거쳐 가는' 화면은 이력에 남기지 않는다. 되돌아왔을 때 로딩 화면이 다시 뜨거나
// 이야기·게임이 처음부터 다시 시작되면 곤란하기 때문이다.
const TRANSIENT = new Set(['loading', 'story', 'stage']);
/** @type {{ name: string, params: any }[]} 되돌아갈 화면 스택 */
const trail = [];
let currentName = '';
let goingBack = false;
/** 뒤로 가기가 소비할 히스토리 칸을 하나 확보해 뒀는지. */
let spare = false;

/** 지금 화면에서 뒤로 갈 곳이 있는가. */
function canGoBack() {
  return TRANSIENT.has(currentName) ? trail.length >= 1 : trail.length >= 2;
}

/** 뒤로 가기가 소비할 칸을 하나만 유지한다(소비되면 popstate에서 다시 채운다). */
function keepSpare() {
  if (canGoBack() && !spare) {
    spare = true;
    window.history.pushState({ nuri: trail.length }, '');
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    spare = false;
    // 거쳐 가는 화면에서는 스택을 건드리지 않는다 — 스택 맨 위가 곧 돌아갈 곳이다.
    if (!TRANSIENT.has(currentName)) trail.pop();
    const target = trail[trail.length - 1];
    if (!target) return; // 최상위 — 그대로 두면 앱이 종료된다(의도한 동작)
    goingBack = true;
    go(target.name, target.params).finally(() => { goingBack = false; });
  });
}

// 화면 등록 (각 화면 모듈이 render(params) => AppScreen 제공)
/** @param {string} name @param {ScreenRender} renderFn */
export function register(name, renderFn) {
  screens[name] = renderFn;
}

// 화면 전환
/** @param {string} name @param {any} [params] */
export async function go(name, params = {}) {
  const renderFn = screens[name];
  if (!renderFn) throw new Error(`unknown screen: ${name}`);
  const token = ++navToken;
  stopSpeech();

  const app = document.getElementById('app');
  if (!app) return; // #app은 index.html에 항상 존재 — 방어적 가드
  const next = renderFn(params);
  next.classList.add('screen', 'fade-in');
  // 화면 수명 신호: 이 화면을 떠나면 abort된다. 게임/내레이션은 이 signal로
  // 지연 타이머·TTS·async 루프를 표준적으로 취소한다.
  const ac = new AbortController();
  next._ac = ac;

  if (current) {
    const prev = current;
    // 신호 abort: 진행 중이던 타이머·TTS·async 루프가 곧바로 취소된다.
    // (실제 DOM 제거는 500ms 뒤 페이드아웃 후)
    prev._ac?.abort();
    prev.classList.add('fade-out');
    setTimeout(() => prev.remove(), 500);
  }
  current = next;
  app.append(next);

  // 화면의 시작 루틴(onShow)에 수명 signal을 주입. 전환 도중 다른 화면으로
  // 이동했다면(token 불일치) 시작 루틴을 건너뜀.
  if (next._onShow && token === navToken) next._onShow(ac.signal);

  currentName = name;
  if (!goingBack && !TRANSIENT.has(name)) {
    // 같은 화면을 다시 열면 스택이 무한히 길어지지 않게 한 번만 남긴다.
    if (trail[trail.length - 1]?.name !== name) trail.push({ name, params });
  }
  keepSpare();
}

// ---- 부팅 -------------------------------------------------------------------
// ---- 에러 경계 -------------------------------------------------------------
// 자체 완결형 폴백 (CSS·ui.js가 실패해도 보이도록 인라인 스타일). 중복 렌더 방지.
function renderFatal() {
  const app = document.getElementById('app');
  if (!app || document.getElementById('fatal-fallback')) return;
  app.innerHTML =
    '<div id="fatal-fallback" style="position:fixed;inset:0;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:20px;background:#2b2036;color:#fff6e3;' +
    "font-family:'Jua',sans-serif;text-align:center;padding:24px;z-index:9999\">" +
    '<div style="font-size:4rem">🌧️</div>' +
    '<div style="font-size:1.4rem;line-height:1.6">앗, 잠깐 문제가 생겼어요!<br>다시 시작해 볼까요?</div>' +
    '<button id="fatal-reload" style="font-size:1.3rem;padding:14px 40px;border:none;border-radius:999px;' +
    'background:#ffc93c;color:#5d3a00;font-weight:bold;cursor:pointer">🔄 다시 시작</button></div>';
  document.getElementById('fatal-reload')?.addEventListener('click', () => location.reload());
}

// 화면이 하나도 렌더되지 않았으면(초기 부팅 실패) 폴백 표시. 부팅 이후의
// 런타임 오류는 기록만 하고 UI를 갈아엎지 않는다.
function maybeFatal() {
  if (!document.querySelector('.screen')) renderFatal();
}

window.addEventListener('error', e => {
  console.error('[nuri] error:', e.error || e.message);
  maybeFatal();
});
window.addEventListener('unhandledrejection', e => {
  console.error('[nuri] unhandledrejection:', e.reason);
  maybeFatal();
});

async function boot() {
 try {
  // 화면 모듈 로드 (등록 부수효과)
  await Promise.all([
    import('./screens/loading.js'),
    import('./screens/title.js'),
    import('./screens/story.js'),
    import('./screens/map.js'),
    import('./screens/kingdom.js'),
    import('./screens/stage.js'),
    import('./screens/result.js'),
    import('./screens/dex.js'),
    import('./screens/festival.js'),
  ]);

  // 첫 사용자 제스처에서 오디오 잠금 해제 (iOS/안드로이드 필수).
  // 부팅 직후 자동 재생이 막힌 환영 음성(현재 화면의 _welcomeOnUnlock)을 이때 재생.
  const unlock = () => {
    unlockAudio();
    current?._welcomeOnUnlock?.();
  };
  document.addEventListener('pointerdown', unlock, { once: true });

  // 두 손가락 핀치 줌 방지 (iOS Safari는 maximum-scale을 무시함).
  // 더블탭 줌은 CSS touch-action: manipulation으로 이미 막으므로 여기선 멀티터치만 차단.
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('gesturechange', e => e.preventDefault());
  document.addEventListener('touchmove', e => {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // 세로 화면 힌트: 닫으면 이번엔 숨기되, 세로로 다시 돌아오면 재노출해 가로 사용을 유도.
  // (가로에는 영향 없음 — 힌트 자체가 orientation:portrait에서만 표시됨)
  const rotateHint = document.getElementById('rotate-hint');
  document.getElementById('rotate-dismiss')?.addEventListener('click', () => {
    if (rotateHint) rotateHint.style.display = 'none';
  });
  const portraitMQ = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
  const reshowHint = () => { if (rotateHint && portraitMQ.matches) rotateHint.style.display = ''; };
  portraitMQ.addEventListener?.('change', reshowHint);
  window.addEventListener('orientationchange', () => setTimeout(reshowHint, 250));

  // 주요 배경 미리 로드 (전환 시 깜빡임 방지)
  ['title_screen', 'world_map', 'memory_meadow'].forEach(n => {
    const img = new Image();
    img.src = `assets/images/backgrounds/${n}.jpg`;
  });

  // 로딩 화면에서 음성·이미지를 모두 미리 받은 뒤 '시작하기' 탭으로 타이틀에 진입한다.
  go('loading');
 } catch (e) {
  // import·초기화 실패 시 영구 백지 대신 재시작 폴백 노출
  console.error('[nuri] 부팅 실패:', e);
  renderFatal();
 }
}

// ---- PWA 자동 업데이트(설치형 앱 최신 반영) ---------------------------------
// 새 버전이 배포되면 SW가 백그라운드에서 새로 설치·활성화된다(sw.js는 skipWaiting+
// clientsClaim). 그 교체가 '업데이트'일 때만(최초 설치는 제외) 화면을 한 번 새로고침해
// 곧바로 최신 화면을 보여 준다. 등록 자체는 vite-plugin-pwa가 주입한 registerSW.js 담당.
function setupAutoReload() {
  try {
    if (!('serviceWorker' in navigator)) return;
    // 로드 시점에 이미 SW가 제어 중이었으면, 이후의 controllerchange는 '업데이트' 교체다.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // 최초 설치(무→유)나 등록 해제(유→무)에는 새로고침하지 않고, 새 SW로 교체될 때만.
      if (!hadController || reloading || !navigator.serviceWorker.controller) return;
      reloading = true;
      location.reload();
    });
    // 오래 열어 둔 세션도 갱신을 감지하도록 주기적으로 업데이트를 확인한다(30분).
    navigator.serviceWorker.getRegistration()
      .then(reg => { if (reg) setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000); })
      .catch(() => {});
  } catch { /* SW 미지원·보안 컨텍스트 아님 등은 조용히 무시 */ }
}
setupAutoReload();

boot();

export { store };
