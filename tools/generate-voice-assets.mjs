#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, writeFile, access, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  ALL_CONSONANTS,
  ALL_VOWELS,
  FESTIVAL,
  JAMO,
  KINGDOMS,
  STORY_INTRO,
  TOWER_STAGES,
  VILLAGE_STAGES,
} from '../js/data.js';
import { demoSyllable, objectParticle } from '../js/hangul.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const defaultOutDir = path.join(root, 'public/assets/audio/ko');

const endpoint = process.env.OPENAI_BASE_URL
  ? `${process.env.OPENAI_BASE_URL.replace(/\/$/, '')}/audio/speech`
  : 'https://api.openai.com/v1/audio/speech';

const apiKey = process.env.OPENAI_API_KEY;
// 고정 스냅샷: 이전 세대보다 다국어 WER이 개선된 버전. 음성은 marin이 한국어에서 가장 자연스러웠다.
const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const voice = process.env.OPENAI_TTS_VOICE || 'marin';
const format = process.env.OPENAI_TTS_FORMAT || 'mp3';
const speed = Number(process.env.OPENAI_TTS_SPEED || 1);
// 공통 페르소나 (v2 — 청취 비교에서 최종 선택된 버전): 20대 초반의 부드럽고 다정한 유치원 선생님.
const PERSONA = 'You are a Korean kindergarten teacher in her early twenties with a soft, sweet, youthful voice, ' +
  'talking to a preschooler you adore. Speak very gently and kindly — warm, soothing, and natural, ' +
  'with a light, slightly high pitch. Never sound robotic or announcer-like; ' +
  'sound like a real person smiling while she speaks, leaving generous short pauses between phrases. ';
const instructions = process.env.OPENAI_TTS_INSTRUCTIONS ||
  PERSONA +
  'Speak Korean naturally with a friendly, clear, lively tone. ' +
  'Speak a little slower than normal adult conversation (about 85% speed), like narrating a picture book to a young child.';

// 대사 분류(id 첫 세그먼트)별 지시문 오버라이드. 연구 근거: 균일한 감속이 아니라
// '학습 목표 항목(자모 이름·낱말·음절)만 문장보다 더 느리게' 하는 속도 대비가
// 아동의 단어 학습을 예측한다. 칭찬은 거의 정상 속도로 경쾌하게 해 대비를 만든다.
// 자모 이름의 평음/격음/경음 발음 지시. TTS가 ㅂ/ㅍ 같은 대립을 뭉개지 않도록
// 이름 첫 글자로 계열을 판별해 조음 힌트를 덧붙인다.
const ASPIRATED_FIRST = new Set(['피', '티', '키', '치', '히']); // 피읖 티읕 키읔 치읓 히읗
/** @param {string} text 자모 이름(예: 비읍, 피읖, 쌍비읍) */
function articulationHint(text) {
  const name = text.split(/[!,\s]/)[0];
  if (name.startsWith('쌍')) {
    return 'The initial consonant is a Korean tense (fortis) consonant: pronounce it tight and pressed, with NO puff of air. ';
  }
  if (ASPIRATED_FIRST.has(name[0])) {
    return 'The initial consonant is a Korean aspirated consonant: pronounce it with a strong, clearly audible puff of air, so it can never be confused with its plain counterpart. ';
  }
  return 'The initial consonant is a Korean plain (lax) consonant: pronounce it soft and gentle, with NO puff of air, so it can never be confused with its aspirated counterpart. ';
}

