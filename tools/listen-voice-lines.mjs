#!/usr/bin/env node
// 반입된 육성을 다시 들어 대사와 맞는지 확인한다 — 내용 오배치를 잡는 유일한 검사.
//
//   npm run listen:voice                 전부 확인 (한 번 들은 파일은 캐시에서 읽는다)
//   npm run listen:voice -- --refresh    캐시를 무시하고 다시 인식
//   npm run listen:voice -- --ids=jamo/ko-...,words/ko-...
//   npm run listen:voice -- --all        의심뿐 아니라 전부 출력
//   npm run listen:voice -- --min=0.5    의심 기준 유사도(기본 0.45)
//
// audit:voice 는 소리의 '품질'(무음·음량·길이)만 본다. 파일이 멀쩡해도 엉뚱한 대사에
// 붙어 있으면 잡지 못한다. 실제로 "얘! 얘기의 얘 소리예요." 자리에 낱말 "얘기" 가
// 들어가 있던 적이 있다. 이 도구는 녹음을 실제로 받아쓴 뒤 배정된 대사와 대조한다.
//
// 판정은 두 가지를 본다.
//  1) 배정된 대사와의 유사도가 너무 낮은가
//  2) 다른 대사가 눈에 띄게 더 잘 맞는가  ← 뒤바뀐 배치는 이쪽에서 걸린다

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { collectVoiceLines } from './generate-voice-assets.mjs';
import { containment, similarity } from './match-recorded-voice.mjs';
import { findWhisper, transcribeLocal } from './voice-stt.mjs';
import { fileExists } from './voice-recorder-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const cachePath = path.join(__dirname, 'voice-listen.json');

/** 의심으로 올리는 기본 기준. */
export const LISTEN = {
  minScore: 0.45,   // 배정된 대사와 이만큼도 안 닮으면 의심
  otherGap: 0.25,   // 다른 대사가 이만큼 더 잘 맞으면 뒤바뀜 의심
  otherFloor: 0.5,  // 단, 그 다른 대사 점수 자체가 이보다는 높아야 한다
  shortLen: 4,      // 이보다 짧은 대사는 인식기가 자주 틀리므로 따로 모은다
};

/**
 * 한국어에서 이미 소리가 합쳐진 글자를 하나로 본다.
 * whisper 는 왜/외/웨, 애/에, 얘/예를 구분하지 못한다. 이걸 오배치로 세면
 * 멀쩡한 녹음 수십 개가 의심으로 올라와 진짜 문제가 묻힌다.
 * @param {string} text
 */
export function fold(text) {
  let out = String(text)
    .replace(/[외웨]/g, '왜').replace(/[괴궤]/g, '괘')
    .replace(/[되뒈]/g, '돼').replace(/[쇠쉐]/g, '쇄');
  // 소유격 '의'는 [에]로 소리 난다 — "포도의 포"를 "포도에 포"로 받아쓴다.
  // 다만 자모 '의' 하나짜리 대사는 그대로 둬야 '에'·'애'와 뒤바뀐 걸 잡을 수 있다.
  if (out.replace(/[^가-힣]/g, '').length > 1) out = out.replace(/의/g, '에');
  return out.replace(/에/g, '애').replace(/예/g, '얘');
}

/**
 * 받아쓴 말과 배정된 대사가 얼마나 맞는지 0~1.
 *
 * lenient 를 켜면 짧은 대사는 한쪽이 다른 쪽에 통째로 들어 있는 것만으로 맞다고 본다
 * ("코" ↔ "코."처럼 인식기가 구두점을 붙이는 경우).
 * 배정된 대사를 볼 때는 켜지만, '다른 대사가 더 맞나' 비교할 때는 반드시 꺼야 한다.
 * 켠 채로 비교하면 "다리" 같은 짧은 대사가 "다! 다리의 다."를 받아쓴 말에도 통째로
 * 들어 있어 0.95 를 받고, 멀쩡한 배치가 죄다 뒤바뀜으로 올라온다.
 *
 * @param {string} heard @param {string} want @param {{ lenient?: boolean }} [opts]
 */
