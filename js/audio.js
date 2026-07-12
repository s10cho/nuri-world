// 오디오 엔진: 녹음 음성 파일 우선 + 한국어 TTS(Web Speech API) + WebAudio 합성 효과음

import { store } from './store.js';

// Capacitor 네이티브 앱(iOS/Android)에서는 브라우저 speechSynthesis 대신 네이티브 TTS 플러그인을
// 쓴다 — 특히 Android WebView의 speechSynthesis는 기기 TTS 데이터·WebView 버전에 따라 불안정.
// 웹/PWA는 이미 정교하게 튜닝된 기존 경로를 그대로 사용. window.Capacitor는 네이티브 런타임에서만
// 주입되므로 정적 import 없이 감지하고, 플러그인은 네이티브에서만 lazy-load해 웹 번들 영향 최소화.
const NATIVE = typeof window !== 'undefined' && /** @type {any} */ (window).Capacitor?.isNativePlatform?.() === true;
/** @type {any} */
let nativeTTS = null;
let nativeKoOk = false;
async function ensureNativeTTS() {
  if (nativeTTS) return nativeTTS;
  const mod = await import('@capacitor-community/text-to-speech');
  nativeTTS = mod.TextToSpeech;
  return nativeTTS;
}

/** @type {AudioContext | null} */
let ctx = null;
/** @type {SpeechSynthesisVoice | null} */
let koVoice = null;
let voicesReady = false;
/** @type {Promise<Record<string, { id: string, src: string, bytes?: number }> | null> | null} */
let voiceManifestPromise = null;
/** @type {Record<string, { id: string, src: string, bytes?: number }> | null} 매니페스트 해소 후 동기 조회용 캐시 */
let voiceManifestData = null;
/** @type {HTMLAudioElement | null} */
let currentVoiceAsset = null;
/** @type {(() => void) | null} 진행 중 녹음을 즉시 멈추고 그 Promise를 완료 처리하는 콜백 */
let currentVoiceStop = null;

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

