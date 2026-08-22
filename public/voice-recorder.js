// 녹음 페이지(voice-scripts.html)의 녹음 기능.
//  녹음 → 들어보기 → 다시 녹음 → 저장까지 한 화면에서 끝내고,
//  저장은 개발 서버 API(__voice/save, tools/vite-plugin-voice-recorder.mjs)로 보내
//  public/assets/audio/ko/ 와 manifest.json 을 갱신한다. 즉 저장 즉시 앱이 그 육성을 쓴다.
//  개발 서버가 아니면(파일로 열었을 때) 저장 대신 import:voice 규칙에 맞는 파일명으로 내려받는다.

const API = path => new URL(path, document.baseURI).href;
const SETTINGS_KEY = 'nuri-voice-recorder-settings';

// Safari는 audio/mp4(AAC)를 그대로 뱉어 iOS에서 바로 재생된다. Chrome은 webm/opus뿐이라
// 서버에서 ffmpeg로 m4a 변환이 필요하다(없으면 경고).
const PREFERRED_TYPES = [
  'audio/mp4',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm;codecs=opus',
  'audio/webm',
];

/** @type {{ tr: HTMLTableRowElement, id: string, text: string, savedSrc: string, pending: { blob: Blob, url: string } | null }[]} */
const rows = [];
const state = {
  active: 0,
  recording: false,
  arming: false,     // 카운트인 대기 중
  server: false,
  converter: null,   // 서버에서 쓸 수 있는 m4a 변환기(ffmpeg | afconvert | null)
  mimeType: '',
  settings: {
    autoSave: true,
    autoNext: true,
    autoStop: true,  // 말이 끝나면 저절로 정지 — 정지 키를 누르지 않게 해 키보드 소리를 막는다
    trim: true,      // 앞뒤 무음·클릭 다듬기
    leadInMs: 500,   // 녹음 시작 전 대기
    filter: 'all',
    query: '',
    deviceId: '',
  },
};

/** @type {MediaStream | null} */
let stream = null;
/** @type {MediaRecorder | null} */
let recorder = null;
/** @type {AudioContext | null} */
let audioCtx = null;
/** @type {AnalyserNode | null} */
let analyser = null;
let levelRaf = 0;
let timerId = 0;
let armTimer = 0;
let startedAt = 0;
let speechAt = 0;        // 마지막으로 소리가 감지된 시각
let speechSeen = false;  // 이번 테이크에서 말이 한 번이라도 감지됐나
/** @type {{ auto?: boolean, silent?: boolean }} */
let stopReason = {};
let deleteArmedFor = '';
const player = new Audio();

const el = {};

/* ── 유틸 ─────────────────────────────────────────────────────── */