export function scoreLine(heard, want, { lenient = true } = {}) {
  const h = fold(heard);
  const w = fold(want);
  if (!h.trim() || !w.trim()) return 0;
  const direct = similarity(h, w);
  if (lenient && w.replace(/\s/g, '').length <= 3) {
    const a = h.replace(/[^가-힣0-9a-z]/gi, '');
    const b = w.replace(/[^가-힣0-9a-z]/gi, '');
    if (a && b && (a.includes(b) || b.includes(a))) return Math.max(direct, 0.95);
  }
  // 인식기가 문장 앞머리를 흘리거나 자모 이름을 뭉개는 일이 잦다("피읖!"→"피읍").
  // 받아쓴 말이 대사 안에 얼마나 들어 있는지도 함께 보면 이런 것에 덜 흔들린다.
  //
  // 단, 길이가 비슷할 때만이다. 포함도는 받아쓴 말 길이로 나누므로, 짧은 말은 긴 대사
  // 어디에든 들어맞아 1.0 이 나온다 — 낱말 "얘기" 녹음이 "얘! 얘기의 얘 소리예요."
  // 자리에 잘못 들어가 있어도 만점을 주게 된다. 그 사고를 잡자고 만든 도구다.
  if (!lenient) return direct;
  const hn = h.replace(/[^가-힣0-9a-z]/gi, '');
  const wn = w.replace(/[^가-힣0-9a-z]/gi, '');
  const comparable = wn.length && hn.length / wn.length >= 0.6;
  return comparable ? Math.max(direct, containment(h, w)) : direct;
}

/**
 * 한 건을 판정한다.
 * @param {{ heard: string, text: string, decoded: boolean }} entry
 * @param {{ text: string, score: number } | null} best 더 잘 맞는 다른 대사
 * @param {typeof LISTEN} [opts]
 * @returns {{ verdict: 'fail'|'swapped'|'suspect'|'short'|'ok', score: number }}
 */
export function classify(entry, best, opts = LISTEN) {
  if (!entry.decoded) return { verdict: 'fail', score: 0 };
  // 받아쓴 말에 글자가 하나도 없으면(인식기가 "- - -" 따위를 내놓으면)
  // 맞다고도 틀리다고도 할 수 없다. 의심으로 올리면 진짜 문제가 묻힌다.
  if (!fold(entry.heard).replace(/[^가-힣0-9a-z]/gi, '')) return { verdict: 'unclear', score: 0 };
  const score = scoreLine(entry.heard, entry.text);
  const letters = fold(entry.text).replace(/[^가-힣0-9a-z]/gi, '').length;
  // 한 글자짜리 대사(자모 '오'·'우'·'와'·'워' …)는 인식으로 가릴 수 없다.
  // 이 화자의 '오'는 whisper 가 늘 "우"로 받아쓴다 — 뒤바뀌었는지 여부와 무관하게 같은 글자가
  // 나오므로, 뒤바뀜이라고 단정하면 늘 빨간불이 켜져 진짜 문제가 묻힌다. 보류로 넘긴다.
  if (best && letters > 1 && best.score >= opts.otherFloor && best.score - score >= opts.otherGap) {
    return { verdict: 'swapped', score };
  }
  if (score >= opts.minScore) return { verdict: 'ok', score };
  return { verdict: letters < opts.shortLen ? 'short' : 'suspect', score };
}

