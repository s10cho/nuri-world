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
  server: false,
  ffmpeg: false,
  mimeType: '',
  settings: { autoSave: true, autoNext: true, filter: 'all', query: '', deviceId: '' },
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
let startedAt = 0;
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
  if (audioCtx.state === 'suspended') await audioCtx.resume();
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

function drawLevel() {
  if (!analyser) return;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let peak = 0;
  for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
  el.levelFill.style.width = `${Math.min(100, (peak / 128) * 140)}%`;
  levelRaf = requestAnimationFrame(drawLevel);
}

function tickTimer() {
  const seconds = (Date.now() - startedAt) / 1000;
  el.timer.textContent = `${seconds.toFixed(1)}s`;
}

async function startRecording() {
  const row = current();
  if (!row || state.recording) return;
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

  /** @type {BlobPart[]} */
  const chunks = [];
  state.mimeType = pickMimeType();
  recorder = new MediaRecorder(stream, state.mimeType ? { mimeType: state.mimeType } : undefined);
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = () => {
    const type = recorder?.mimeType || state.mimeType || 'audio/webm';
    const blob = new Blob(chunks, { type });
    state.recording = false;
    row.tr.classList.remove('rec-recording');
    cancelAnimationFrame(levelRaf);
    clearInterval(timerId);
    el.levelFill.style.width = '0';
    if (!blob.size) {
      setStatus('녹음된 소리가 없습니다. 마이크를 확인해 주세요.', 'error');
      renderBar();
      return;
    }
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
  row.tr.classList.add('rec-recording');
  row.tr.classList.remove('rec-pending');
  timerId = setInterval(tickTimer, 100);
  drawLevel();
  setStatus('녹음 중… 다 읽으면 스페이스바로 정지하세요.');
  renderBar();
}

function stopRecording() {
  if (!state.recording || !recorder) return;
  recorder.stop();
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
  el.record.classList.toggle('recording', state.recording);
  el.record.firstChild.textContent = state.recording ? '■ 정지' : pending ? '● 다시 녹음' : '● 녹음';
  el.play.disabled = !pending && !row.savedSrc;
  el.play.firstChild.textContent = pending ? '▶ 방금 녹음' : '▶ 저장본';
  el.discard.disabled = !pending;
  el.save.disabled = !pending;
  el.save.firstChild.textContent = state.server ? '💾 저장' : '⤓ 내려받기';
  el.delete.disabled = !row.savedSrc;
  el.delete.firstChild.textContent = deleteArmedFor === row.id ? '🗑 정말 삭제' : '🗑 삭제';
  el.tts.disabled = !row.tr.dataset.tts;
  if (!state.recording) el.timer.textContent = pending ? '녹음됨' : row.savedSrc ? '저장됨' : '—';
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
    state.ffmpeg = !!result.ffmpeg;
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
  if (!state.server) notes.push('npm run dev 로 연 페이지에서만 파일을 바로 저장할 수 있습니다. 지금은 내려받은 뒤 npm run import:voice 로 반입하세요.');
  else if (type.includes('webm') && !state.ffmpeg) {
    notes.push('이 브라우저는 webm(opus)로만 녹음할 수 있고 서버에 ffmpeg가 없습니다 — iOS 앱에서 재생되지 않을 수 있어요. brew install ffmpeg 후 npm run convert:voice 로 변환하거나, Safari로 녹음하면 바로 m4a로 저장됩니다.');
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
      state.recording ? stopRecording() : startRecording();
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
      if (state.recording) stopRecording();
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
  el.filter.value = state.settings.filter;
  el.query.value = state.settings.query;

  el.record.addEventListener('click', () => (state.recording ? stopRecording() : startRecording()));
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