// 대사 분류(id 첫 세그먼트)별 보조 지시. 연구 근거: 균일한 감속이 아니라
// '학습 목표 항목(자모 이름·낱말·음절)만 문장보다 더 느리게' 하는 속도 대비가
// 아동의 단어 학습을 예측한다.
const INSTRUCTIONS_BY_CATEGORY = {
  jamo: PERSONA + 'Speak this single Korean letter name very slowly and clearly for a child learning Hangul. Articulate each syllable distinctly, bright and encouraging. ',
  words: PERSONA + 'Speak this single Korean word slowly and very clearly for a child learning to read. Articulate each syllable distinctly, bright and warm. ',
  syllables: PERSONA + 'Speak this single Korean syllable slowly and very clearly for a child learning to read. Bright and warm. ',
  'jamo-intro': PERSONA + 'Say the letter name at the start slowly and clearly, then the rest of the sentence at a lively storybook pace. ',
  praise: PERSONA + 'Speak Korean joyfully and energetically at a natural pace — you are excitedly praising a child who just answered correctly. ',
};

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run') || args.has('--list');
const force = args.has('--force');
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity;
const outArg = process.argv.find(arg => arg.startsWith('--out='));
// --out=DIR: 샘플 청취용 별도 폴더로 출력 (manifest는 건드리지 않음)
const outDir = outArg ? path.resolve(root, outArg.slice('--out='.length)) : defaultOutDir;
// --only=id1,id2: 해당 id의 대사만 생성 (샘플용)
const onlyArg = process.argv.find(arg => arg.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
const htmlPathArg = process.argv.find(arg => arg.startsWith('--html='));
const htmlPath = htmlPathArg
  ? htmlPathArg.slice('--html='.length)
  : args.has('--html')
    ? 'voice-scripts.html'
    : null;

/** @type {{ id: string, text: string }[]} */
const fixedLines = [
  { id: 'ui/welcome', text: '누리의 한글 왕국에 온 것을 환영해요!' },
  { id: 'ui/locked-kingdom', text: '아직 잠겨 있어요. 이전 왕국을 먼저 구해 주세요!' },
  { id: 'ui/festival-ready', text: '와, 모든 왕국을 구했어요! 축제에 가 볼까요?' },
  { id: 'ui/dex-intro', text: '내가 모은 글자와 친구들이에요. 눌러 보면 소리를 들려줘요!' },
  { id: 'game/listen-intro', text: '어떤 글자의 소리일까요? 잘 듣고 찾아 보세요!' },
  { id: 'game/match-intro', text: '카드를 뒤집어서 같은 글자 짝을 찾아 보세요!' },
  { id: 'game/match-start', text: '잘 봐요! 어디에 같은 글자가 있을까요?' },
  { id: 'game/match-find', text: '이제 같은 글자 짝을 찾아 보세요!' },
  { id: 'game/build-wrong', text: '그 조각이 아니에요. 다시 골라 볼까요?' },
  { id: 'game/word-wrong', text: '음, 다른 글자 같아요. 소리를 다시 들어 볼까요?' },
  { id: 'game/boss-intro', text: '지우개 몬스터가 나타났어요! 배운 글자로 힘을 모아 공격해요!' },
  { id: 'game/boss-win-1', text: '안 돼요! 내가 지다니! 글자들을 모두 돌려줄게요!' },
  { id: 'game/boss-win-2', text: '와! 지우개 몬스터를 물리쳤어요! 왕국의 글자들이 모두 돌아와요!' },
  { id: 'praise/correct-01', text: '딩동댕! 잘 찾았어요!' },
  { id: 'praise/correct-02', text: '우와, 정말 잘 들었어요!' },
  { id: 'praise/correct-03', text: '맞아요! 멋져요!' },
  { id: 'praise/correct-04', text: '열심히 듣더니 해냈어요!' },
  { id: 'praise/retry-01', text: '괜찮아요, 다시 한번 들어 볼까요?' },
  { id: 'praise/retry-02', text: '음, 소리를 한 번 더 들어 보세요!' },
  { id: 'praise/stage-clear-01', text: '정말 잘했어요!' },
  { id: 'praise/stage-clear-02', text: '포기하지 않고 끝까지 했어요!' },
  { id: 'praise/stage-clear-03', text: '누리 덕분에 왕국이 더 반짝여요!' },
];

/** @param {string} id */
function shortHash(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 10);
}