function loadSettings() {
  try {
    Object.assign(state.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
  } catch { /* 저장값이 깨졌으면 기본값 사용 */ }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch { /* 사생활 보호 모드 등 — 설정 저장 실패는 무시 */ }
}

/** @param {string} message @param {'info'|'error'|'done'} [kind] */
function setStatus(message, kind = 'info') {
  el.status.textContent = message;
  el.status.className = `rec-status ${kind === 'info' ? '' : kind}`;
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return PREFERRED_TYPES.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

/** import:voice(tools/import-recorded-voice-assets.mjs)가 인식하는 파일명 규칙 */
function downloadName(id, mime) {
  const ext = /mp4|m4a|aac/.test(mime) ? '.mp3.m4a' : mime.includes('ogg') ? '.mp3.ogg' : '.mp3.webm';
  return `${id.replaceAll('/', ':')}${ext}`;
}

/* ── 행 상태 ───────────────────────────────────────────────────── */

/** @param {number} index @param {{ scroll?: boolean }} [opts] */
function setActive(index, { scroll = true } = {}) {
  if (index < 0 || index >= rows.length) return;
  state.active = index;
  deleteArmedFor = '';
  rows.forEach((row, i) => {
    row.tr.classList.toggle('rec-active', i === index);
    row.tr.classList.toggle('active', i === index);
  });
  const row = rows[index];
  if (scroll) row.tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
  renderBar();
}

function current() {
  return rows[state.active];
}

/** 다음(또는 이전) 보이는 행으로 이동. @param {1|-1} step @param {boolean} [onlyUnrecorded] */
function move(step, onlyUnrecorded = false) {
  for (let i = state.active + step; i >= 0 && i < rows.length; i += step) {
    const row = rows[i];
    if (row.tr.hidden) continue;
    if (onlyUnrecorded && row.savedSrc) continue;
    setActive(i);
    return true;
  }
  return false;
}

function updateProgress() {
  const total = rows.length;
  const done = rows.filter(row => row.savedSrc).length;
  el.progressText.textContent = `녹음 ${done} / ${total} (${Math.round((done / total) * 100)}%)`;
  el.progressFill.style.width = `${(done / total) * 100}%`;
}

/** @param {typeof rows[number]} row @param {string} src */
function markRecorded(row, src) {
  row.savedSrc = src;
  row.tr.dataset.recorded = src ? '1' : '0';
  row.tr.dataset.src = src;
  const badge = row.tr.querySelector('.source-badge');
  if (badge) {
    badge.textContent = src ? '🎙️ 녹음' : '🤖 TTS';
    badge.className = `badge source-badge ${src ? 'rec' : 'tts'}`;
  }
  const fileBtn = row.tr.querySelector('.file-copy-btn');
  if (fileBtn) {
    const shown = (src || row.tr.dataset.tts || '').replace(/^assets\/audio\/ko\//, '');
    fileBtn.dataset.copy = shown;
    fileBtn.innerHTML = `<code>${shown}</code>`;
  }
  updateProgress();
  applyFilter();
}

/* ── 녹음 ─────────────────────────────────────────────────────── */

async function ensureStream() {
  if (stream && stream.active) return stream;
  const constraints = {
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
      ...(state.settings.deviceId ? { deviceId: { exact: state.settings.deviceId } } : {}),
    },
  };
  stream = await navigator.mediaDevices.getUserMedia(constraints);
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  // 자동재생 정책상 사용자 제스처 전에는 resume()이 무한 대기할 수 있으므로 기다리지 않는다
  // (녹음 자체는 AudioContext와 무관하다 — 레벨 미터·무음 감지만 영향을 받는다)
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  audioCtx.createMediaStreamSource(stream).connect(analyser);
  await listDevices();
  return stream;
}

async function listDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  el.device.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = '기본 마이크';
  el.device.append(auto);
  for (const device of devices) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `마이크 ${el.device.length}`;
    el.device.append(option);
  }
  el.device.value = state.settings.deviceId || '';
}

// 레벨 미터 + 무음 감지. 말이 한 번 감지된 뒤 SILENCE_MS 동안 조용하면 스스로 멈춘다 —
// 이렇게 하면 정지하려고 스페이스바를 누를 일이 없어 키보드 소리가 녹음에 섞이지 않는다.
const SILENCE_RMS = 0.012;   // 이 값 아래면 무음으로 본다(정규화 진폭)
const SILENCE_MS = 1000;     // 말이 끝난 뒤 이만큼 조용하면 정지
const NO_SPEECH_MS = 8000;   // 아무 소리도 없으면 이만큼 뒤 포기
const MAX_TAKE_MS = 20000;   // 안전장치 — 무한 녹음 방지

/** 현재 입력 세기(0~1). @returns {{ peak: number, rms: number }} */
function readLevel() {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let peak = 0;
  let sum = 0;
  for (const value of data) {
    const amplitude = Math.abs(value - 128) / 128;
    peak = Math.max(peak, amplitude);
    sum += amplitude * amplitude;
  }
  return { peak, rms: Math.sqrt(sum / data.length) };
}

// 눈에 보이는 레벨 미터만 rAF로 그린다(탭이 숨으면 멈춰도 무방).
function drawLevel() {
  if (!analyser) return;
  el.levelFill.style.width = `${Math.min(100, readLevel().peak * 140)}%`;
  levelRaf = requestAnimationFrame(drawLevel);
}

