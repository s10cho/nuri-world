// 오디오 엔진: 한국어 TTS(Web Speech API) + WebAudio 합성 효과음
// 외부 오디오 파일 없이 동작 — GitHub Pages 정적 배포에 최적화

import { store } from './store.js';

/** @type {AudioContext | null} */
let ctx = null;
/** @type {SpeechSynthesisVoice | null} */
let koVoice = null;
let voicesReady = false;

function audioCtx() {
  if (!ctx) {
    // Safari는 접두사 webkitAudioContext (표준 lib 타입에 없어 캐스트)
    const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    ctx = new AC();
  }
  // 'suspended'뿐 아니라 iOS의 비표준 'interrupted'(전화·시리·백그라운드 복귀) 상태에서도 재개
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
}

// 앱이 다시 보이거나 포커스를 얻으면 오디오 컨텍스트를 복구 (세션 중 인터럽션 대비)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  });
  window.addEventListener('focus', () => {
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  });
}

// ---- 한국어 TTS ----------------------------------------------------------

// 음성 목록 로드 완료 신호. Chrome/Android는 getVoices()가 처음엔 비어 있다가
// voiceschanged 이벤트 뒤에 채워진다. 이 Promise가 해소되기 전에 게임이
// hasKoreanTTS()로 showModel(듣기 vs 시각 대체)을 확정하면, TTS가 있는데도
// 시각 모드로 잘못 뜬다 → 게임 시작 전 whenVoicesReady()로 대기하게 한다.
/** @type {(() => void) | null} */
let resolveVoices = null;
/** @type {Promise<void>} */
const voicesReadyPromise = new Promise(r => { resolveVoices = r; });
function markVoicesReady() {
  if (resolveVoices) { resolveVoices(); resolveVoices = null; }
}

function pickKoreanVoice() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return;
  // 우선순위: 로컬 ko-KR > 아무 ko-KR > ko-*
  koVoice =
    voices.find(v => v.lang === 'ko-KR' && v.localService) ||
    voices.find(v => v.lang === 'ko-KR') ||
    voices.find(v => v.lang && v.lang.startsWith('ko')) ||
    null;
  voicesReady = true;
  markVoicesReady();
}

if ('speechSynthesis' in window) {
  pickKoreanVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickKoreanVoice);
  // voiceschanged를 신뢰할 수 없는 브라우저(늦거나 미발생)에 대비해 음성 목록이
  // 채워질 때까지 폴링한다. 채워지면 pickKoreanVoice가 정확한 상태로 즉시 해소하고,
  // 끝내 안 채워지면 ~3초 후 포기하고 진행. 고정 타임아웃 단독은 그 순간 음성이
  // 아직 미로드면 showModel(듣기 vs 시각)을 잘못 확정할 수 있어 폴링으로 창을 좁힌다.
  let voiceTries = 0;
  const voicePoll = setInterval(() => {
    if (!voicesReady) pickKoreanVoice();
    if (voicesReady || ++voiceTries >= 12) {
      clearInterval(voicePoll);
      markVoicesReady(); // 음성이 끝내 안 뜨는 기기라도 게임이 무한 대기하지 않도록
    }
  }, 250);
} else {
  markVoicesReady(); // TTS 미지원 기기: 즉시 해소해 게임이 대기하지 않도록
}

// 음성 목록 로드(또는 타임아웃) 완료를 기다린다. 게임이 showModel을 결정하기 전 호출.
/** @returns {Promise<void>} */
export function whenVoicesReady() { return voicesReadyPromise; }

// 예약된 발화 상태 (cancel과 speak 사이 간격 확보용). 다음 발화가 들어오면 취소.
/** @type {ReturnType<typeof setTimeout> | null} */
let pendingSpeak = null;    // 지연 실행 타이머
/** @type {(() => void) | null} */
let pendingResolve = null;  // 아직 실행 안 된 발화의 Promise resolve
let lastCancelAt = 0;       // 마지막 cancel() 시각 (외부 cancel 직후 speak 억제용)
const CANCEL_GAP = 120;     // cancel 후 speak까지 최소 간격(ms)

// 예약됐지만 아직 말하지 않은 발화를 즉시 정리 (Promise를 바로 resolve해 대기 해제)
function flushPending() {
  if (pendingSpeak) { clearTimeout(pendingSpeak); pendingSpeak = null; }
  if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(); }
}

// 말하기. rate 살짝 느리게(아이 듣기 편하게). 완료 Promise 반환.
/**
 * @param {string} text
 * @param {{ rate?: number, pitch?: number, interrupt?: boolean, signal?: AbortSignal }} [opts]
 * @returns {Promise<void>}
 */
