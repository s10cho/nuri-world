#!/usr/bin/env node
// 녹음 대사 전수 검수 — 무엇을 (다시) 녹음해야 하는지 뽑아낸다.
//
//   npm run audit:voice            요약만 보기
//   npm run audit:voice -- --json  tools/voice-audit.json 갱신 (대본 페이지가 읽는다)
//   npm run audit:voice -- --no-audio  오디오 분석 없이 문장·커버리지만
//
// 세 가지를 본다.
//  1) 문장 정합성 — "{낱말}의 {음절}" 처럼 데이터와 어긋나는 대사
//  2) 앱 커버리지 — 앱이 말하는데 목록에 없는 문장 / 목록에 있는데 앱이 안 쓰는 대사
//  3) 기존 녹음 품질 — 앞뒤 무음, 음량, 길이, 끝부분 클릭(키보드 소리) 의심

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
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
  jamoDemoLine,
} from '../js/data.js';
import { decompose, objectParticle } from '../js/hangul.js';
import { collectVoiceLines } from './generate-voice-assets.mjs';
import { analyse, decodeToPcm } from './voice-audio.mjs';
import { fileExists } from './voice-recorder-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const auditPath = path.join(__dirname, 'voice-audit.json');

// 녹음 품질 기준 — 아이용 짧은 대사 기준
const QUALITY = {
  leadSilenceMs: 400,
  tailSilenceMs: 500,
  minPeakDb: -30,
  clipDb: -0.2,
  minDurationMs: 250,
  maxDurationMs: 15000,
  tailClickGapMs: 150,
};

/* ── 1) 앱이 말하는 문장 전체 재현 ────────────────────────────────── */
// js/ 의 speak() 호출부를 그대로 옮긴 것. 앱 문구를 고치면 여기도 같이 고쳐야 한다.
function collectSpokenLines() {
  /** @type {Map<string, Set<string>>} */
  const spoken = new Map();
  const say = (text, where) => {
    const key = String(text).replace(/\s+/g, ' ').trim();
    if (!key) return;
    if (!spoken.has(key)) spoken.set(key, new Set());
    spoken.get(key).add(where);
  };

  say('누리의 한글 왕국에 온 것을 환영해요!', 'title.js');
  say('내가 모은 글자와 친구들이에요. 눌러 보면 소리를 들려줘요!', 'dex.js');
  say('아직 잠겨 있어요. 이전 왕국을 먼저 구해 주세요!', 'map.js');
  say('몬스터를 물리치면 축제가 열려요!', 'map.js');
  say('와, 모든 왕국을 구했어요! 축제에 가 볼까요?', 'map.js');
  say('앞의 스테이지를 먼저 깨야 해요!', 'kingdom.js');

  for (const kingdom of Object.values(KINGDOMS)) {
    say(kingdom.intro, 'kingdom.js');
    say(`${kingdom.name}에서 모험을 계속해요!`, 'map.js');
  }
  for (const panel of STORY_INTRO) say(panel.text.replace(/\n/g, ' '), 'story.js');
  for (const line of FESTIVAL.lines) say(line, 'festival.js');

  for (const ch of [...ALL_CONSONANTS, ...ALL_VOWELS]) {
    const info = JAMO[ch];
    const word = info.words[0].w;
    say(jamoDemoLine(ch), 'dex.js');
    say(ALL_CONSONANTS.includes(ch)
      ? `${info.name}! ${word[0]}, ${word}의 첫소리예요.`
      : `${info.name}! ${word}의 ${info.name} 소리예요.`, 'learn.js');
    for (const item of info.words) say(item.w, 'learn.js');
    say(info.name, 'listen.js · boss.js');
    say(`${info.name}! ${info.name}${objectParticle(info.name)} 찾아 주세요.`, 'listen.js (녹음 없을 때만)');
    say(`${info.name}! ${info.name}${objectParticle(info.name)} 찾아서 몬스터를 공격해요!`, 'boss.js (녹음 없을 때만)');
    say(`${info.name}! 짝을 찾았어요!`, 'match.js');
    say(`${info.name}! 명중이에요!`, 'boss.js');
  }

  for (const stage of TOWER_STAGES) {
    for (const t of stage.targets) say(`${t.s}! ${t.w}의 ${t.s}.`, 'dex.js');
  }
  for (const stage of VILLAGE_STAGES) {
    for (const word of stage.words) say(word.w, 'dex.js');
  }

  ['딩동댕! 잘 찾았어요!', '우와, 정말 잘 들었어요!', '맞아요! 멋져요!', '열심히 듣더니 해냈어요!']
    .forEach(t => say(t, 'listen.js'));
  ['괜찮아요, 다시 한번 들어 볼까요?', '음, 소리를 한 번 더 들어 보세요!'].forEach(t => say(t, 'listen.js'));

  say('카드를 뒤집어서 같은 글자 짝을 찾아 보세요!', 'match.js');
  say('잘 봐요! 어디에 같은 글자가 있을까요?', 'match.js');
  say('이제 같은 글자 짝을 찾아 보세요!', 'match.js');

  const BUILD_PRAISE = ['글자가 태어났어요!', '우와, 멋진 글자를 만들었어요!', '조각을 딱 맞췄네요, 대단해요!'];
  say('그 조각이 아니에요. 다시 골라 볼까요?', 'build.js');
  for (const stage of TOWER_STAGES) {
    stage.targets.forEach((t, i) => {
      say(`${t.s}! ${t.w}의 ${t.s}. 조각을 모아 ${t.s}${objectParticle(t.s)} 만들어 보세요!`, 'build.js');
      say(`${t.s}! ${t.w}의 ${t.s}! ${BUILD_PRAISE[i % BUILD_PRAISE.length]}`, 'build.js');
      say(`${t.w}의 ${t.s}! ${t.s}${objectParticle(t.s)} 찾아 공격해요!`, 'boss.js');
      say(`${t.s}! 명중이에요!`, 'boss.js');
    });
  }

  say('마을 친구들이 모두 웃을 수 있게 됐어요!', 'word.js');
  say('음, 다른 글자 같아요. 소리를 다시 들어 볼까요?', 'word.js');
  for (const stage of VILLAGE_STAGES) {
    for (const { w } of stage.words) {
      say(`${w}! 사라진 글자를 찾아 ${w} 이름을 완성해 주세요!`, 'word.js');
      say(`${w}! ${w}를 구했어요! 정말 잘했어요!`, 'word.js');
      say(`${w}! 이름을 완성했어요!`, 'word.js');
      say(`${w}! ${w}의 사라진 글자를 찾아 공격해요!`, 'boss.js');
      say(`${w}! 명중이에요!`, 'boss.js');
    }
  }

  say('지우개 몬스터가 나타났어요! 배운 글자로 힘을 모아 공격해요!', 'boss.js');
  say('안 돼요! 내가 지다니! 글자들을 모두 돌려줄게요!', 'boss.js');
  say('와! 지우개 몬스터를 물리쳤어요! 왕국의 글자들이 모두 돌아와요!', 'boss.js');
  ['괜찮아요! 다시 한번 들어 볼까요?', '거의 다 왔어요! 한 번 더 들어 봐요!', '천천히 다시 골라 볼까요?']
    .forEach(t => say(t, 'boss.js'));

  ['처음부터 끝까지 정말 열심히 했어요! 완벽해요!', '한 번도 틀리지 않았어요! 최고예요!',
    '포기하지 않고 끝까지 해냈어요! 멋져요!', '열심히 노력하는 모습이 정말 멋졌어요!',
    '어려웠지만 끝까지 도전했어요! 대단해요!', '조금씩 계속 연습하면 더 잘하게 될 거예요!',
  ].forEach(t => say(t, 'result.js'));

  return spoken;
}

