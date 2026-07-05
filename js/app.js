// @ts-check
// 앱 진입점 + 화면 라우터
import { unlockAudio, stopSpeech } from './audio.js';
import { store } from './store.js';

/** @type {Record<string, ScreenRender>} */
const screens = {};
/** @type {AppScreen | null} */
let current = null;
let navToken = 0;

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
    img.src = `public/assets/images/backgrounds/${n}.jpg`;
  });

  go('title');
 } catch (e) {
  // import·초기화 실패 시 영구 백지 대신 재시작 폴백 노출
  console.error('[nuri] 부팅 실패:', e);
  renderFatal();
 }
}

boot();

export { store };