// 타이머 + 무음 감지. rAF가 아니라 setInterval에 두는 이유: 탭을 잠깐 다른 데로 옮겨도
// (rAF는 아예 멈춘다) 자동 정지와 최대 길이 제한이 계속 동작해야 하기 때문.
function tickTimer() {
  const now = Date.now();
  const elapsed = now - startedAt;
  el.timer.textContent = `${(elapsed / 1000).toFixed(1)}s`;
  // 오디오 컨텍스트가 아직 안 깨어났으면 세기를 못 재니 자동 정지도 하지 않는다(오판 방지)
  if (!state.recording || !analyser || audioCtx?.state !== 'running') return;

  if (readLevel().rms > SILENCE_RMS) {
    speechAt = now;
    speechSeen = true;
  }
  if (elapsed > MAX_TAKE_MS) stopRecording({ auto: true });
  else if (state.settings.autoStop) {
    if (speechSeen && now - speechAt > SILENCE_MS) stopRecording({ auto: true });
    else if (!speechSeen && elapsed > NO_SPEECH_MS) stopRecording({ auto: true, silent: true });
  }
}

// 스페이스바를 누른 '그 순간'의 키 소리가 앞머리에 물리지 않도록 잠깐 기다렸다 시작한다.
async function startRecording() {
  const row = current();
  if (!row || state.recording || state.arming) return;
  try {
    await ensureStream();
  } catch (error) {
    setStatus(`마이크를 열 수 없습니다: ${error.message}`, 'error');
    return;
  }
  if (typeof MediaRecorder === 'undefined') {
    setStatus('이 브라우저는 MediaRecorder를 지원하지 않습니다.', 'error');
    return;
  }

  discardPending(row);
  player.pause();

  const leadIn = Number(state.settings.leadInMs) || 0;
  if (!leadIn) return beginRecording(row);

  state.arming = true;
  renderBar();
  const readyAt = Date.now() + leadIn;
  const countdown = () => {
    const left = readyAt - Date.now();
    if (!state.arming) return;
    if (left <= 0) {
      state.arming = false;
      beginRecording(row);
      return;
    }
    el.timer.textContent = `${(left / 1000).toFixed(1)}s`;
    setStatus('잠시 후 시작해요… (키보드 소리를 피하려고 기다리는 중)');
    armTimer = setTimeout(countdown, 50);
  };
  countdown();
}

/** @param {typeof rows[number]} row */
function cancelArming() {
  if (!state.arming) return;
  state.arming = false;
  clearTimeout(armTimer);
  setStatus('시작을 취소했습니다.');
  renderBar();
}

/** @param {typeof rows[number]} row */
function beginRecording(row) {
  /** @type {BlobPart[]} */
  const chunks = [];
  state.mimeType = pickMimeType();
  recorder = new MediaRecorder(stream, state.mimeType ? { mimeType: state.mimeType } : undefined);
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = async () => {
    const type = recorder?.mimeType || state.mimeType || 'audio/webm';
    const raw = new Blob(chunks, { type });
    const manual = !stopReason.auto;
    const silent = !!stopReason.silent;
    state.recording = false;
    row.tr.classList.remove('rec-recording');
    cancelAnimationFrame(levelRaf);
    clearInterval(timerId);
    el.levelFill.style.width = '0';

    if (!raw.size || silent) {
      setStatus(silent ? '소리가 들리지 않아 멈췄습니다. 마이크를 확인해 주세요.' : '녹음된 소리가 없습니다.', 'error');
      renderBar();
      return;
    }

    const blob = state.settings.trim ? await trimTake(raw, manual) : raw;
    row.pending = { blob, url: URL.createObjectURL(blob) };
    row.tr.classList.add('rec-pending');
    renderBar();
    if (state.settings.autoSave) saveCurrent();
    else {
      setStatus(`녹음 완료 (${(blob.size / 1024).toFixed(0)}KB). 들어보고 저장하세요.`, 'done');
      playCurrent();
    }
  };

  recorder.start();
  state.recording = true;
  startedAt = Date.now();
  speechAt = Date.now();
  speechSeen = false;
  stopReason = {};
  row.tr.classList.add('rec-recording');
  row.tr.classList.remove('rec-pending');
  timerId = setInterval(tickTimer, 100);
  drawLevel();
  setStatus(state.settings.autoStop
    ? '녹음 중… 다 읽고 잠깐 기다리면 저절로 멈춥니다.'
    : '녹음 중… 다 읽으면 스페이스바로 정지하세요.');
  renderBar();
}

