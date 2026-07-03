// 앱 진입점 + 화면 라우터
import { unlockAudio, stopSpeech } from './audio.js';
import { store } from './store.js';

const screens = {};
let current = null;
let navToken = 0;

// 화면 등록 (각 화면 모듈이 render(params) => HTMLElement 제공)
export function register(name, renderFn) {
  screens[name] = renderFn;
}

// 화면 전환
export async function go(name, params = {}) {
  const renderFn = screens[name];
  if (!renderFn) throw new Error(`unknown screen: ${name}`);
  const token = ++navToken;
  stopSpeech();

  const app = document.getElementById('app');
  const next = renderFn(params);
  next.classList.add('screen', 'fade-in');
  next._token = token;

  if (current) {
    const prev = current;
    // 즉시 '사망' 표시: 실제 DOM 제거는 500ms 뒤(페이드)지만, 진행 중이던
    // 게임/내레이션 루프가 그 사이에도 이탈을 감지해 멈출 수 있도록 한다.
    prev._dead = true;
    prev.classList.add('fade-out');
    setTimeout(() => prev.remove(), 500);
  }
  current = next;
  app.append(next);

  // 화면이 자체 시작 루틴(onShow)을 가지면 실행 — 전환 도중 다른 화면으로
  // 이동했다면(token 불일치) 시작 루틴을 건너뜀
  if (next._onShow && token === navToken) next._onShow();
}

// 이 화면이 아직 활성 상태인지 (async 루프·지연 콜백이 이탈 여부를 확인할 때 사용)
export function isAlive(screen) {
  return !!screen && !screen._dead && screen._token === navToken;
}

// ---- 부팅 -------------------------------------------------------------------
async function boot() {
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

  // 세로 화면 힌트 닫기
  document.getElementById('rotate-dismiss')?.addEventListener('click', () => {
    document.getElementById('rotate-hint').style.display = 'none';
  });

  // 주요 배경 미리 로드 (전환 시 깜빡임 방지)
  ['title_screen', 'world_map', 'memory_meadow'].forEach(n => {
    const img = new Image();
    img.src = `public/assets/images/backgrounds/${n}.jpg`;
  });

  go('title');
}

boot();

export { store };