/** @param {string} name @param {string} fallback */
function value(name, fallback = '') {
  const hit = process.argv.find(arg => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const showAll = process.argv.includes('--all');
  const onlyIds = new Set(value('ids').split(',').map(s => s.trim()).filter(Boolean));
  const opts = { ...LISTEN, minScore: Number(value('min', String(LISTEN.minScore))) };

  const lines = collectVoiceLines();
  const uniqueTexts = [...new Set(lines.map(line => line.text))];
  const recorded = JSON.parse(await readFile(path.join(__dirname, 'recorded-assets.json'), 'utf8')).assets;

  /** @type {{ id: string, text: string, src: string, file: string }[]} */
  const targets = [];
  for (const [text, asset] of Object.entries(recorded)) {
    if (onlyIds.size && !onlyIds.has(asset.id)) continue;
    const file = path.join(root, 'public', asset.src);
    if (!await fileExists(file)) continue;
    targets.push({ id: asset.id, text, src: asset.src, file });
  }
  if (!targets.length) {
    console.log('확인할 녹음이 없습니다.');
    return;
  }

  /** @type {Record<string, { heard: string, durationMs: number }>} */
  let cache = {};
  try { cache = JSON.parse(await readFile(cachePath, 'utf8')).transcripts ?? {}; } catch { /* 처음이면 없다 */ }

  const whisper = await findWhisper(value('whisper-model'));
  const needWork = [];
  for (const t of targets) {
    t.hash = createHash('sha1').update(await readFile(t.file)).digest('hex');
    if (refresh || !cache[t.hash]) needWork.push(t);
  }
  if (needWork.length && !whisper) {
    console.error(`처음 듣는 녹음이 ${needWork.length}개인데 로컬 음성 인식을 쓸 수 없습니다.`);
    console.error('  brew install whisper-cpp  +  ~/.cache/whisper.cpp/ggml-large-v3-turbo-q5_0.bin');
    process.exitCode = 1;
    return;
  }
  console.log(`녹음 ${targets.length}개 · 새로 들을 것 ${needWork.length}개${whisper ? ` (${path.basename(whisper.model)})` : ''}`);

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nuri-listen-'));
  let done = 0;
  for (const t of needWork) {
    done += 1;
    if (done % 25 === 0 || done === needWork.length) process.stderr.write(`  듣는 중 ${done}/${needWork.length}\r`);
    try {
      const { text, durationMs } = await transcribeLocal(t.file, tmpDir, whisper);
      cache[t.hash] = { heard: text, durationMs };
    } catch {
      cache[t.hash] = { heard: '', durationMs: 0 };
    }
  }
  if (needWork.length) process.stderr.write('\n');
  await rm(tmpDir, { recursive: true, force: true });

  /** @type {{ id: string, text: string, heard: string, score: number, verdict: string, other?: string, otherScore?: number }[]} */
  const results = [];
  for (const t of targets) {
    const got = cache[t.hash] ?? { heard: '', durationMs: 0 };
    const decoded = Boolean(got.heard);
    let best = null;
    if (decoded) {
      for (const other of uniqueTexts) {
        if (other === t.text) continue;
        const s = scoreLine(got.heard, other, { lenient: false });
        if (!best || s > best.score) best = { text: other, score: s };
      }
    }
    const { verdict, score } = classify({ heard: got.heard, text: t.text, decoded }, best, opts);
    const row = { id: t.id, text: t.text, heard: got.heard, score: Number(score.toFixed(3)), verdict };
    if (verdict === 'swapped' && best) { row.other = best.text; row.otherScore = Number(best.score.toFixed(3)); }
    results.push(row);
  }

  results.sort((a, b) => a.score - b.score);
  const count = v => results.filter(r => r.verdict === v).length;
  const suspects = results.filter(r => r.verdict === 'fail' || r.verdict === 'swapped' || r.verdict === 'suspect');
  const shorts = results.filter(r => r.verdict === 'short' || r.verdict === 'unclear');

  const label = { fail: '⛔ 못 읽음', swapped: '🔀 뒤바뀜 의심', suspect: '❌ 의심', short: '△ 짧아 보류', unclear: '？ 판정 불가', ok: '✅' };
  const show = showAll ? results : [...suspects, ...shorts];
  for (const r of show) {
    const tail = r.other ? `   ← "${r.other}" 쪽이 ${r.otherScore}` : '';
    console.log(`${label[r.verdict]} ${r.score.toFixed(2)} ${r.id.padEnd(34)} 대사="${r.text}"  들림="${r.heard}"${tail}`);
  }

  console.log(`\n확인 ${results.length}개`);
  console.log(`  ✅ 대사와 맞음        ${count('ok')}`);
  console.log(`  △ 짧아 판정 보류     ${count('short')}   (한두 음절짜리는 인식기가 자주 흘려 듣는다)`);
  console.log(`  ❌ 의심              ${count('suspect')}`);
  console.log(`  🔀 뒤바뀜 의심        ${count('swapped')}`);
  console.log(`  ？ 판정 불가         ${count('unclear')}   (인식기가 글자를 하나도 내놓지 못한 경우)`);
  console.log(`  ⛔ 못 읽음           ${count('fail')}`);

  await writeFile(cachePath, `${JSON.stringify({
    summary: { total: results.length, ok: count('ok'), short: count('short'), suspect: count('suspect'), swapped: count('swapped'), fail: count('fail') },
    suspects: [...suspects, ...shorts],
    transcripts: cache,
  }, null, 2)}\n`);
  console.log(`\n${path.relative(root, cachePath)} 갱신 — 다음 실행은 바뀐 파일만 다시 듣는다.`);
  if (suspects.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
