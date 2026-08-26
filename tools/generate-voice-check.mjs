#!/usr/bin/env node
// 녹음 검증 페이지 생성 — 대사를 읽으면서 실제 음원을 들어 보고 맞는지 확인하는 화면.
//
//   npm run verify:voice           public/voice-check.html 생성
//   npm run verify:voice -- --out=경로
//
// 상태는 manifest.json(어떤 파일이 재생되는지) · recorded-assets.json(육성 여부) ·
// tools/voice-audit.json(품질 문제)에서 읽는다. 판정 결과는 브라우저에 저장된다.
// 파일 하나로 완결되어 개발 서버 없이 열어도 되고, 휴대폰에서도 볼 수 있게 반응형이다.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { collectVoiceLines } from './generate-voice-assets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outArg = process.argv.find(arg => arg.startsWith('--out='));
const outPath = path.resolve(root, outArg ? outArg.slice('--out='.length) : 'public/voice-check.html');

// 검증할 때 같은 분류끼리 이어서 듣는 편이 판단하기 쉽다
export const CATEGORY_LABEL = {
  ui: '안내 · UI', game: '게임 안내', praise: '칭찬 · 격려', kingdom: '왕국 소개', story: '오프닝 이야기',
  festival: '축제', jamo: '자모 이름', 'jamo-intro': '자모 소개', words: '낱말', syllables: '음절',
  characters: '캐릭터 이름', 'map-continue': '지도 이어하기', dex: '도감 설명', build: '글자 조립',
  'boss-syllable': '보스 — 음절', 'word-game': '낱말 게임', 'boss-word': '보스 — 낱말',
};

/**
 * 대사를 분류 묶음 순서로 정렬한다. match:voice --align=sheet 가 같은 순서를 쓴다.
 * @template {{ id: string }} T @param {T[]} lines @returns {T[]}
 */