function toggleRecording() {
  if (state.arming) cancelArming();
  else if (state.recording) stopRecording();
  else startRecording();
}

/** @param {{ auto?: boolean, silent?: boolean }} [reason] */
function stopRecording(reason = {}) {
  if (state.arming) return cancelArming();
  if (!state.recording || !recorder) return;
  // 정지 요청이 여러 번 들어와도(무음 감지가 연속으로 걸릴 수 있다) 한 번만 처리한다
  if (recorder.state !== 'recording') return;
  stopReason = reason;
  recorder.stop();
}

/**
 * 앞뒤 무음(과 수동 정지 시 끝의 키보드 클릭)을 잘라 낸다.
 * 컨테이너를 직접 자를 수는 없으니 PCM으로 디코드해 다듬고 WAV로 다시 만든다.
 * 서버가 ffmpeg 또는 macOS afconvert로 m4a로 변환한다.
 * @param {Blob} blob @param {boolean} manualStop
 * @returns {Promise<Blob>}
 */
async function trimTake(blob, manualStop) {
  try {
    const ctx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const rate = buffer.sampleRate;

    // 모노로 합친다
    const mono = new Float32Array(buffer.length);
    for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / buffer.numberOfChannels;
    }

    // 수동 정지면 끝부분에 키 누르는 소리가 남아 있으니 먼저 잘라 낸다
    const usable = manualStop ? Math.max(0, mono.length - Math.round(rate * 0.18)) : mono.length;

    const frame = Math.round(rate * 0.01); // 10ms 단위로 세기 측정
    let peak = 0;
    const levels = [];
    for (let i = 0; i < usable; i += frame) {
      let sum = 0;
      const end = Math.min(i + frame, usable);
      for (let j = i; j < end; j += 1) sum += mono[j] * mono[j];
      const rms = Math.sqrt(sum / Math.max(1, end - i));
      levels.push(rms);
      peak = Math.max(peak, rms);
    }
    if (!peak) return blob;

    const threshold = Math.max(peak * 0.08, 0.004);
    const first = levels.findIndex(level => level > threshold);
    let last = -1;
    for (let i = levels.length - 1; i >= 0; i -= 1) {
      if (levels[i] > threshold) { last = i; break; }
    }
    if (first < 0 || last < 0) return blob;

    const start = Math.max(0, (first * frame) - Math.round(rate * 0.06)); // 앞 여유 60ms
    const stop = Math.min(usable, ((last + 1) * frame) + Math.round(rate * 0.18)); // 뒤 여유 180ms
    if (stop - start < rate * 0.15) return blob; // 너무 짧으면 원본 유지

    return encodeWav(mono.subarray(start, stop), rate);
  } catch {
    return blob; // 디코드 실패 시 원본 그대로 — 저장은 되게 한다
  }
}

/** Float32 모노 PCM → 16bit WAV Blob. @param {Float32Array} samples @param {number} rate */
function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // 모노
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);   // byte rate
  view.setUint16(32, 2, true);          // block align
  view.setUint16(34, 16, true);         // bits
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** @param {typeof rows[number]} row */
function discardPending(row) {
  if (!row?.pending) return;
  URL.revokeObjectURL(row.pending.url);
  row.pending = null;
  row.tr.classList.remove('rec-pending');
}

function discardCurrent() {
  const row = current();
  if (!row?.pending) return;
  discardPending(row);
  setStatus('방금 녹음을 버렸습니다. 다시 녹음하세요.');
  renderBar();
}

/**
 * 재생. 이전 재생이 아직 시작 중일 때 새 src를 넣으면 play()가 AbortError로 거절되는데,
 * 이건 '새 소리로 갈아탄' 정상 상황이라 오류로 보여 주지 않는다.
 * @param {string} src @param {string} [notFoundMessage]
 */