/* ── 2) 문장 정합성 ───────────────────────────────────────────────── */
/** @param {{id: string, text: string}[]} lines */
function checkSentences(lines) {
  /** @type {{ id: string, text: string, detail: string }[]} */
  const problems = [];

  for (const ch of [...ALL_CONSONANTS, ...ALL_VOWELS]) {
    const info = JAMO[ch];
    const word = info.words[0].w;
    if (ALL_CONSONANTS.includes(ch)) {
      const first = decompose(word[0]);
      if (!first || first.cho !== ch) {
        problems.push({ id: `jamo/${info.name}`, text: word, detail: `예시 낱말 '${word}'가 '${ch}'로 시작하지 않음` });
      }
    } else if (![...word].some(syllable => decompose(syllable)?.jung === ch)) {
      problems.push({ id: `jamo/${info.name}`, text: word, detail: `예시 낱말 '${word}'에 모음 '${ch}' 소리가 없음` });
    }
  }

  for (const stage of TOWER_STAGES) {
    for (const t of stage.targets) {
      if (!t.w.includes(t.s)) {
        problems.push({ id: `syllables/${t.s}`, text: `${t.w} / ${t.s}`, detail: `'${t.w}'에 '${t.s}'가 없음` });
      }
    }
  }

  // 일반 규칙: "AA의 B" 에서 B가 AA에 없으면 의심 ("…의 X 소리" 어법은 제외 — 소리는 실제로 들어 있다)
  for (const line of lines) {
    for (const match of line.text.matchAll(/([가-힣]{2,})의\s+([가-힣])(?=[\s.!,]|$)/g)) {
      const [whole, owner, part] = match;
      if (owner.includes(part)) continue;
      if (line.text.includes(`${whole} 소리`)) continue;
      problems.push({ id: line.id, text: line.text, detail: `'${owner}'에 '${part}'가 없음` });
    }
  }

  return problems;
}

/* ── 3) 녹음 파일 품질 — 디코드·분석은 voice-audio.mjs 공용 ─────────── */