if (NATIVE) {
  // 네이티브: 한국어 음성 지원 여부를 플러그인으로 확인 후 게임 대기 해제(최대 3초 안전 타임아웃)
  let settled = false;
  const finishNative = () => { if (!settled) { settled = true; voicesReady = true; markVoicesReady(); } };
  ensureNativeTTS()
    .then(tts => tts.isLanguageSupported({ lang: 'ko-KR' }))
    .then(res => { nativeKoOk = !!res?.supported; })
    .catch(() => { nativeKoOk = true; }) // 확인 실패 시 낙관적으로 음성 모드(대개 지원됨)
    .finally(finishNative);
  setTimeout(finishNative, 3000);
} else if ('speechSynthesis' in window) {
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

/** @param {string} text */
function voiceKey(text) {
  return text.replace(/\s+/g, ' ').trim();
}

async function loadVoiceManifest() {
  if (!voiceManifestPromise) {
    voiceManifestPromise = fetch('assets/audio/ko/manifest.json')
      .then(response => response.ok ? response.json() : null)
      .then(manifest => manifest?.assets || null)
      .catch(() => null);
    // 해소되면 동기 조회(hasVoiceAsset)용으로 캐시
    voiceManifestPromise.then(data => { voiceManifestData = data; });
  }
  return voiceManifestPromise;
}

// 해당 문구의 녹음 파일이 있는지(매니페스트 로드 후) 동기 확인. 게임이 TTS 대신
// 녹음을 우선 재생하거나, 녹음·TTS가 모두 없을 때 시각 대체를 켜는 판단에 쓴다.
/** @param {string} text @returns {boolean} */
export function hasVoiceAsset(text) {
  return !!voiceManifestData && !!voiceManifestData[voiceKey(text)];
}

// 최초 실행 시 녹음 음성 파일을 모두 미리 받아 브라우저 캐시에 넣어 둔다. 이렇게 하면
// 이후 speak()가 new Audio(src).play()를 호출할 때 네트워크 지연 없이 즉시 재생된다
// (미리 로드 안 하면 특정 문구를 처음 말할 때 파일을 그때 받아오느라 소리가 늦거나,
//  화면 전환으로 signal이 먼저 abort되면 아예 안 들리는 문제가 있었다).
/**
 * @param {(fraction: number) => void} [onProgress] 0~1 진행률 콜백
 * @returns {Promise<void>}
 */
export async function preloadVoiceAssets(onProgress) {
  if (typeof fetch === 'undefined') { onProgress?.(1); return; }
  const assets = await loadVoiceManifest();
  const list = assets ? Object.values(assets) : [];
  const total = list.length;
  if (!total) { onProgress?.(1); return; }
  let done = 0;
  let idx = 0;
  // 동시 다운로드 수 제한 — 모바일에서 141개를 한꺼번에 여는 것을 방지
  const CONCURRENCY = 6;
  async function worker() {
    while (idx < total) {
      const asset = list[idx++];
      // 본문까지 읽어야(다운로드 완료) HTTP 캐시에 저장된다. 실패는 무시(재생 시 TTS 폴백).
      try { await fetch(asset.src).then(r => r.arrayBuffer()); } catch { /* 개별 실패 무시 */ }
      done += 1;
      onProgress?.(done / total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
}

// 진행 중이던 녹음 재생을 즉시 멈춘다. 멈출 때 그 재생의 Promise도 완료 처리해
// 대기 중이던 speak()가 매달리지 않게 한다(누수·정지 방지).
function stopVoiceAsset() {
  const stop = currentVoiceStop;
  currentVoiceStop = null;
  currentVoiceAsset = null;
  if (stop) stop();
}

/**
 * @param {string} text
 * @param {{ interrupt?: boolean, signal?: AbortSignal }} [opts]
 * @returns {Promise<boolean>} true면 녹음 파일 재생 성공/완료
 */
async function playVoiceAsset(text, { interrupt = true, signal } = {}) {
  if (signal?.aborted || typeof Audio === 'undefined') return false;

  // interrupt: 새 발화가 녹음이든 TTS든, 진행 중이던 소리를 '항상 먼저' 끊는다.
  // (기존엔 새 텍스트에 녹음이 없으면 아래 asset 확인에서 일찍 반환해 이전 녹음을
  //  못 끊어, 이전 프롬프트 녹음과 새 TTS 칭찬이 동시에 겹쳐 나던 버그가 있었다.)
  if (interrupt) {
    stopVoiceAsset();
    if (!NATIVE && 'speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)) {
      speechSynthesis.cancel();
      lastCancelAt = Date.now();
    }
  }

  const assets = await loadVoiceManifest();
  const asset = assets?.[voiceKey(text)];
  if (!asset?.src || signal?.aborted) return false;

  return new Promise(resolve => {
    const audio = new Audio(asset.src);
    let done = false;
    /** @param {boolean} played */
    const finish = (played) => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', onAbort);
      if (currentVoiceAsset === audio) currentVoiceAsset = null;
      if (currentVoiceStop === stop) currentVoiceStop = null;
      resolve(played);
    };
    const stop = () => { audio.pause(); audio.currentTime = 0; finish(true); };
    const onAbort = () => stop();
    currentVoiceAsset = audio;
    currentVoiceStop = stop;
    signal?.addEventListener('abort', onAbort, { once: true });
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    audio.play().catch(() => finish(false));
  });
}

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
export async function speak(text, { rate = 0.85, pitch = 1.1, interrupt = true, signal } = {}) {
  if (!store.get().sound || signal?.aborted) return;
  if (await playVoiceAsset(text, { interrupt, signal })) return;
  return new Promise(resolve => {
    // 네이티브 앱: 플러그인 TTS 경로(브라우저 speechSynthesis 우회)
    if (NATIVE) { speakNative(text, { rate, pitch, signal }).then(resolve, resolve); return; }
    if (!('speechSynthesis' in window)) return resolve();
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

// 네이티브(Capacitor) TTS로 말하기. 완료 시 resolve, signal abort 시 중단.
// 플러그인 speak()는 발화 종료 시 resolve하므로 web 경로의 onend/keepalive 우회가 필요 없다.
/**
 * @param {string} text
 * @param {{ rate?: number, pitch?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<void>}
 */
async function speakNative(text, { rate = 0.9, pitch = 1.1, signal } = {}) {
  if (signal?.aborted) return;
  let tts;
  try { tts = await ensureNativeTTS(); } catch { return; }
  if (signal?.aborted) return;
  const onAbort = () => { tts.stop().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await tts.stop(); // 진행 중 발화 중단(중첩·중복 방지)
    await tts.speak({ text, lang: 'ko-KR', rate, pitch, volume: 1.0, category: 'playback' });
  } catch { /* 음성 실패는 무음 처리 */ }
  signal?.removeEventListener('abort', onAbort);
}

export function stopSpeech() {
  flushPending();
  stopVoiceAsset();
  if (NATIVE) { ensureNativeTTS().then(t => t.stop().catch(() => {})).catch(() => {}); return; }
  if ('speechSynthesis' in window) { speechSynthesis.cancel(); lastCancelAt = Date.now(); }
}

export function hasTTS() {
  if (NATIVE) return true;
  return 'speechSynthesis' in window;
}

// 한국어 음성이 실제로 설치돼 있는지 (없으면 게임에서 시각 대안을 노출)
export function hasKoreanTTS() {
  if (NATIVE) return nativeKoOk;
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
let ttsWarmed = false;
export function unlockAudio() {
  try {
    audioCtx();
    if ('speechSynthesis' in window) {
      if (speechSynthesis.paused) speechSynthesis.resume();
      // 첫 사용자 제스처 안에서 speechSynthesis를 무음으로 한 번 깨워 둔다. 최신 크롬은
      // speechSynthesis.speak()에도 사용자 활성화를 요구해, 게임이 프롬프트를 지연 후
      // '자동' 재생하면 not-allowed로 조용히 막힌다(녹음 파일은 재생되는데 TTS만 무음).
      // 제스처 안에서 한 번 speak를 성사시켜 두면 이후 지연 발화의 자동재생 차단이 풀린다.
      if (!ttsWarmed) {
        ttsWarmed = true;
        const warm = new SpeechSynthesisUtterance('​'); // zero-width — 발음할 게 없어 무음
        warm.volume = 0;
        try { speechSynthesis.speak(warm); } catch { /* noop */ }
      }
    }
  } catch { /* noop */ }
}