function playSrc(src, notFoundMessage) {
  player.pause();
  player.src = src;
  player.play().catch(error => {
    if (error?.name === 'AbortError') return;
    setStatus(notFoundMessage || `재생 실패: ${error.message}`, 'error');
  });
}

function playCurrent() {
  const row = current();
  if (!row) return;
  const src = row.pending?.url || (row.savedSrc ? `${row.savedSrc}?v=${Date.now()}` : '');
  if (!src) {
    setStatus('아직 녹음이 없습니다.', 'error');
    return;
  }
  playSrc(src);
}

function playTts() {
  const row = current();
  const tts = row?.tr.dataset.tts;
  if (!tts) return;
  playSrc(`assets/audio/ko/${tts}?v=${Date.now()}`, 'TTS 생성본이 아직 없습니다.');
}

/* ── 저장 / 삭제 ──────────────────────────────────────────────── */

async function saveCurrent() {
  const row = current();
  if (!row?.pending) return;
  const { blob } = row.pending;

  if (!state.server) {
    const link = document.createElement('a');
    link.href = row.pending.url;
    link.download = downloadName(row.id, blob.type);
    link.click();
    setStatus(`${link.download} 로 내려받았습니다. npm run import:voice 로 반입하세요.`, 'done');
    return;
  }

  setStatus('저장 중…');
  try {
    const response = await fetch(
      API(`__voice/save?id=${encodeURIComponent(row.id)}&mime=${encodeURIComponent(blob.type)}`),
      { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } },
    );
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);

    discardPending(row);
    markRecorded(row, result.src);
    setStatus(
      result.warning
        ? `저장했지만 주의: ${result.warning}`
        : `저장 완료 → ${result.src} (${(result.bytes / 1024).toFixed(0)}KB${result.converted ? ', m4a 변환' : ''}). 앱이 바로 이 음성을 씁니다.`,
      result.warning ? 'error' : 'done',
    );
    renderBar();
    if (state.settings.autoNext) move(1, true) || setStatus('남은 미녹음 대사가 없습니다. 수고했어요!', 'done');
  } catch (error) {
    setStatus(`저장 실패: ${error.message}`, 'error');
  }
}

async function deleteCurrent() {
  const row = current();
  if (!row?.savedSrc) return;
  if (deleteArmedFor !== row.id) {
    deleteArmedFor = row.id;
    setStatus('한 번 더 누르면 이 녹음을 삭제합니다(TTS 생성본으로 되돌아갑니다).', 'error');
    renderBar();
    return;
  }
  deleteArmedFor = '';
  if (!state.server) {
    setStatus('개발 서버가 아니면 삭제할 수 없습니다.', 'error');
    return;
  }
  try {
    const response = await fetch(API(`__voice/delete?id=${encodeURIComponent(row.id)}`), { method: 'POST' });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
    markRecorded(row, '');
    setStatus(result.fallback ? '삭제했습니다. TTS 생성본으로 되돌렸어요.' : '삭제했습니다.', 'done');
    renderBar();
  } catch (error) {
    setStatus(`삭제 실패: ${error.message}`, 'error');
  }
}

/* ── 화면 ─────────────────────────────────────────────────────── */