/** @param {string} id */
function safeId(id) {
  return id
    .split('/')
    .map(segment => {
      const ascii = segment
        .normalize('NFKD')
        .replace(/[^\w-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
      return ascii || `ko-${shortHash(segment)}`;
    })
    .join('/');
}

export function collectVoiceLines() {
  /** @type {Map<string, string>} */
  const lines = new Map();
  const add = (id, text) => {
    const cleanText = text.replace(/\s+/g, ' ').trim();
    if (cleanText) lines.set(safeId(id), cleanText);
  };

  for (const line of fixedLines) add(line.id, line.text);

  for (const [id, kingdom] of Object.entries(KINGDOMS)) {
    add(`kingdom/${id}/intro`, kingdom.intro);
    add(`kingdom/${id}/goal`, kingdom.goal);
  }

  STORY_INTRO.forEach((panel, index) => {
    add(`story/intro-${String(index + 1).padStart(2, '0')}`, panel.text.replace(/\n/g, ' '));
  });

  // 축제 대사는 앱이 원문 그대로 speak()하므로 구두점·이모지를 유지한 원문을 키로 쓴다
  // (이모지는 toSpeechText에서 TTS 입력에서만 제거된다)
  FESTIVAL.lines.forEach((line, index) => {
    add(`festival/line-${String(index + 1).padStart(2, '0')}`, line);
  });

  for (const ch of [...ALL_CONSONANTS, ...ALL_VOWELS]) {
    const info = JAMO[ch];
    add(`jamo/${info.name}`, info.name);
    const word = info.words[0].w;
    const intro = ALL_CONSONANTS.includes(ch)
      ? `${info.name}! ${word[0]}, ${word}의 첫소리예요.`
      : `${info.name}! ${word}의 ${info.name} 소리예요.`;
    add(`jamo-intro/${info.name}`, intro);
    for (const item of info.words) add(`words/${item.w}`, item.w);
  }

  for (const stage of TOWER_STAGES) {
    for (const target of stage.targets) {
      add(`syllables/${target.s}`, target.s);
      add(`words/${target.w}`, target.w);
    }
  }

  for (const stage of VILLAGE_STAGES) {
    for (const word of stage.words) add(`words/${word.w}`, word.w);
  }

  add('characters/nuri', '누리');
  add('characters/pori', '포리');
  add('characters/eraser', '지우개 몬스터');

  add('ui/festival-locked', '몬스터를 물리치면 축제가 열려요!');
  add('ui/previous-stage-locked', '앞의 스테이지를 먼저 깨야 해요!');

  for (const [id, kingdom] of Object.entries(KINGDOMS)) {
    add(`map-continue/${id}`, `${kingdom.name}에서 모험을 계속해요!`);
  }

  // ── 게임이 실행 중 조합해 말하는 문장들 ─────────────────────────────
  // 앱의 speak() 호출 문자열과 한 글자도 다르지 않아야 파일이 재생된다.
  // (다르면 조용히 TTS로 떨어진다 — js/audio.js voiceKey 매칭)

  // 도감(dex.js)·짝 맞추기(match.js)·보스 자모 명중(boss.js askJamo)
  // (한글은 safeId에서 해시로 바뀌므로 항목별 고유성을 위해 별도 세그먼트로 둔다)
  for (const ch of [...ALL_CONSONANTS, ...ALL_VOWELS]) {
    const info = JAMO[ch];
    add(`dex/jamo/${info.name}`, `${info.name}! ${info.words[0].w}의 ${demoSyllable(ch)}.`);
    add(`praise/match/${info.name}`, `${info.name}! 짝을 찾았어요!`);
    add(`praise/hit-jamo/${info.name}`, `${info.name}! 명중이에요!`);
  }

  // 글자 조각의 탑: 조립 게임(build.js)·보스 음절 문제(boss.js askSyllable)·도감 음절
  const BUILD_PRAISE = ['글자가 태어났어요!', '우와, 멋진 글자를 만들었어요!', '조각을 딱 맞췄네요, 대단해요!'];
  for (const stage of TOWER_STAGES) {
    stage.targets.forEach((t, i) => {
      add(`build/prompt/${t.s}`, `${t.s}! ${t.w}의 ${t.s}. 조각을 모아 ${t.s}${objectParticle(t.s)} 만들어 보세요!`);
      // build.js는 스테이지 내 문항 순번(idx)으로 칭찬을 고른다 — 같은 규칙으로 열거
      add(`build/praise/${t.s}`, `${t.s}! ${t.w}의 ${t.s}! ${BUILD_PRAISE[i % BUILD_PRAISE.length]}`);
      add(`boss-syllable/${t.s}`, `${t.w}의 ${t.s}! ${t.s}${objectParticle(t.s)} 찾아 공격해요!`);
      add(`praise/hit-syllable/${t.s}`, `${t.s}! 명중이에요!`);
      add(`dex/syllable/${t.s}`, `${t.s}! ${t.w}의 ${t.s}.`);
    });
  }

  // 이름 없는 마을: 낱말 게임(word.js)·보스 낱말 문제(boss.js askWord)
  for (const stage of VILLAGE_STAGES) {
    for (const word of stage.words) {
      const w = word.w;
      add(`word-game/prompt/${w}`, `${w}! 사라진 글자를 찾아 ${w} 이름을 완성해 주세요!`);
      add(`word-game/rescued/${w}`, `${w}! ${w}를 구했어요! 정말 잘했어요!`);
      add(`word-game/complete/${w}`, `${w}! 이름을 완성했어요!`);
      add(`boss-word/${w}`, `${w}! ${w}의 사라진 글자를 찾아 공격해요!`);
      add(`praise/hit-word/${w}`, `${w}! 명중이에요!`);
    }
  }
  add('game/word-all-saved', '마을 친구들이 모두 웃을 수 있게 됐어요!');

  // 보스전 오답 격려(boss.js RETRY — listen.js와 다른 문구)
  add('praise/boss-retry-01', '괜찮아요! 다시 한번 들어 볼까요?');
  add('praise/boss-retry-02', '거의 다 왔어요! 한 번 더 들어 봐요!');
  add('praise/boss-retry-03', '천천히 다시 골라 볼까요?');

  // 결과 화면 칭찬(result.js PRAISE — 별 개수별 2종)
  add('praise/result-3-1', '처음부터 끝까지 정말 열심히 했어요! 완벽해요!');
  add('praise/result-3-2', '한 번도 틀리지 않았어요! 최고예요!');
  add('praise/result-2-1', '포기하지 않고 끝까지 해냈어요! 멋져요!');
  add('praise/result-2-2', '열심히 노력하는 모습이 정말 멋졌어요!');
  add('praise/result-1-1', '어려웠지만 끝까지 도전했어요! 대단해요!');
  add('praise/result-1-2', '조금씩 계속 연습하면 더 잘하게 될 거예요!');

  return [...lines.entries()].map(([id, text]) => ({ id, text }));
}

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {{ id: string, text: string }[]} lines
 * @param {Map<string, string>} recordedMap voiceKey(대사) → 녹음 파일 경로
 */
function voiceScriptsHtml(lines, recordedMap = new Map()) {
  const rows = lines.map((line, index) => {
    const category = line.id.split('/')[0];
    const escapedText = escapeHtml(line.text);
    const recordedSrc = recordedMap.get(voiceKey(line.text));
    const file = recordedSrc ? recordedSrc.replace(/^assets\/audio\/ko\//, '') : `${line.id}.${format}`;
    const sourceBadge = recordedSrc
      ? '<span class="badge rec source-badge">🎙️ 녹음</span>'
      : '<span class="badge tts source-badge">🤖 TTS</span>';
    // data-* 는 녹음 UI(public/voice-recorder.js)가 읽는다: 어떤 대사를 어느 파일로 저장할지
    return `          <tr data-id="${escapeHtml(line.id)}" data-text="${escapedText}" data-src="${escapeHtml(recordedSrc || '')}" data-tts="${escapeHtml(`${line.id}.${format}`)}" data-recorded="${recordedSrc ? 1 : 0}">
            <td class="num">${index + 1}</td>
            <td><span class="badge">${escapeHtml(category)}</span></td>
            <td><span class="rec-dot" title="녹음 상태"></span></td>
            <td>${sourceBadge}</td>
            <td><button class="file-copy-btn" type="button" data-copy="${escapeHtml(file)}"><code>${escapeHtml(file)}</code></button></td>
            <td class="script-cell">
              <span class="script">${escapedText}</span>
              <button class="copy-btn" type="button" data-copy="${escapedText}">복사</button>
            </td>
          </tr>`;
  }).join('\n');
  const recordedCount = lines.filter(line => recordedMap.has(voiceKey(line.text))).length;

  const groups = lines.reduce((acc, line) => {
    const category = line.id.split('/')[0];
    acc.set(category, (acc.get(category) || 0) + 1);
    return acc;
  }, new Map());
  const groupItems = [...groups.entries()].map(([category, count]) =>
    `<li><strong>${escapeHtml(category)}</strong><span>${count}</span></li>`,
  ).join('\n          ');

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>누리의 한글 왕국 음성 스크립트</title>
  <link rel="stylesheet" href="voice-recorder.css">
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f5ef;
      --paper: #fffdf8;
      --ink: #26231f;
      --muted: #6d675d;
      --line: #ded6c8;
      --accent: #2f7d80;
      --accent-soft: #dff1ef;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif;
      line-height: 1.55;
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 40px 24px 64px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: end;
      padding-bottom: 24px;
      border-bottom: 2px solid var(--line);
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(1.8rem, 4vw, 3rem);
      letter-spacing: 0;
    }
    p { margin: 0; color: var(--muted); }
    .summary {
      min-width: 220px;
      padding: 16px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .summary strong {
      display: block;
      font-size: 2rem;
      color: var(--accent);
      line-height: 1;
    }
    .groups {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px;
      margin: 24px 0;
      padding: 0;
      list-style: none;
    }
    .groups li {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 6px;
    }
    .table-wrap {
      overflow-x: auto;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 860px;
    }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      text-align: left;
    }
    th {
      position: sticky;
      top: 0;
      background: #efe8dc;
      color: #3c352d;
      z-index: 1;
    }
    tr:last-child td { border-bottom: 0; }
    tbody tr {
      cursor: pointer;
    }
    tbody tr.active {
      background: #fff5cf;
      box-shadow: inset 4px 0 0 #e3a11a;
    }
    tbody tr.active .script {
      font-weight: 800;
      color: #1d1a17;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.86rem;
      color: #334;
      white-space: nowrap;
    }
    .file-copy-btn {
      display: block;
      max-width: 100%;
      padding: 4px 6px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      text-align: left;
      cursor: pointer;
    }
    .file-copy-btn:hover {
      border-color: #c8bda9;
      background: #f4efe6;
    }
    .file-copy-btn.done {
      border-color: #6aa36e;
      background: #e6f5e7;
    }
    .num {
      width: 56px;
      color: var(--muted);
      text-align: right;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: #245c5f;
      font-size: 0.82rem;
      font-weight: 700;
      white-space: nowrap;
    }
    .badge.rec { background: #fdeef0; color: #a83a4e; }
    .badge.tts { background: #eef1fb; color: #3f4e9c; }
    .script-cell {
      display: grid;
      grid-template-columns: minmax(320px, 1fr) auto;
      gap: 12px;
      align-items: start;
    }
    .script {
      min-width: 360px;
      font-size: 1.02rem;
      word-break: keep-all;
    }
    .copy-btn {
      min-width: 58px;
      padding: 6px 10px;
      border: 1px solid #9fc7c3;
      border-radius: 6px;
      background: #f6fffd;
      color: #245c5f;
      font: inherit;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
    }
    .copy-btn:hover { background: var(--accent-soft); }
    .copy-btn:active { transform: translateY(1px); }
    .copy-btn.done {
      border-color: #6aa36e;
      background: #e6f5e7;
      color: #28622c;
    }
    @media print {
      body { background: white; }
      main { max-width: none; padding: 20px; }
      th { position: static; }
      .table-wrap, .summary, .groups li { border-color: #aaa; }
      .copy-btn { display: none; }
      .file-copy-btn {
        padding: 0;
        border: 0;
      }
    }
    @media (max-width: 720px) {
      main {
        padding: 24px 14px 40px;
      }
      header {
        display: block;
        padding-bottom: 18px;
      }
      h1 {
        font-size: 1.75rem;
      }
      .summary {
        margin-top: 16px;
        min-width: 0;
      }
      .groups {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin: 18px 0;
      }
      .groups li {
        padding: 9px 10px;
        font-size: 0.92rem;
      }
      .table-wrap {
        overflow: visible;
        background: transparent;
        border: 0;
        border-radius: 0;
      }
      table,
      thead,
      tbody,
      tr,
      th,
      td {
        display: block;
      }
      table {
        min-width: 0;
      }
      thead {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      tr {
        margin-bottom: 12px;
        padding: 12px;
        background: var(--paper);
        border: 1px solid var(--line);
        border-radius: 8px;
      }
      tr.active {
        background: #fff5cf;
        border-color: #e3a11a;
        box-shadow: inset 4px 0 0 #e3a11a;
      }
      td {
        padding: 0;
        border: 0;
      }
      td + td {
        margin-top: 8px;
      }
      .num {
        width: auto;
        text-align: left;
        font-weight: 700;
      }
      .num::before {
        content: "#";
      }
      code {
        display: block;
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .file-copy-btn {
        width: 100%;
        padding: 6px 8px;
        background: #f4efe6;
        border-radius: 6px;
      }
      .script-cell {
        grid-template-columns: 1fr;
        gap: 10px;
      }
      .script {
        min-width: 0;
        font-size: 1rem;
        word-break: keep-all;
        overflow-wrap: anywhere;
      }
      .copy-btn {
        width: 100%;
        min-height: 42px;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>누리의 한글 왕국 음성 스크립트</h1>
        <p>OpenAI TTS 또는 직접 녹음용 대사 목록입니다. 파일 경로는 생성 스크립트의 출력 경로와 일치합니다.</p>
        <p style="margin-top:6px"><code>npm run dev</code> 로 연 페이지에서는 아래 녹음 바로 바로 녹음·저장할 수 있습니다.
          저장하면 <code>public/assets/audio/ko/</code> 와 <code>manifest.json</code> 이 갱신되어 앱이 즉시 그 육성을 사용합니다.
          단축키 — <kbd>Space</kbd> 녹음/정지 · <kbd>Enter</kbd> 듣기 · <kbd>Backspace</kbd> 버리기 · <kbd>S</kbd> 저장 · <kbd>↑</kbd><kbd>↓</kbd> 대사 이동</p>
      </div>
      <div class="summary">
        <strong>${lines.length}</strong>
        <span>voice assets</span>
        <div style="margin-top:8px; font-size:0.92rem;">🎙️ 녹음 ${recordedCount} · 🤖 TTS ${lines.length - recordedCount}</div>
      </div>
    </header>

    <ul class="groups">
          ${groupItems}
    </ul>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>분류</th>
            <th>상태</th>
            <th>음원</th>
            <th>파일</th>
            <th>스크립트</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
  </main>
  <script>
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    function setActiveRow(row) {
      rows.forEach(item => {
        item.classList.toggle('active', item === row);
        if (item === row) item.setAttribute('aria-current', 'true');
        else item.removeAttribute('aria-current');
      });
    }
    rows.forEach(row => {
      row.tabIndex = 0;
      row.addEventListener('click', event => {
        if (event.target.closest('.copy-btn, .file-copy-btn')) return;
        setActiveRow(row);
      });
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setActiveRow(row);
        }
      });
    });
    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.focus();
        area.select();
        document.execCommand('copy');
        area.remove();
      }
    }
    document.querySelectorAll('.copy-btn, .file-copy-btn').forEach(button => {
      button.addEventListener('click', async () => {
        const text = button.dataset.copy || '';
        await copyText(text);
        const previousHtml = button.innerHTML;
        button.textContent = '완료';
        button.classList.add('done');
        setTimeout(() => {
          button.innerHTML = previousHtml;
          button.classList.remove('done');
        }, 1200);
      });
    });
  </script>
  <script type="module" src="voice-recorder.js"></script>
</body>
</html>
`;
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function generateSpeech(id, text) {
  const speechText = toSpeechText(text);
  const body = {
    model,
    voice,
    input: speechText,
    response_format: format,
    speed,
  };
  if (process.env.OPENAI_TTS_INSTRUCTIONS || model.includes('gpt-4o')) {
    const category = id.split('/')[0];
    let inst = INSTRUCTIONS_BY_CATEGORY[category] || instructions;
    if (speechText !== text) {
      inst += '\n\n입력 문장은 한국어 실제 발음에 맞게 전처리되어 있습니다. 입력된 발음 표기를 표준 철자로 복원하거나 임의로 바꾸지 말고, 적혀 있는 한글 음절을 그대로 정확하게 읽어주세요.';
    }
    if (category === 'jamo' || category === 'jamo-intro') inst += articulationHint(text);
    body.instructions = inst;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI TTS failed: ${response.status} ${response.statusText}${body ? `\n${body}` : ''}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/** js/audio.js voiceKey()와 동일한 정규화 — manifest 키로 쓰인다. @param {string} text */
function voiceKey(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// 발음 예외 사전: 화면 표기와 TTS에 보내는 발음 표기를 분리한다.
// manifest 키·앱 텍스트는 원문 유지, TTS 입력만 발음 표기로 바꾼다.
/** @type {Record<string, string>} */
let pronunciationOverrides = {};
try {
  const raw = JSON.parse(await readFile(path.join(__dirname, 'pronunciation-overrides.json'), 'utf8'));
  pronunciationOverrides = raw?.overrides || {};
} catch { /* 파일이 없으면 예외 사전 없이 진행 */ }

/** @param {string} text @returns {string} TTS에 보낼 발음 표기 */
function toSpeechText(text) {
  // 긴 표현부터 치환해 부분 치환 충돌을 줄인다
  const entries = Object.entries(pronunciationOverrides).sort((a, b) => b[0].length - a[0].length);
  let result = text;
  for (const [source, pronunciation] of entries) result = result.split(source).join(pronunciation);
  // 이모지는 TTS가 읽거나 어색한 쉼을 만들 수 있어 입력에서만 제거 (manifest 키는 원문 유지)
  return result.replace(/[\p{Extended_Pictographic}️]/gu, '').replace(/\s+/g, ' ').trim();
}

async function main() {
  let lines = collectVoiceLines();
  if (only) lines = lines.filter(line => only.has(line.id));
  if (Number.isFinite(limit)) lines = lines.slice(0, limit);

  if (htmlPath) {
    // 녹음 파일 유무 표시용 — 실제 파일이 있는 항목만 '녹음'으로 표시
    /** @type {Map<string, string>} */
    const recordedMap = new Map();
    try {
      const recorded = JSON.parse(await readFile(path.join(__dirname, 'recorded-assets.json'), 'utf8'))?.assets || {};
      for (const [text, asset] of Object.entries(recorded)) {
        if (await fileExists(path.join(root, 'public', asset.src))) recordedMap.set(voiceKey(text), asset.src);
      }
    } catch { /* 녹음 목록이 없으면 전부 TTS로 표시 */ }
    const target = path.resolve(root, htmlPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, voiceScriptsHtml(lines, recordedMap));
    console.log(`Wrote ${path.relative(root, target)} (${lines.length} voice assets, 녹음 ${[...new Set([...recordedMap.keys()].filter(k => lines.some(l => voiceKey(l.text) === k)))].length})`);
    return;
  }

  if (dryRun) {
    for (const line of lines) console.log(`${line.id}.${format}\t${line.text}`);
    console.log(`\n${lines.length} voice assets`);
    return;
  }

  if (!apiKey) {
    console.error('Missing OPENAI_API_KEY. Example: OPENAI_API_KEY=sk-... npm run generate:voice');
    process.exitCode = 1;
    return;
  }

  await mkdir(outDir, { recursive: true });

  let generated = 0;
  let skipped = 0;
  /** @type {Map<string, { id: string, src: string, bytes: number }>} */
  const assets = new Map();
  for (const [index, line] of lines.entries()) {
    const file = path.join(outDir, `${line.id}.${format}`);
    if (!force && await fileExists(file)) {
      skipped += 1;
      const bytes = (await stat(file)).size;
      assets.set(voiceKey(line.text), { id: line.id, src: `assets/audio/ko/${line.id}.${format}`, bytes });
      console.log(`[skip ${index + 1}/${lines.length}] ${line.id}.${format}`);
      continue;
    }

    await mkdir(path.dirname(file), { recursive: true });
    console.log(`[make ${index + 1}/${lines.length}] ${line.id}.${format} <- ${line.text}`);
    const audio = await generateSpeech(line.id, line.text);
    await writeFile(file, audio);
    assets.set(voiceKey(line.text), { id: line.id, src: `assets/audio/ko/${line.id}.${format}`, bytes: audio.length });
    generated += 1;
  }

  // 샘플(--out) 모드에서는 앱이 읽는 manifest를 건드리지 않는다
  if (outDir === defaultOutDir) {
    // 직접 녹음한 육성 파일이 있는 대사는 녹음을 우선 사용하고, TTS 생성본은 그 외에만 쓴다
    const merged = Object.fromEntries(assets);
    let recordedCount = 0;
    try {
      const recorded = JSON.parse(await readFile(path.join(__dirname, 'recorded-assets.json'), 'utf8'))?.assets || {};
      for (const [text, asset] of Object.entries(recorded)) {
        if (await fileExists(path.join(root, 'public', asset.src))) {
          merged[voiceKey(text)] = asset;
          recordedCount += 1;
        }
      }
    } catch { /* 녹음 목록이 없으면 TTS 생성본만 사용 */ }

    // js/audio.js가 읽는 형식: assets를 정규화된 '대사 텍스트'로 키잉
    const manifest = {
      format,
      model,
      voice,
      count: Object.keys(merged).length,
      recorded: recordedCount,
      assets: merged,
    };
    await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`manifest.json 갱신 (${manifest.count}개, 육성 녹음 우선 ${recordedCount}개)`);
  }

  console.log(`Done. Generated ${generated}, skipped ${skipped}. Output: ${path.relative(root, outDir)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