/* ── 실행 ─────────────────────────────────────────────────────────── */
async function main() {
  const writeJson = process.argv.includes('--json');
  const skipAudio = process.argv.includes('--no-audio');

  const lines = collectVoiceLines();
  const spoken = collectSpokenLines();
  const byText = new Map(lines.map(line => [line.text, line]));

  const sentenceProblems = checkSentences(lines);
  const missing = [...spoken.entries()]
    .filter(([text]) => !byText.has(text))
    .map(([text, where]) => ({ text, where: [...where].join(', ') }));
  const unusedIds = new Set(lines.filter(line => !spoken.has(line.text)).map(line => line.id));

  const recorded = JSON.parse(await readFile(path.join(__dirname, 'recorded-assets.json'), 'utf8')).assets;
  /** @type {Record<string, { src: string, text: string, issues: string[], stats?: Record<string, number|boolean> }>} */
  const recordings = {};

  const tmpDir = skipAudio ? '' : await mkdtemp(path.join(os.tmpdir(), 'nuri-audit-'));
  for (const [text, asset] of Object.entries(recorded)) {
    const file = path.join(root, 'public', asset.src);
    if (!await fileExists(file)) continue;
    /** @type {{ src: string, text: string, issues: string[], stats?: any }} */
    const entry = { src: asset.src, text, issues: [] };
    if (!byText.has(text)) entry.issues.push('대사 목록에 없는 옛 텍스트');
    if (!skipAudio) {
      const pcm = await decodeToPcm(file, tmpDir);
      if (!pcm) entry.issues.push('오디오를 읽지 못함');
      else {
        const stats = analyse(pcm.samples, pcm.rate);
        entry.stats = stats;
        if (stats.silent) entry.issues.push('소리 없음');
        if (stats.leadMs > QUALITY.leadSilenceMs) entry.issues.push(`앞 무음 ${stats.leadMs}ms`);
        if (stats.tailMs > QUALITY.tailSilenceMs) entry.issues.push(`뒤 무음 ${stats.tailMs}ms`);
        if (stats.tailClick) entry.issues.push('끝부분 클릭(키보드 소리) 의심');
        if (stats.peakDb < QUALITY.minPeakDb) entry.issues.push(`음량 작음 ${stats.peakDb}dB`);
        if (stats.peakDb > QUALITY.clipDb) entry.issues.push(`음량 과다 ${stats.peakDb}dB`);
        if (stats.durationMs < QUALITY.minDurationMs) entry.issues.push(`너무 짧음 ${stats.durationMs}ms`);
        if (stats.durationMs > QUALITY.maxDurationMs) entry.issues.push(`너무 김 ${stats.durationMs}ms`);
      }
    }
    recordings[asset.id] = entry;
  }
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });

  const recordedByText = new Map(Object.entries(recorded));
  const todo = lines.filter(line => !unusedIds.has(line.id) && !recordedByText.has(line.text));
  const redo = lines.filter(line => {
    const asset = recordedByText.get(line.text);
    return !unusedIds.has(line.id) && asset && (recordings[asset.id]?.issues.length ?? 0) > 0;
  });

  const audit = {
    updatedFor: lines.length,
    unused: [...unusedIds],
    missingFromList: missing,
    sentenceProblems,
    recordings,
    summary: {
      total: lines.length,
      unused: unusedIds.size,
      needRecording: todo.length,
      needRerecording: redo.length,
      done: lines.length - unusedIds.size - todo.length - redo.length,
    },
  };

  console.log(`대사 ${lines.length}개 (앱 미사용 ${unusedIds.size}개 제외 → 녹음 대상 ${lines.length - unusedIds.size}개)`);
  console.log(`  ⬜ 아직 녹음 없음       ${todo.length}`);
  console.log(`  🔁 재녹음 권장          ${redo.length}`);
  console.log(`  ✅ 녹음 완료(문제 없음)  ${audit.summary.done}`);
  console.log(`  ⛔ 앱이 쓰지 않음       ${unusedIds.size}`);
  if (sentenceProblems.length) {
    console.log(`\n문장 정합성 문제 ${sentenceProblems.length}건`);
    for (const problem of sentenceProblems.slice(0, 20)) console.log(`  - [${problem.id}] ${problem.detail}`);
  }
  if (missing.length) {
    console.log(`\n앱은 말하는데 목록에 없는 문장 ${missing.length}개 (대부분 녹음이 있으면 실행되지 않는 폴백)`);
  }

  const problemRecordings = Object.entries(recordings).filter(([, entry]) => entry.issues.length);
  if (problemRecordings.length) {
    console.log(`\n다시 녹음하면 좋을 파일 ${problemRecordings.length}개`);
    for (const [id, entry] of problemRecordings.slice(0, 30)) console.log(`  - ${id}: ${entry.issues.join(', ')}`);
    if (problemRecordings.length > 30) console.log(`  … 외 ${problemRecordings.length - 30}개`);
  }

  if (writeJson) {
    await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
    console.log(`\n${path.relative(root, auditPath)} 갱신 — 대본 페이지가 이 결과를 읽습니다.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