function renderBar() {
  const row = current();
  if (!row) return;
  el.position.textContent = `${state.active + 1} / ${rows.length}`;
  el.category.textContent = row.id.split('/')[0];
  el.file.textContent = (row.savedSrc || `assets/audio/ko/${row.tr.dataset.tts || ''}`).replace(/^assets\/audio\/ko\//, '');
  el.script.textContent = row.text;

  const pending = !!row.pending;
  el.record.classList.toggle('recording', state.recording || state.arming);
  el.record.firstChild.textContent = state.arming
    ? '× 취소'
    : state.recording ? '■ 정지' : pending ? '● 다시 녹음' : '● 녹음';
  el.play.disabled = !pending && !row.savedSrc;
  el.play.firstChild.textContent = pending ? '▶ 방금 녹음' : '▶ 저장본';
  el.discard.disabled = !pending;
  el.save.disabled = !pending;
  el.save.firstChild.textContent = state.server ? '💾 저장' : '⤓ 내려받기';
  el.delete.disabled = !row.savedSrc;
  el.delete.firstChild.textContent = deleteArmedFor === row.id ? '🗑 정말 삭제' : '🗑 삭제';
  el.tts.disabled = !row.tr.dataset.tts;
  if (!state.recording && !state.arming) el.timer.textContent = pending ? '녹음됨' : row.savedSrc ? '저장됨' : '—';
}

function applyFilter() {
  const query = state.settings.query.trim();
  const filter = state.settings.filter;
  let shown = 0;
  for (const row of rows) {
    const matchQuery = !query || row.text.includes(query) || row.id.includes(query);
    const matchFilter = filter === 'all'
      || (filter === 'todo' && !row.savedSrc)
      || (filter === 'done' && !!row.savedSrc);
    row.tr.hidden = !(matchQuery && matchFilter);
    if (!row.tr.hidden) shown += 1;
  }
  el.shown.textContent = shown === rows.length ? '' : `표시 ${shown}개`;
}

function buildToolbar() {
  const toolbar = document.createElement('div');
  toolbar.className = 'rec-toolbar';
  toolbar.innerHTML = `
    <span class="rec-server off" data-role="server">서버 확인 중…</span>
    <div class="rec-progress">
      <span data-role="progress-text">녹음 0 / 0</span>
      <span data-role="shown" style="margin-left:8px;color:var(--muted);font-size:0.85rem"></span>
      <div class="rec-progress-bar"><i data-role="progress-fill"></i></div>
    </div>
    <label>보기
      <select data-role="filter">
        <option value="all">전체</option>
        <option value="todo">미녹음만</option>
        <option value="done">녹음됨만</option>
      </select>
    </label>
    <label>마이크 <select data-role="device"><option value="">기본 마이크</option></select></label>
    <label><input type="search" data-role="query" placeholder="대사·파일 검색"></label>
    <label><input type="checkbox" data-role="auto-save"> 정지하면 자동 저장</label>
    <label><input type="checkbox" data-role="auto-next"> 저장 후 다음 미녹음으로</label>
    <label><input type="checkbox" data-role="auto-stop"> 말 끝나면 자동 정지</label>
    <label><input type="checkbox" data-role="trim"> 앞뒤 무음·키 소리 다듬기</label>
    <label>카운트인
      <select data-role="lead-in">
        <option value="0">없음</option>
        <option value="300">0.3초</option>
        <option value="500">0.5초</option>
        <option value="800">0.8초</option>
        <option value="1200">1.2초</option>
      </select>
    </label>
    <p class="rec-note" data-role="note" hidden></p>`;
  return toolbar;
}

function buildBar() {
  const bar = document.createElement('div');
  bar.className = 'rec-bar';
  bar.innerHTML = `
    <div class="rec-bar-inner">
      <div class="rec-bar-text">
        <div class="rec-bar-meta">
          <strong data-role="position">1 / 1</strong>
          <span class="badge" data-role="category"></span>
          <code data-role="file"></code>
        </div>
        <div class="rec-bar-script" data-role="script"></div>
      </div>
      <div class="rec-buttons">
        <div class="rec-level"><i data-role="level-fill"></i></div>
        <span class="rec-timer" data-role="timer">—</span>
        <button class="rec-btn primary" type="button" data-role="record">● 녹음 <kbd>Space</kbd></button>
        <button class="rec-btn" type="button" data-role="play">▶ 듣기 <kbd>Enter</kbd></button>
        <button class="rec-btn" type="button" data-role="discard">↺ 버리기 <kbd>Backspace</kbd></button>
        <button class="rec-btn save" type="button" data-role="save">💾 저장 <kbd>S</kbd></button>
        <button class="rec-btn danger" type="button" data-role="delete">🗑 삭제</button>
        <button class="rec-btn" type="button" data-role="tts">🤖 TTS</button>
        <button class="rec-btn" type="button" data-role="prev" title="이전 대사">↑</button>
        <button class="rec-btn" type="button" data-role="next" title="다음 대사">↓</button>
      </div>
      <p class="rec-status" data-role="status">스페이스바로 녹음을 시작하세요. ↑↓로 대사를 옮깁니다.</p>
    </div>`;
  return bar;
}

async function checkServer() {
  try {
    const response = await fetch(API('__voice/status'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    state.server = true;
    state.converter = result.converter ?? (result.ffmpeg ? 'ffmpeg' : null);
    el.server.textContent = '개발 서버 연결됨 · 저장 시 앱에 바로 반영';
    el.server.className = 'rec-server ok';
    // 서버가 아는 실제 파일 목록으로 배지를 맞춘다(HTML 생성 이후 바뀌었을 수 있음).
    // 앱과 같은 기준인 '대사 텍스트'로 조회한다 — 같은 낱말이 여러 분류에 있으면 파일을 공유한다.
    for (const row of rows) {
      const asset = result.recorded[row.text];
      if (asset && asset.src !== row.savedSrc) markRecorded(row, asset.src);
      else if (!asset && row.savedSrc) markRecorded(row, '');
    }
  } catch {
    state.server = false;
    el.server.textContent = '개발 서버 없음 · 저장 대신 내려받기';
    el.server.className = 'rec-server off';
  }

  const type = pickMimeType();
  const notes = [];
  if (!state.server) {
    notes.push('npm run dev 로 연 페이지에서만 파일을 바로 저장할 수 있습니다. 지금은 내려받은 뒤 npm run import:voice 로 반입하세요.');
  } else if (!state.converter) {
    notes.push('m4a 변환기(ffmpeg · macOS afconvert)를 찾지 못했습니다 — 다듬은 녹음이 WAV로 저장되어 용량이 큽니다. 나중에 npm run convert:voice 로 변환하세요.');
  } else if (type.includes('webm') && state.converter !== 'ffmpeg' && !state.settings.trim) {
    notes.push('“앞뒤 무음·키 소리 다듬기”를 끄면 이 브라우저의 webm 녹음이 그대로 저장되어 iOS 앱에서 재생되지 않을 수 있습니다. 켜 두면 WAV로 다듬어 보내고 서버가 m4a로 변환합니다.');
  }
  if (notes.length) {
    el.note.hidden = false;
    el.note.textContent = `⚠️ ${notes.join(' ')}`;
  }
  updateProgress();
  renderBar();
}

function onKeydown(event) {
  const target = event.target;
  if (target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  switch (event.key) {
    case ' ':
      event.preventDefault();
      toggleRecording();
      break;
    case 'Enter':
      event.preventDefault();
      playCurrent();
      break;
    case 'Backspace':
      event.preventDefault();
      discardCurrent();
      break;
    case 's':
    case 'S':
    case 'ㄴ':
      event.preventDefault();
      saveCurrent();
      break;
    case 'ArrowDown':
      event.preventDefault();
      move(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      move(-1);
      break;
    case 'Escape':
      if (state.arming) cancelArming();
      else if (state.recording) stopRecording();
      player.pause();
      break;
    default:
  }
}

function init() {
  const trs = /** @type {HTMLTableRowElement[]} */ ([...document.querySelectorAll('tbody tr[data-id]')]);
  if (!trs.length) return;

  loadSettings();
  document.body.classList.add('rec-enabled');

  for (const tr of trs) {
    rows.push({
      tr,
      id: tr.dataset.id || '',
      text: tr.dataset.text || tr.querySelector('.script')?.textContent?.trim() || '',
      savedSrc: tr.dataset.src || '',
      pending: null,
    });
  }

  const toolbar = buildToolbar();
  document.querySelector('.table-wrap')?.before(toolbar);
  const bar = buildBar();
  document.body.append(bar);

  const pick = (root, role) => root.querySelector(`[data-role="${role}"]`);
  Object.assign(el, {
    server: pick(toolbar, 'server'),
    progressText: pick(toolbar, 'progress-text'),
    progressFill: pick(toolbar, 'progress-fill'),
    shown: pick(toolbar, 'shown'),
    filter: pick(toolbar, 'filter'),
    device: pick(toolbar, 'device'),
    query: pick(toolbar, 'query'),
    autoSave: pick(toolbar, 'auto-save'),
    autoNext: pick(toolbar, 'auto-next'),
    autoStop: pick(toolbar, 'auto-stop'),
    trim: pick(toolbar, 'trim'),
    leadIn: pick(toolbar, 'lead-in'),
    note: pick(toolbar, 'note'),
    position: pick(bar, 'position'),
    category: pick(bar, 'category'),
    file: pick(bar, 'file'),
    script: pick(bar, 'script'),
    levelFill: pick(bar, 'level-fill'),
    timer: pick(bar, 'timer'),
    record: pick(bar, 'record'),
    play: pick(bar, 'play'),
    discard: pick(bar, 'discard'),
    save: pick(bar, 'save'),
    delete: pick(bar, 'delete'),
    tts: pick(bar, 'tts'),
    prev: pick(bar, 'prev'),
    next: pick(bar, 'next'),
    status: pick(bar, 'status'),
  });

  el.autoSave.checked = state.settings.autoSave;
  el.autoNext.checked = state.settings.autoNext;
  el.autoStop.checked = state.settings.autoStop;
  el.trim.checked = state.settings.trim;
  el.leadIn.value = String(state.settings.leadInMs);
  el.filter.value = state.settings.filter;
  el.query.value = state.settings.query;

  el.record.addEventListener('click', () => toggleRecording());
  el.play.addEventListener('click', playCurrent);
  el.discard.addEventListener('click', discardCurrent);
  el.save.addEventListener('click', saveCurrent);
  el.delete.addEventListener('click', deleteCurrent);
  el.tts.addEventListener('click', playTts);
  el.prev.addEventListener('click', () => move(-1));
  el.next.addEventListener('click', () => move(1));
  el.autoSave.addEventListener('change', () => {
    state.settings.autoSave = el.autoSave.checked;
    saveSettings();
  });
  el.autoNext.addEventListener('change', () => {
    state.settings.autoNext = el.autoNext.checked;
    saveSettings();
  });
  el.autoStop.addEventListener('change', () => {
    state.settings.autoStop = el.autoStop.checked;
    saveSettings();
  });
  el.trim.addEventListener('change', () => {
    state.settings.trim = el.trim.checked;
    saveSettings();
  });
  el.leadIn.addEventListener('change', () => {
    state.settings.leadInMs = Number(el.leadIn.value);
    saveSettings();
  });
  el.filter.addEventListener('change', () => {
    state.settings.filter = el.filter.value;
    saveSettings();
    applyFilter();
  });
  el.query.addEventListener('input', () => {
    state.settings.query = el.query.value;
    saveSettings();
    applyFilter();
  });
  el.device.addEventListener('change', async () => {
    state.settings.deviceId = el.device.value;
    saveSettings();
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    try {
      await ensureStream();
      setStatus('마이크를 바꿨습니다.');
    } catch (error) {
      setStatus(`마이크 전환 실패: ${error.message}`, 'error');
    }
  });

  rows.forEach((row, index) => {
    row.tr.addEventListener('click', event => {
      if (event.target.closest('.copy-btn, .file-copy-btn')) return;
      setActive(index, { scroll: false });
    });
  });

  document.addEventListener('keydown', onKeydown);
  window.addEventListener('beforeunload', event => {
    if (rows.some(row => row.pending)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  // 하단 바 높이만큼 본문 아래 여백 확보
  const syncPadding = () => {
    document.querySelector('main').style.paddingBottom = `${bar.offsetHeight + 32}px`;
  };
  syncPadding();
  new ResizeObserver(syncPadding).observe(bar);

  applyFilter();
  updateProgress();
  // 처음엔 아직 녹음하지 않은 첫 대사에서 시작한다
  const firstTodo = rows.findIndex(row => !row.savedSrc && !row.tr.hidden);
  setActive(firstTodo >= 0 ? firstTodo : 0, { scroll: false });
  checkServer();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