export function speak(text, { rate = 0.85, pitch = 1.1, interrupt = true, signal } = {}) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window) || !store.get().sound || signal?.aborted) return resolve();
    if (!voicesReady) pickKoreanVoice();

    // 앞서 예약된(아직 실행 안 된) 발화가 있으면 즉시 정리 — 중첩/중복·대기 방지
    flushPending();

    // signal이 주어지면 화면 이탈 시 이 발화를 취소하고 즉시 resolve
    let done = false;
    // Chrome은 긴 발화를 ~15초에 조용히 끊는다 — 발화 중 주기적으로 resume()해 유지.
    // (재생 중 resume()은 no-op이라 무해; 짧은 발화는 finish가 먼저 걸려 한 번도 안 돎)
    /** @type {ReturnType<typeof setInterval> | null} */
    let keepAlive = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => { speechSynthesis.cancel(); finish(); };
    signal?.addEventListener('abort', onAbort, { once: true });

    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    if (koVoice) u.voice = koVoice;
    u.rate = rate;
    u.pitch = pitch;
    u.onend = finish;
    u.onerror = finish;

    const doSpeak = () => {
      pendingSpeak = null;
      pendingResolve = null;
      speechSynthesis.speak(u);
      keepAlive = setInterval(() => { try { speechSynthesis.resume(); } catch { /* noop */ } }, 10000);
    };

    // iOS Safari/Android Chrome은 cancel() 직후 같은 틱에 speak()하면 새 발화를 조용히 무시한다.
    // 진행 중 발화가 있거나, (go()의 stopSpeech 등) 직전에 외부 cancel이 있었으면 간격을 두고 speak.
    const recentlyCancelled = Date.now() - lastCancelAt < CANCEL_GAP + 20;
    if (interrupt && (speechSynthesis.speaking || speechSynthesis.pending || recentlyCancelled)) {
      speechSynthesis.cancel();
      lastCancelAt = Date.now();
      pendingResolve = finish; // 실행 전에 다른 발화로 대체되면 즉시 resolve되도록
      pendingSpeak = setTimeout(doSpeak, CANCEL_GAP);
    } else {
      doSpeak();
    }

    // iOS 사파리에서 onend 누락 대비 안전 타이머
    setTimeout(finish, 1200 + text.length * 350);
  });
}

export function stopSpeech() {
  flushPending();
  if ('speechSynthesis' in window) { speechSynthesis.cancel(); lastCancelAt = Date.now(); }
}

export function hasTTS() {
  return 'speechSynthesis' in window;
}

// 한국어 음성이 실제로 설치돼 있는지 (없으면 게임에서 시각 대안을 노출)
export function hasKoreanTTS() {
  if (!('speechSynthesis' in window)) return false;
  if (!voicesReady) pickKoreanVoice();
  return !!koVoice;
}

// ---- 합성 효과음 ---------------------------------------------------------

/**
 * @param {number} freq
 * @param {number} start
 * @param {number} dur
 * @param {{ type?: OscillatorType, gain?: number, glide?: number }} [opts]
 */
function tone(freq, start, dur, { type = 'sine', gain = 0.18, glide = 0 } = {}) {
  const ac = audioCtx();
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const SFX = {
  // 버튼/카드 탭: 가벼운 '뽁'
  tap()     { tone(660, 0, 0.09, { type: 'triangle', gain: 0.12, glide: 880 }); },
  // 정답: 밝은 3화음 아르페지오
  correct() { [523.25, 659.25, 783.99].forEach((f, i) => tone(f, i * 0.09, 0.28, { type: 'triangle', gain: 0.16 })); },
  // 오답: 부드러운 '두웅' (놀라지 않게 낮고 짧게)
  wrong()   { tone(220, 0, 0.25, { type: 'sine', gain: 0.12, glide: 165 }); },
  // 별 획득: 반짝이는 상승 아르페지오
  star()    { [659.25, 783.99, 987.77, 1318.5].forEach((f, i) => tone(f, i * 0.08, 0.35, { type: 'sine', gain: 0.14 })); },
  // 스테이지 클리어 팡파르
  fanfare() {
    [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.38]]
      .forEach(([f, t]) => tone(f, t, 0.45, { type: 'triangle', gain: 0.16 }));
    tone(261.63, 0.38, 0.6, { type: 'sine', gain: 0.1 });
  },
  // 카드 뒤집기
  flip()    { tone(440, 0, 0.08, { type: 'triangle', gain: 0.1, glide: 587 }); },
  // 글자 조합 '철컥+반짝'
  snap()    { tone(330, 0, 0.07, { type: 'square', gain: 0.08 }); tone(660, 0.07, 0.18, { type: 'triangle', gain: 0.12, glide: 990 }); },
  // 몬스터 공격 성공
  hit()     { tone(196, 0, 0.18, { type: 'sawtooth', gain: 0.1, glide: 98 }); tone(784, 0.02, 0.12, { type: 'triangle', gain: 0.1 }); },
  // 몬스터 웃음(오답 시 낮은 '우후후')
  laugh()   { [180, 150, 200].forEach((f, i) => tone(f, i * 0.12, 0.14, { type: 'square', gain: 0.05 })); },
  // 페이지/화면 전환 '휘릭'
  whoosh()  { tone(880, 0, 0.22, { type: 'sine', gain: 0.07, glide: 220 }); },
  // 축하 종소리
  chime()   { [1046.5, 1318.5, 1568].forEach((f, i) => tone(f, i * 0.15, 0.5, { type: 'sine', gain: 0.12 })); },
};

/** @param {keyof typeof SFX} name */
export function sfx(name) {
  if (!store.get().sound) return;
  try { SFX[name]?.(); } catch { /* 오디오 불가 환경에서는 무음 */ }
}

// 사용자 첫 제스처에서 오디오 잠금 해제 (iOS/모바일 필수)
export function unlockAudio() {
  try {
    audioCtx();
    if ('speechSynthesis' in window && speechSynthesis.paused) speechSynthesis.resume();
  } catch { /* noop */ }
}
