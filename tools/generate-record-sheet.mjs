#!/usr/bin/env node
// 녹음 대본 페이지 생성 — 읽으면서 외부 녹음기로 녹음하기 위한 페이지.
// 무엇을 녹음해야 하는지(신규·재녹음)만 추려서 큰 글씨로 보여 준다.
//
//   npm run sheet:voice          public/voice-record-sheet.html 생성
//   npm run sheet:voice -- --out=경로
//
// 상태는 tools/voice-audit.json(= npm run audit:voice -- --json)에서 읽는다.
// 파일 하나로 완결되어 개발 서버 없이 더블클릭으로 열어도 동작한다.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { collectVoiceLines } from './generate-voice-assets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outArg = process.argv.find(arg => arg.startsWith('--out='));
const outPath = path.resolve(root, outArg ? outArg.slice('--out='.length) : 'public/voice-record-sheet.html');

const CATEGORY_LABEL = {
  ui: '안내 · UI', game: '게임 안내', praise: '칭찬 · 격려', kingdom: '왕국 소개', story: '오프닝 이야기',
  festival: '축제', jamo: '자모 이름', 'jamo-intro': '자모 소개', words: '낱말', syllables: '음절',
  characters: '캐릭터 이름', 'map-continue': '지도 이어하기', dex: '도감 설명', build: '글자 조립',
  'boss-syllable': '보스 — 음절', 'word-game': '낱말 게임', 'boss-word': '보스 — 낱말',
};

/** @param {string} value */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 외부 녹음기로 저장할 파일 이름 — npm run import:voice 가 인식하는 규칙. @param {string} id */
function downloadName(id) {
  return `${id.replaceAll('/', ':')}.mp3.m4a`;
}