export function sheetOrder(lines) {
  const order = Object.keys(CATEGORY_LABEL);
  const rank = category => {
    const index = order.indexOf(category);
    return index < 0 ? order.length : index;
  };
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => {
      const diff = rank(a.line.id.split('/')[0]) - rank(b.line.id.split('/')[0]);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(entry => entry.line);
}

/** @param {string} value */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 외부 녹음기로 저장할 파일 이름 — match:voice / import:voice 가 인식하는 규칙 */
function downloadName(id) {
  return `${id.replaceAll('/', ':')}.mp3.m4a`;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const lines = collectVoiceLines();
  const manifest = await readJson(path.join(root, 'public/assets/audio/ko/manifest.json'), { assets: {} });
  const recorded = (await readJson(path.join(__dirname, 'recorded-assets.json'), { assets: {} })).assets;
  const audit = await readJson(path.join(__dirname, 'voice-audit.json'), { unused: [], recordings: {} });
  // 아직 어느 대사에도 배치되지 않은 녹음 (npm run pending:voice 가 옮겨 둔 것)
  const pending = (await readJson(path.join(__dirname, 'voice-pending.json'), { items: [] })).items || [];
  const unused = new Set(audit.unused || []);

  const items = sheetOrder(lines.map((line, index) => {
    const asset = manifest.assets?.[line.text];
    const isRecorded = Object.prototype.hasOwnProperty.call(recorded, line.text);
    const issues = isRecorded ? (audit.recordings?.[recorded[line.text].id]?.issues ?? []) : [];
    const needsVoice = !unused.has(line.id) && (!isRecorded || issues.length > 0);
    return {
      index: index + 1,
      needsVoice,
      id: line.id,
      text: line.text,
      category: line.id.split('/')[0],
      src: asset?.src || '',
      kind: !asset ? 'none' : isRecorded ? 'voice' : 'tts',
      issues,
      skip: unused.has(line.id),
      file: downloadName(line.id),
    };
  }));

  const counts = items.reduce((acc, item) => {
    const key = item.skip ? 'skip' : item.kind;
    acc[key] = (acc[key] || 0) + 1;
    if (!item.skip && item.issues.length) acc.issue = (acc.issue || 0) + 1;
    if (item.needsVoice) acc.need = (acc.need || 0) + 1;
    return acc;
  }, /** @type {Record<string, number>} */ ({}));
  const target = items.filter(item => !item.skip).length;

  const rows = items.map(item => {
    const badge = { voice: '🎙️ 육성', tts: '🤖 TTS', none: '⬜ 없음' }[item.kind];
    return `
      <li class="row" data-index="${item.index}" data-order="${item.index}" data-kind="${item.kind}" data-skip="${item.skip ? 1 : 0}"
          data-issue="${item.issues.length ? 1 : 0}" data-need="${item.needsVoice ? 1 : 0}" data-id="${escapeHtml(item.id)}"
          data-src="${escapeHtml(item.src)}" data-text="${escapeHtml(item.text)}">
        <div class="row-top">
          <span class="num">#${item.index}</span>
          <span class="seq" data-role="seq" hidden></span>
          <span class="badge cat">${escapeHtml(CATEGORY_LABEL[item.category] || item.category)}</span>
          <span class="badge ${item.kind}">${badge}</span>
          ${item.skip ? '<span class="badge skip">앱 미사용</span>' : ''}
          ${item.issues.length ? `<span class="badge issue">${escapeHtml(item.issues.join(', '))}</span>` : ''}
          <span class="verdict-mark" data-role="mark"></span>
        </div>
        <p class="script">${escapeHtml(item.text)}</p>
        <div class="row-actions">
          <button class="btn play" type="button" data-role="play" ${item.src ? '' : 'disabled'}>▶ 듣기</button>
          <button class="btn ok" type="button" data-role="ok">✅ 맞음</button>
          <button class="btn bad" type="button" data-role="bad">❌ 문제</button>
          <button class="file" type="button" data-copy="${escapeHtml(item.file)}">${escapeHtml(item.src.replace(/^assets\/audio\/ko\//, '') || item.file)}</button>
        </div>
      </li>`;
  }).join('');

  const needOptions = items.filter(item => item.needsVoice)
    .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.text)}</option>`).join('');

  const pendingRows = pending.map((item, index) => `
      <li class="row pending-row" data-hash="${escapeHtml(item.hash)}" data-src="${escapeHtml(item.src)}"
          data-source="${escapeHtml(item.source)}">
        <div class="row-top">
          <span class="num">파일 ${index + 1}</span>
          <span class="badge cat">${escapeHtml(item.when)}</span>
          ${item.durationMs ? `<span class="badge">${(item.durationMs / 1000).toFixed(1)}초</span>` : ''}
          <span class="verdict-mark" data-role="pending-mark"></span>
        </div>
        <p class="script">${escapeHtml(item.transcript || '(인식 결과 없음)')}</p>
        <div class="row-actions">
          <button class="btn play" type="button" data-role="pending-play">▶ 듣기</button>
          <select class="pick" data-role="pick">
            <option value="">— 어느 대사인가요? —</option>
            ${needOptions}
          </select>
        </div>
      </li>`).join('');

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#2f7d80">
<title>누리의 한글 왕국 — 녹음 검증</title>
<style>
  :root {
    color-scheme: light;
    --bg:#f7f5ef; --paper:#fffdf8; --ink:#26231f; --muted:#6d675d; --line:#ded6c8;
    --accent:#2f7d80; --ok:#2f7d55; --bad:#a5301f; --warn:#8a6b12;
    --bar: 118px;
  }
  * { box-sizing:border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin:0; }
  body {
    background:var(--bg); color:var(--ink); line-height:1.5;
    font-family:-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
    padding-bottom: calc(var(--bar) + env(safe-area-inset-bottom));
  }
  main { max-width:1000px; margin:0 auto; padding:20px 14px 24px; }
  h1 { margin:0 0 4px; font-size:clamp(1.4rem,4.5vw,2rem); }
  .lead { margin:0 0 14px; color:var(--muted); font-size:0.92rem; }

  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(88px,1fr)); gap:8px; margin-bottom:12px; }
  .stat { padding:10px; text-align:center; background:var(--paper); border:1px solid var(--line); border-radius:10px; }
  .stat strong { display:block; font-size:1.35rem; line-height:1.2; }
  .stat.voice strong { color:var(--ok); } .stat.tts strong { color:var(--warn); }
  .stat.none strong { color:var(--bad); } .stat.done strong { color:var(--accent); }

  .toolbar { position:sticky; top:0; z-index:5; padding:10px 0; margin-bottom:10px; background:var(--bg); }
  .chips { display:flex; gap:6px; overflow-x:auto; padding-bottom:4px; -webkit-overflow-scrolling:touch; }
  .chips::-webkit-scrollbar { display:none; }
  .chip { flex:0 0 auto; min-height:38px; padding:8px 14px; font:inherit; font-size:0.88rem;
    background:var(--paper); border:1px solid var(--line); border-radius:999px; cursor:pointer; }
  .chip[aria-pressed="true"] { color:#fff; background:var(--accent); border-color:var(--accent); }
  .search { display:flex; gap:8px; margin-top:8px; }
  .search input { flex:1; min-width:0; min-height:40px; padding:8px 12px; font:inherit;
    background:var(--paper); border:1px solid var(--line); border-radius:10px; }
  .search button { min-height:40px; padding:8px 12px; font:inherit; background:var(--paper);
    border:1px solid var(--line); border-radius:10px; cursor:pointer; }

  .rows { margin:0; padding:0; list-style:none; }
  .row { padding:12px 14px; margin-bottom:10px; background:var(--paper);
    border:1px solid var(--line); border-left:5px solid var(--line); border-radius:10px; }
  .row[hidden] { display:none; }
  .row.current { border-left-color:var(--accent); box-shadow:0 0 0 2px rgba(47,125,128,0.18); }
  .row.playing { background:#f2faf8; }
  .row[data-verdict="ok"] { border-left-color:var(--ok); }
  .row[data-verdict="bad"] { border-left-color:var(--bad); background:#fff4f1; }

  .row-top { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:6px; font-size:0.76rem; }
  .num { color:#b7b0a4; font-variant-numeric:tabular-nums; }
  .badge { padding:2px 8px; border-radius:999px; background:#efe8dc; color:#5b544a; }
  .badge.voice { color:#fff; background:var(--ok); }
  .badge.tts { color:#fff; background:var(--warn); }
  .badge.none { color:#fff; background:var(--bad); }
  .badge.skip { color:#fff; background:#9a938a; }
  .badge.issue { color:#fff; background:#b8541f; }
  .verdict-mark { margin-left:auto; font-size:1rem; }

  .script { margin:0 0 10px; font-size:clamp(1.15rem,4.4vw,1.45rem); font-weight:700;
    word-break:keep-all; overflow-wrap:anywhere; }

  .row-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .btn { flex:1 1 auto; min-height:44px; min-width:84px; padding:10px 14px; font:inherit; font-weight:600;
    background:#fff; border:1px solid var(--line); border-radius:10px; cursor:pointer; }
  .btn.play { color:#fff; background:var(--accent); border-color:#256467; flex-basis:38%; }
  .btn.play:disabled { color:#a9a294; background:#e8e2d7; border-color:var(--line); cursor:default; }
  .btn.ok[aria-pressed="true"] { color:#fff; background:var(--ok); border-color:#24603f; }
  .btn.bad[aria-pressed="true"] { color:#fff; background:var(--bad); border-color:#7f2416; }
  .file { flex:1 1 100%; padding:6px 8px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:0.74rem; color:#4a463f; text-align:left; background:#f4efe4;
    border:1px solid var(--line); border-radius:8px; cursor:pointer; overflow:hidden; text-overflow:ellipsis; }
  .file.copied { color:#fff; background:var(--ok); border-color:var(--ok); }

  .chip.need[aria-pressed="true"] { background:#b8541f; border-color:#b8541f; }
  .chip.pending[aria-pressed="true"] { background:#4a5aa8; border-color:#4a5aa8; }
  .pending-row { border-left-color:#4a5aa8; }
  .pending-row.picked { border-left-color:var(--ok); background:#f2faf5; }
  .pending-row .script { font-size:1rem; font-weight:600; color:var(--muted); }
  .pick { flex:1 1 100%; min-height:44px; padding:10px; font:inherit; font-size:0.92rem;
    background:#fff; border:1px solid var(--line); border-radius:10px; }
  @media (min-width:720px) { .pick { flex:1 1 auto; max-width:420px; } }
  .stat.need strong { color:#b8541f; }
  .seq { padding:2px 8px; color:#fff; background:#b8541f; border-radius:999px; font-weight:700; }
  .record-hint { padding:12px 14px; margin:0 0 12px; font-size:0.88rem; line-height:1.6;
    background:#fff8e6; border:1px solid #e6d9b0; border-radius:10px; }
  .record-hint code { display:inline-block; padding:1px 6px; margin:2px 0; font-size:0.82rem;
    background:#fff; border:1px solid var(--line); border-radius:4px; }
  .row[data-need="1"] { border-left-color:#b8541f; }

  .group-title { margin:18px 0 8px; padding-bottom:6px; font-size:1rem;
    border-bottom:2px solid var(--line); color:var(--muted); }

  /* 하단 고정 바 — 한 손으로 듣고 판정하기 */
  .bar { position:fixed; left:0; right:0; bottom:0; z-index:10;
    padding:8px 12px calc(8px + env(safe-area-inset-bottom));
    background:var(--paper); border-top:1px solid var(--line); box-shadow:0 -4px 18px rgba(0,0,0,0.08); }
  .bar-inner { display:flex; flex-wrap:wrap; gap:8px; align-items:center; max-width:1000px; margin:0 auto; }
  .bar .btn { flex:1 1 0; min-width:56px; padding:10px 8px; white-space:nowrap; }
  .bar .btn.wide { flex:2.4 1 0; }
  .progress { flex-basis:100%; height:6px; margin-bottom:6px; overflow:hidden;
    background:#e7e0d3; border-radius:999px; }
  .progress > i { display:block; height:100%; width:0; background:var(--accent); transition:width .2s; }
  .bar-status { flex-basis:100%; margin-top:2px; font-size:0.78rem; color:var(--muted); text-align:center;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  @media (min-width:720px) {
    .row-actions .btn { flex:0 0 auto; }
    .file { flex:1 1 auto; }
    .bar-inner { gap:10px; }
  }
  @media (prefers-reduced-motion:reduce) { * { transition:none !important; } }
</style>
</head>
<body>
<main>
  <h1>녹음 검증</h1>
  <p class="lead">대사를 보면서 실제 재생되는 음원을 듣고 맞는지 확인합니다. 판정은 이 브라우저에 저장됩니다.</p>

  <div class="stats">
    <div class="stat voice"><strong>${counts.voice || 0}</strong>육성</div>
    <div class="stat tts"><strong>${counts.tts || 0}</strong>TTS</div>
    <div class="stat none"><strong>${counts.none || 0}</strong>없음</div>
    <div class="stat done"><strong data-role="checked">0</strong>확인함</div>
    <div class="stat"><strong data-role="bad-count">0</strong>문제</div>
    <div class="stat need"><strong>${counts.need || 0}</strong>육성 필요</div>
  </div>

  <div class="toolbar">
    <div class="chips">
      ${pending.length ? `<button class="chip pending" type="button" data-filter="pending" aria-pressed="false">📥 미반입 녹음 ${pending.length}</button>` : ''}
      <button class="chip need" type="button" data-filter="need" aria-pressed="false">🎙️ 육성 필요 ${counts.need || 0}</button>
      <button class="chip" type="button" data-filter="todo" aria-pressed="true">미확인</button>
      <button class="chip" type="button" data-filter="all" aria-pressed="false">전체 ${items.length}</button>
      <button class="chip" type="button" data-filter="voice" aria-pressed="false">육성 ${counts.voice || 0}</button>
      <button class="chip" type="button" data-filter="tts" aria-pressed="false">TTS ${counts.tts || 0}</button>
      <button class="chip" type="button" data-filter="none" aria-pressed="false">없음 ${counts.none || 0}</button>
      <button class="chip" type="button" data-filter="bad" aria-pressed="false">문제</button>
      <button class="chip" type="button" data-filter="ok" aria-pressed="false">확인됨</button>
      <button class="chip" type="button" data-filter="issue" aria-pressed="false">품질경고 ${counts.issue || 0}</button>
      <button class="chip" type="button" data-filter="skip" aria-pressed="false">앱 미사용 ${counts.skip || 0}</button>
    </div>
    <div class="search">
      <input type="search" data-role="query" placeholder="대사·파일 검색" enterkeyhint="search">
      <button class="chip" type="button" data-role="copy-bad">문제 목록 복사</button>
      <button class="chip" type="button" data-role="reset">초기화</button>
    </div>
  </div>

  <p class="record-hint" data-role="record-hint" hidden>
    <strong>녹음 순서</strong> — 아래 <strong data-role="need-count">0</strong>개를 <strong>이 순서 그대로</strong> 위에서부터 읽어 녹음하세요.
    파일 이름은 아무래도 상관없고, 순서만 지키면 됩니다. 다 녹음해 한 폴더에 모은 뒤:
    <code>npm run match:voice -- --align=list --dry-run</code> 으로 확인하고, 맞으면 <code>--dry-run</code> 을 빼고 실행하세요.
    ▶︎듣기를 누르면 지금 쓰이는 TTS 음성을 참고로 들을 수 있습니다.
  </p>

  <p class="record-hint" data-role="pending-hint" hidden>
    <strong>미반입 녹음 ${pending.length}개</strong> — 어느 대사인지 못 가려 배치하지 않은 파일입니다.
    들어 보고 아래 목록에서 해당 대사를 고르세요(육성이 필요한 것만 나옵니다).
    다 고른 뒤 <strong>매칭 목록 복사</strong>를 눌러 그대로 넘겨 주시면 한 번에 배치됩니다.
    앱이 쓰지 않는 대사(단독 음절·낱말)를 읽은 파일이나 재테이크는 그냥 두시면 됩니다.
    <button class="chip" type="button" data-role="copy-picks" style="margin-top:6px">📋 매칭 목록 복사</button>
  </p>

  <ol class="rows">${rows}
  </ol>
  <ol class="rows pending-list" data-role="pending-list" hidden>${pendingRows}
  </ol>
</main>

<div class="bar">
  <div class="bar-inner">
    <div class="progress"><i data-role="progress"></i></div>
    <button class="btn" type="button" data-role="prev">↑</button>
    <button class="btn wide play" type="button" data-role="bar-play">▶ 듣기</button>
    <button class="btn ok" type="button" data-role="bar-ok">✅</button>
    <button class="btn bad" type="button" data-role="bar-bad">❌</button>
    <button class="btn" type="button" data-role="next">↓</button>
    <div class="bar-status" data-role="bar-status">항목을 고르면 여기서 바로 듣고 판정할 수 있어요</div>
  </div>
</div>

<script>
(function () {
  var KEY = 'nuri-voice-check-verdicts';
  var rows = Array.prototype.slice.call(document.querySelectorAll('.rows:not(.pending-list) > .row'));
  var audio = new Audio();
  var verdicts = {};
  var current = -1;
  var filter = 'todo';
  var query = '';
  var autoNext = true;

  try { verdicts = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { verdicts = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(verdicts)); } catch (e) {} }

  var el = function (role, scope) { return (scope || document).querySelector('[data-role="' + role + '"]'); };

  function paint(row) {
    var id = row.dataset.id;
    var verdict = verdicts[id] || '';
    row.dataset.verdict = verdict;
    el('mark', row).textContent = verdict === 'ok' ? '✅' : verdict === 'bad' ? '❌' : '';
    row.querySelector('[data-role="ok"]').setAttribute('aria-pressed', String(verdict === 'ok'));
    row.querySelector('[data-role="bad"]').setAttribute('aria-pressed', String(verdict === 'bad'));
  }

  function updateCounts() {
    var checked = 0, bad = 0;
    rows.forEach(function (row) {
      var v = verdicts[row.dataset.id];
      if (v) checked++;
      if (v === 'bad') bad++;
    });
    el('checked').textContent = checked;
    el('bad-count').textContent = bad;
    var target = rows.filter(function (r) { return r.dataset.skip !== '1'; }).length || 1;
    el('progress').style.width = Math.min(100, (checked / target) * 100) + '%';
  }

  function matches(row) {
    var kind = row.dataset.kind;
    var verdict = verdicts[row.dataset.id] || '';
    var skip = row.dataset.skip === '1';
    var okFilter =
      filter === 'all' ? true :
      filter === 'todo' ? (!verdict && !skip) :
      filter === 'ok' ? verdict === 'ok' :
      filter === 'bad' ? verdict === 'bad' :
      filter === 'need' ? row.dataset.need === '1' :
      filter === 'issue' ? row.dataset.issue === '1' :
      filter === 'skip' ? skip :
      kind === filter && !skip;
    var okQuery = !query || row.dataset.text.indexOf(query) >= 0 || row.dataset.id.indexOf(query) >= 0;
    return okFilter && okQuery;
  }

  var list = document.querySelector('.rows');
  var pendingList = document.querySelector('[data-role="pending-list"]');
  var pendingRows = Array.prototype.slice.call(document.querySelectorAll('.pending-row'));
  var PICK_KEY = 'nuri-voice-pending-picks';
  var picks = {};
  try { picks = JSON.parse(localStorage.getItem(PICK_KEY) || '{}'); } catch (e) { picks = {}; }
  function savePicks() { try { localStorage.setItem(PICK_KEY, JSON.stringify(picks)); } catch (e) {} }

  pendingRows.forEach(function (row) {
    var select = row.querySelector('[data-role="pick"]');
    var saved = picks[row.dataset.hash];
    if (saved) { select.value = saved; row.classList.add('picked'); row.querySelector('[data-role="pending-mark"]').textContent = '✅'; }
    select.addEventListener('change', function () {
      if (select.value) picks[row.dataset.hash] = select.value; else delete picks[row.dataset.hash];
      row.classList.toggle('picked', !!select.value);
      row.querySelector('[data-role="pending-mark"]').textContent = select.value ? '✅' : '';
      savePicks();
    });
    row.querySelector('[data-role="pending-play"]').addEventListener('click', function () {
      pendingRows.forEach(function (r) { r.classList.remove('playing'); });
      audio.pause();
      audio.src = row.dataset.src;
      row.classList.add('playing');
      audio.play().catch(function (error) {
        if (error && error.name === 'AbortError') return;
        el('bar-status').textContent = '재생 실패: ' + (error && error.message ? error.message : '');
      });
      el('bar-status').textContent = '미반입 ' + row.dataset.source;
    });
  });

  document.querySelector('[data-role="copy-picks"]').addEventListener('click', function (event) {
    var out = pendingRows.filter(function (row) { return picks[row.dataset.hash]; })
      .map(function (row) { return row.dataset.source + ' -> ' + picks[row.dataset.hash]; });
    copy(out.join('\\n') || '(고른 항목이 없습니다)', event.currentTarget);
  });
  function reorder(byRecordingOrder) {
    var sorted = rows.slice().sort(function (a, b) {
      return byRecordingOrder
        ? Number(a.dataset.order) - Number(b.dataset.order)
        : rows.indexOf(a) - rows.indexOf(b);
    });
    sorted.forEach(function (row) { list.appendChild(row); });
  }

  function apply() {
    var shown = 0;
    var recordMode = filter === 'need';
    var pendingMode = filter === 'pending';
    document.querySelector('[data-role="record-hint"]').hidden = !recordMode;
    document.querySelector('[data-role="pending-hint"]').hidden = !pendingMode;
    pendingList.hidden = !pendingMode;
    list.hidden = pendingMode;
    if (pendingMode) {
      var q = query;
      pendingRows.forEach(function (row) {
        row.hidden = !!q && row.querySelector('.script').textContent.indexOf(q) < 0 && row.dataset.source.indexOf(q) < 0;
      });
      el('bar-status').textContent = '미반입 녹음 ' + pendingRows.filter(function (r) { return !r.hidden; }).length + '개 — 들어 보고 대사를 고르세요';
      return;
    }
    reorder(recordMode);
    rows.forEach(function (row) {
      var visible = matches(row);
      row.hidden = !visible;
      if (visible) shown++;
    });
    if (recordMode) {
      var seq = 0;
      rows.slice().sort(function (a, b) { return Number(a.dataset.order) - Number(b.dataset.order); })
        .forEach(function (row) {
          var mark = row.querySelector('[data-role="seq"]');
          if (row.hidden) { mark.hidden = true; return; }
          seq += 1;
          mark.textContent = '녹음 ' + seq;
          mark.hidden = false;
        });
      el('need-count').textContent = seq;
    } else {
      rows.forEach(function (row) { row.querySelector('[data-role="seq"]').hidden = true; });
    }
    if (!shown) el('bar-status').textContent = '조건에 맞는 항목이 없습니다';
    if (current >= 0 && rows[current] && rows[current].hidden) setCurrent(nextVisible(current, 1));
  }

  function nextVisible(from, step) {
    for (var i = from + step; i >= 0 && i < rows.length; i += step) if (!rows[i].hidden) return i;
    return -1;
  }

  function setCurrent(index, scroll) {
    if (index < 0) return;
    rows.forEach(function (row, i) { row.classList.toggle('current', i === index); });
    current = index;
    var row = rows[index];
    if (scroll !== false) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el('bar-status').textContent = '#' + row.dataset.index + '  ' + row.dataset.text.slice(0, 40);
  }

  function play(index) {
    var row = rows[index];
    if (!row || !row.dataset.src) { el('bar-status').textContent = '이 대사는 음원이 없습니다'; return; }
    rows.forEach(function (r) { r.classList.remove('playing'); });
    audio.pause();
    audio.src = row.dataset.src + '?v=' + row.dataset.index;
    row.classList.add('playing');
    audio.play().catch(function (error) {
      if (error && error.name === 'AbortError') return;
      el('bar-status').textContent = '재생 실패: ' + (error && error.message ? error.message : '');
    });
  }

  audio.addEventListener('ended', function () {
    rows.forEach(function (r) { r.classList.remove('playing'); });
    if (autoNext) {
      var next = nextVisible(current, 1);
      if (next >= 0) { setCurrent(next); play(next); }
    }
  });

  function judge(index, verdict) {
    var row = rows[index];
    if (!row) return;
    var id = row.dataset.id;
    if (verdicts[id] === verdict) delete verdicts[id]; else verdicts[id] = verdict;
    save();
    paint(row);
    updateCounts();
    if (verdicts[id] === 'ok') {
      var next = nextVisible(index, 1);
      if (next >= 0) setCurrent(next);
    }
  }

  rows.forEach(function (row, index) {
    paint(row);
    row.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('button') : null;
      setCurrent(index, false);
      if (!button) return;
      var role = button.dataset.role;
      if (role === 'play') play(index);
      else if (role === 'ok') judge(index, 'ok');
      else if (role === 'bad') judge(index, 'bad');
      else if (button.dataset.copy) copy(button.dataset.copy, button);
    });
  });

  function copy(text, button) {
    var done = function () {
      if (!button) return;
      var previous = button.textContent;
      button.textContent = '복사됨';
      button.classList.add('copied');
      setTimeout(function () { button.textContent = previous; button.classList.remove('copied'); }, 1000);
    };
    if (navigator.clipboard) { navigator.clipboard.writeText(text).then(done, done); return; }
    var area = document.createElement('textarea');
    area.value = text; document.body.appendChild(area); area.select();
    try { document.execCommand('copy'); } catch (e) {}
    area.remove(); done();
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
  el('query').addEventListener('input', function (event) { query = event.target.value.trim(); apply(); });
  el('reset').addEventListener('click', function () {
    verdicts = {}; save();
    rows.forEach(paint);
    updateCounts(); apply();
  });
  el('copy-bad').addEventListener('click', function (event) {
    var list = rows.filter(function (row) { return verdicts[row.dataset.id] === 'bad'; })
      .map(function (row) { return row.dataset.id + '\\t' + row.dataset.text; });
    copy(list.join('\\n') || '(문제로 표시한 항목이 없습니다)', event.currentTarget);
  });

  el('bar-play').addEventListener('click', function () {
    if (current < 0) setCurrent(nextVisible(-1, 1));
    if (!audio.paused) { audio.pause(); rows.forEach(function (r) { r.classList.remove('playing'); }); return; }
    play(current);
  });
  el('bar-ok').addEventListener('click', function () { judge(current, 'ok'); });
  el('bar-bad').addEventListener('click', function () { judge(current, 'bad'); });
  el('prev').addEventListener('click', function () { setCurrent(nextVisible(current, -1)); });
  el('next').addEventListener('click', function () { setCurrent(nextVisible(current, 1)); });

  document.addEventListener('keydown', function (event) {
    if (event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === ' ') { event.preventDefault(); el('bar-play').click(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setCurrent(nextVisible(current, 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setCurrent(nextVisible(current, -1)); }
    else if (event.key === '1' || event.key === 'o') { event.preventDefault(); judge(current, 'ok'); }
    else if (event.key === '2' || event.key === 'x') { event.preventDefault(); judge(current, 'bad'); }
  });

  updateCounts();
  apply();
  setCurrent(nextVisible(-1, 1), false);
})();
</script>
</body>
</html>
`;

  await writeFile(outPath, html);
  console.log(`${path.relative(root, outPath)} 생성 — 육성 ${counts.voice || 0} · TTS ${counts.tts || 0} · 없음 ${counts.none || 0} (검증 대상 ${target}개, 앱 미사용 ${counts.skip || 0} 제외)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