async function main() {
  const lines = collectVoiceLines();

  /** @type {{ unused: string[], recordings: Record<string, { src: string, text: string, issues: string[] }>, summary?: any }} */
  let audit = { unused: [], recordings: {} };
  try {
    audit = JSON.parse(await readFile(path.join(__dirname, 'voice-audit.json'), 'utf8'));
  } catch {
    console.warn('tools/voice-audit.json 이 없습니다. npm run audit:voice -- --json 을 먼저 실행하면 상태가 정확해집니다.');
  }
  const recorded = JSON.parse(await readFile(path.join(__dirname, 'recorded-assets.json'), 'utf8')).assets;

  const unused = new Set(audit.unused || []);
  const recordedByText = new Map(Object.entries(recorded));
  // 트림으로 고칠 수 있는 문제(무음·클릭)는 재녹음 대상이 아니다 — npm run trim:voice 로 처리한다
  const FIXABLE = /^(앞 무음|뒤 무음|끝부분 클릭)/;

  const items = lines.map((line, index) => {
    const asset = recordedByText.get(line.text);
    const entry = asset ? audit.recordings?.[asset.id] : undefined;
    const issues = entry?.issues ?? [];
    const blocking = issues.filter(issue => !FIXABLE.test(issue));
    const trimmable = issues.filter(issue => FIXABLE.test(issue));

    let status = 'todo';
    let reason = '아직 녹음 없음';
    if (unused.has(line.id)) {
      status = 'skip';
      reason = '앱이 사용하지 않는 대사 — 녹음하지 않아도 됩니다';
    } else if (asset && blocking.length) {
      status = 'redo';
      reason = blocking.join(', ');
    } else if (asset && trimmable.length) {
      status = 'trim';
      reason = `${trimmable.join(', ')} — npm run trim:voice 로 해결`;
    } else if (asset) {
      status = 'done';
      reason = '녹음 완료';
    }
    return {
      index: index + 1,
      id: line.id,
      text: line.text,
      category: line.id.split('/')[0],
      file: downloadName(line.id),
      status,
      reason,
    };
  });

  const counts = items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, /** @type {Record<string, number>} */ ({}));
  const needed = items.filter(item => item.status === 'todo' || item.status === 'redo');

  // 녹음할 것 → 같은 분류끼리 모아 두면 목소리 톤을 유지하기 쉽다
  const order = Object.keys(CATEGORY_LABEL);
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.category)) grouped.set(item.category, []);
    grouped.get(item.category).push(item);
  }
  const categories = [...grouped.keys()].sort((a, b) => {
    const ai = order.indexOf(a); const bi = order.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  const sections = categories.map(category => {
    const list = grouped.get(category);
    const rows = list.map(item => `
        <li class="row" data-status="${item.status}" data-index="${item.index}" data-text="${escapeHtml(item.text)}">
          <label class="check"><input type="checkbox" data-id="${escapeHtml(item.id)}"><span></span></label>
          <div class="body">
            <p class="script">${escapeHtml(item.text)}</p>
            <p class="meta">
              <span class="badge ${item.status}">${{ todo: '녹음 필요', redo: '재녹음', trim: '다듬기', done: '완료', skip: '제외' }[item.status]}</span>
              <button class="file" type="button" data-copy="${escapeHtml(item.file)}">${escapeHtml(item.file)}</button>
              <span class="reason">${escapeHtml(item.reason)}</span>
            </p>
          </div>
          <span class="num">${item.index}</span>
        </li>`).join('');
    const todoCount = list.filter(item => item.status === 'todo' || item.status === 'redo').length;
    return `
      <section class="group" data-category="${escapeHtml(category)}">
        <h2>${escapeHtml(CATEGORY_LABEL[category] || category)} <small>${escapeHtml(category)} · 녹음할 것 ${todoCount} / 전체 ${list.length}</small></h2>
        <ol class="rows">${rows}
        </ol>
      </section>`;
  }).join('');

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>누리의 한글 왕국 — 녹음 대본</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f7f5ef; --paper: #fffdf8; --ink: #26231f; --muted: #6d675d; --line: #ded6c8;
    --accent: #2f7d80; --todo: #b8541f; --redo: #a5301f; --trim: #8a6b12; --done: #2f7d55;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); line-height: 1.5;
    font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
  main { max-width: 1000px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { margin: 0 0 6px; font-size: clamp(1.6rem, 4vw, 2.4rem); }
  .lead { margin: 0; color: var(--muted); }
  .summary { display: flex; flex-wrap: wrap; gap: 10px; margin: 20px 0; }
  .stat { flex: 1 1 120px; padding: 12px 14px; background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }
  .stat strong { display: block; font-size: 1.8rem; line-height: 1.1; }
  .stat.todo strong { color: var(--todo); } .stat.redo strong { color: var(--redo); }
  .stat.trim strong { color: var(--trim); } .stat.done strong { color: var(--done); }
  .howto { padding: 14px 16px; margin-bottom: 18px; background: #fff8e6; border: 1px solid #e6d9b0; border-radius: 8px; font-size: 0.94rem; }
  .howto code { background: #fff; padding: 1px 5px; border: 1px solid var(--line); border-radius: 4px; }
  .toolbar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    padding: 10px 12px; margin-bottom: 16px; background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }
  .toolbar button, .toolbar input { font: inherit; }
  .chip { padding: 6px 12px; background: #fff; border: 1px solid var(--line); border-radius: 999px; cursor: pointer; }
  .chip[aria-pressed="true"] { color: #fff; background: var(--accent); border-color: var(--accent); }
  .toolbar input[type="search"] { flex: 1 1 160px; min-width: 120px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 6px; }
  .group { margin: 0 0 26px; }
  .group h2 { font-size: 1.15rem; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 2px solid var(--line); }
  .group h2 small { font-weight: 400; color: var(--muted); font-size: 0.82rem; }
  .rows { margin: 0; padding: 0; list-style: none; }
  .row { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; margin-bottom: 8px;
    background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }
  .row[hidden] { display: none; }
  .row.checked { opacity: 0.5; }
  .row.checked .script { text-decoration: line-through; }
  .body { flex: 1 1 auto; min-width: 0; }
  .script { margin: 0; font-size: clamp(1.15rem, 2.2vw, 1.5rem); font-weight: 700; word-break: keep-all; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 6px 0 0; font-size: 0.82rem; color: var(--muted); }
  .badge { padding: 2px 8px; color: #fff; border-radius: 999px; font-size: 0.76rem; }
  .badge.todo { background: var(--todo); } .badge.redo { background: var(--redo); }
  .badge.trim { background: var(--trim); } .badge.done { background: var(--done); } .badge.skip { background: #9a938a; }
  .file { padding: 2px 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem;
    color: #334; background: #fff; border: 1px solid var(--line); border-radius: 4px; cursor: pointer; }
  .file.copied { color: #fff; background: var(--done); border-color: var(--done); }
  .num { color: #b7b0a4; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
  .check input { width: 20px; height: 20px; margin-top: 6px; }
  .check span { display: none; }

  /* 집중 모드 — 한 줄씩 크게 보며 읽기 */
  .focus { position: fixed; inset: 0; z-index: 20; display: none; flex-direction: column; justify-content: center;
    padding: 40px; text-align: center; background: var(--paper); }
  body.focus-on .focus { display: flex; }
  .focus .script { font-size: clamp(2rem, 7vw, 4.5rem); line-height: 1.3; }
  .focus .file { margin: 18px auto 0; font-size: 1rem; }
  .focus .pos { color: var(--muted); }
  .focus .hint { position: absolute; bottom: 24px; left: 0; right: 0; color: var(--muted); font-size: 0.9rem; }
  .focus .nav { display: flex; gap: 12px; justify-content: center; margin-top: 26px; }
  .focus .nav button { min-height: 46px; padding: 10px 20px; font-size: 1rem; background: #fff;
    border: 1px solid var(--line); border-radius: 8px; cursor: pointer; }

  @media print {
    .toolbar, .howto, .summary, .check, .focus { display: none !important; }
    body { background: #fff; }
    .row { break-inside: avoid; border-color: #ccc; }
    .row[data-status="done"], .row[data-status="skip"] { display: none; }
  }
</style>
</head>
<body>
<main>
  <h1>녹음 대본</h1>
  <p class="lead">누리의 한글 왕국 — 육성 녹음용. 읽을 것만 추려 두었습니다. 생성 시각 기준 상태입니다.</p>

  <div class="summary">
    <div class="stat todo"><strong>${counts.todo || 0}</strong>녹음 필요</div>
    <div class="stat redo"><strong>${counts.redo || 0}</strong>재녹음</div>
    <div class="stat trim"><strong>${counts.trim || 0}</strong>다듬기로 해결</div>
    <div class="stat done"><strong>${counts.done || 0}</strong>완료</div>
    <div class="stat"><strong>${counts.skip || 0}</strong>제외(앱 미사용)</div>
  </div>

  <div class="howto">
    <strong>녹음 방법</strong> — 대사를 읽어 한 문장에 파일 하나로 저장합니다. 파일 이름은 각 줄의 회색 버튼을 눌러 복사하세요
    (<code>분류:파일명.mp3.m4a</code> 형식). 저장 위치는 <code>~/Downloads</code>.
    다 녹음했으면 <code>npm run import:voice</code> 로 프로젝트에 반영합니다.<br>
    이미 녹음된 것 중 앞뒤 무음·키보드 소리가 섞인 <strong>${counts.trim || 0}개</strong>는 다시 녹음하지 않아도 됩니다 —
    <code>npm run trim:voice</code> 한 번이면 다듬어집니다.
  </div>

  <div class="toolbar">
    <button class="chip" type="button" data-filter="need" aria-pressed="true">녹음할 것 ${needed.length}</button>
    <button class="chip" type="button" data-filter="todo" aria-pressed="false">신규 ${counts.todo || 0}</button>
    <button class="chip" type="button" data-filter="redo" aria-pressed="false">재녹음 ${counts.redo || 0}</button>
    <button class="chip" type="button" data-filter="trim" aria-pressed="false">다듬기 ${counts.trim || 0}</button>
    <button class="chip" type="button" data-filter="done" aria-pressed="false">완료 ${counts.done || 0}</button>
    <button class="chip" type="button" data-filter="skip" aria-pressed="false">제외 ${counts.skip || 0}</button>
    <button class="chip" type="button" data-filter="all" aria-pressed="false">전체 ${items.length}</button>
    <input type="search" placeholder="대사·파일 검색" data-role="query">
    <button class="chip" type="button" data-role="focus">집중 모드 (F)</button>
    <button class="chip" type="button" data-role="reset-check">체크 초기화</button>
  </div>

  ${sections}
</main>

<div class="focus">
  <p class="pos" data-role="focus-pos"></p>
  <p class="script" data-role="focus-text"></p>
  <button class="file" type="button" data-role="focus-file"></button>
  <div class="nav">
    <button type="button" data-role="focus-prev">← 이전</button>
    <button type="button" data-role="focus-check">읽음 표시 (Space)</button>
    <button type="button" data-role="focus-next">다음 →</button>
    <button type="button" data-role="focus-exit">닫기 (Esc)</button>
  </div>
  <p class="hint">←/→ 이동 · Space 읽음 표시하고 다음 · Esc 닫기</p>
</div>

<script>
(function () {
  var KEY = 'nuri-record-sheet-checked';
  var rows = Array.prototype.slice.call(document.querySelectorAll('.row'));
  var checked = {};
  try { checked = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { checked = {}; }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(checked)); } catch (e) { /* 무시 */ } }

  rows.forEach(function (row) {
    var box = row.querySelector('input[type="checkbox"]');
    if (checked[box.dataset.id]) { box.checked = true; row.classList.add('checked'); }
    box.addEventListener('change', function () {
      if (box.checked) checked[box.dataset.id] = 1; else delete checked[box.dataset.id];
      row.classList.toggle('checked', box.checked);
      save();
    });
  });

  var filter = 'need';
  var query = '';
  function apply() {
    rows.forEach(function (row) {
      var status = row.dataset.status;
      var okStatus = filter === 'all' ? true
        : filter === 'need' ? (status === 'todo' || status === 'redo')
        : status === filter;
      var okQuery = !query || row.dataset.text.indexOf(query) >= 0
        || row.querySelector('.file').textContent.indexOf(query) >= 0;
      row.hidden = !(okStatus && okQuery);
    });
    document.querySelectorAll('.group').forEach(function (group) {
      var visible = group.querySelectorAll('.row:not([hidden])').length;
      group.hidden = visible === 0;
    });
  }
  document.querySelectorAll('[data-filter]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      filter = chip.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(function (other) {
        other.setAttribute('aria-pressed', String(other === chip));
      });
      apply();
    });
  });
  document.querySelector('[data-role="query"]').addEventListener('input', function (event) {
    query = event.target.value.trim();
    apply();
  });
  document.querySelector('[data-role="reset-check"]').addEventListener('click', function () {
    checked = {}; save();
    rows.forEach(function (row) {
      row.classList.remove('checked');
      row.querySelector('input[type="checkbox"]').checked = false;
    });
  });

  function copy(text, button) {
    var done = function () {
      var previous = button.textContent;
      button.textContent = '복사됨';
      button.classList.add('copied');
      setTimeout(function () { button.textContent = previous; button.classList.remove('copied'); }, 1000);
    };
    if (navigator.clipboard) { navigator.clipboard.writeText(text).then(done, done); return; }
    var area = document.createElement('textarea');
    area.value = text; document.body.appendChild(area); area.select();
    try { document.execCommand('copy'); } catch (e) { /* 무시 */ }
    area.remove(); done();
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('.file') : null;
    if (button && button.dataset.copy) copy(button.dataset.copy, button);
  });

  // ── 집중 모드 ──────────────────────────────────────────────
  var focusIndex = 0;
  var focusText = document.querySelector('[data-role="focus-text"]');
  var focusPos = document.querySelector('[data-role="focus-pos"]');
  var focusFile = document.querySelector('[data-role="focus-file"]');
  function visibleRows() { return rows.filter(function (row) { return !row.hidden; }); }
  function renderFocus() {
    var list = visibleRows();
    if (!list.length) { exitFocus(); return; }
    focusIndex = Math.max(0, Math.min(focusIndex, list.length - 1));
    var row = list[focusIndex];
    focusText.textContent = row.dataset.text;
    focusPos.textContent = (focusIndex + 1) + ' / ' + list.length + '  ·  #' + row.dataset.index;
    var file = row.querySelector('.file').dataset.copy;
    focusFile.textContent = file;
    focusFile.dataset.copy = file;
  }
  function enterFocus() { document.body.classList.add('focus-on'); renderFocus(); }
  function exitFocus() { document.body.classList.remove('focus-on'); }
  function step(delta) { focusIndex += delta; renderFocus(); }
  function markRead() {
    var list = visibleRows();
    var row = list[focusIndex];
    if (!row) return;
    var box = row.querySelector('input[type="checkbox"]');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    step(1);
  }
  document.querySelector('[data-role="focus"]').addEventListener('click', enterFocus);
  document.querySelector('[data-role="focus-exit"]').addEventListener('click', exitFocus);
  document.querySelector('[data-role="focus-prev"]').addEventListener('click', function () { step(-1); });
  document.querySelector('[data-role="focus-next"]').addEventListener('click', function () { step(1); });
  document.querySelector('[data-role="focus-check"]').addEventListener('click', markRead);

  document.addEventListener('keydown', function (event) {
    if (event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    var on = document.body.classList.contains('focus-on');
    if (!on && (event.key === 'f' || event.key === 'F')) { event.preventDefault(); enterFocus(); return; }
    if (!on) return;
    if (event.key === 'Escape') { event.preventDefault(); exitFocus(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    else if (event.key === ' ') { event.preventDefault(); markRead(); }
  });

  apply();
})();
</script>
</body>
</html>
`;

  await writeFile(outPath, html);
  console.log(`${path.relative(root, outPath)} 생성 — 녹음할 것 ${needed.length}개 (신규 ${counts.todo || 0} · 재녹음 ${counts.redo || 0}), 다듬기 ${counts.trim || 0}, 완료 ${counts.done || 0}, 제외 ${counts.skip || 0}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
