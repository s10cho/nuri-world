#!/usr/bin/env node
// 한 폴더에 모아 둔 녹음 파일들이 '어떤 대사'인지 알아내 프로젝트 구조로 복사한다.
//
//   npm run match:voice -- --dry-run          무엇이 어디로 갈지 계획만 보기
//   OPENAI_API_KEY=sk-... npm run match:voice 실제 반영(음성 인식으로 대사 판별)
//   npm run match:voice -- --order            인식 없이 '녹음한 순서 = 대본 순서'로 배치
//   npm run match:voice -- --dir=~/Desktop/녹음 --move
//
// 판별 순서
//  1) 파일명이 대본의 파일 이름 규칙과 맞으면 그대로 사용 (분류:파일명.mp3.m4a 또는 분류/파일명.m4a)
//  2) 음성 인식(OpenAI) → 600개 대사와 글자 단위 유사도 비교 → 가장 비슷한 대사
//  3) --order 모드: 파일 수정 시각 순서를 대본(녹음할 것) 순서에 1:1로 맞춤
//
// 확정된 것만 반영하고, 애매한 것(--min 미만·같은 대사에 여러 파일)은 보류 목록으로 보여 준다.
// 반영할 때 앞뒤 무음과 끝부분 클릭을 다듬고 m4a(AAC 모노 44.1kHz)로 변환한다.

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { collectVoiceLines } from './generate-voice-assets.mjs';
import { sheetOrder } from './generate-record-sheet.mjs';
import { analyse, AUDIO_EXTS, decodeToPcm, encodeWav, findSpeech } from './voice-audio.mjs';
import { fileExists, readRecorded, saveRecording } from './voice-recorder-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const found = argv.find(arg => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const sourceDir = path.resolve(
  (value('dir', process.env.VOICE_SOURCE_DIR || path.join(os.homedir(), 'Downloads')) || '')
    .replace(/^~(?=\/|$)/, os.homedir()),
);
const dryRun = flag('dry-run');
const orderMode = flag('order');
const moveFiles = flag('move');
const rerecord = flag('rerecord');      // 이미 녹음된 대사도 덮어쓸지
const minScore = Number(value('min', '0.62'));
const model = value('model', 'gpt-4o-transcribe');
// 이미 전사 텍스트가 있으면(예: 음성 메모 앱의 자동 받아쓰기) API 없이 그걸로 맞춘다.
// JSON 형식: { "녹음 1.m4a": "딩동댕 잘 찾았어요", ... }
const transcriptsPath = value('transcripts', '');
const logName = '.nuri-import-log.json';

/** 대사 비교용 정규화 — 구두점·공백·이모지를 털어 낸다. @param {string} text */
export function normalize(text) {
  return String(text)
    .replace(/[\p{Extended_Pictographic}️]/gu, '')
    .replace(/[^\p{Script=Hangul}\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

/** 두 글자 묶음(bigram) 기준 Dice 유사도 0~1. @param {string} a @param {string} b */
export function similarity(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length === 1 || y.length === 1) return x === y ? 1 : 0;

  /** @param {string} text */
  const bigrams = text => {
    const map = new Map();
    for (let i = 0; i < text.length - 1; i += 1) {
      const pair = text.slice(i, i + 2);
      map.set(pair, (map.get(pair) || 0) + 1);
    }
    return map;
  };
  const left = bigrams(x);
  const right = bigrams(y);
  let shared = 0;
  for (const [pair, count] of left) shared += Math.min(count, right.get(pair) || 0);
  return (2 * shared) / ((x.length - 1) + (y.length - 1));
}

/**
 * 인식된 문장과 가장 비슷한 대사를 찾는다.
 * @param {string} transcript
 * @param {{ id: string, text: string }[]} candidates
 * @returns {{ line: { id: string, text: string }, score: number, runnerUp: number }}
 */
export function bestMatch(transcript, candidates) {
  let best = { line: candidates[0], score: -1 };
  let runnerUp = -1;
  for (const line of candidates) {
    const score = similarity(transcript, line.text);
    if (score > best.score) {
      runnerUp = best.score;
      best = { line, score };
    } else if (score > runnerUp) runnerUp = score;
  }
  return { line: best.line, score: best.score, runnerUp: Math.max(0, runnerUp) };
}

/** 대본의 파일 이름(분류:파일명.mp3.m4a) 또는 경로형 이름에서 id를 뽑는다. @param {string} name */
export function idFromFileName(name) {
  const base = name.replace(/\.(mp3\.m4a|m4a|mp4|mp3|wav|aac|caf|aiff?|webm|ogg)$/i, '');
  const candidate = base.includes(':') ? base.replaceAll(':', '/') : base;
  return candidate.replace(/^\/+|\/+$/g, '');
}

/** @param {string} file */
async function sha1(file) {
  return createHash('sha1').update(await readFile(file)).digest('hex');
}

/**
 * OpenAI 음성 인식.
 * @param {string} file @param {string} apiKey
 * @returns {Promise<string>}
 */
async function transcribe(file, apiKey) {
  const endpoint = process.env.OPENAI_BASE_URL
    ? `${process.env.OPENAI_BASE_URL.replace(/\/$/, '')}/audio/transcriptions`
    : 'https://api.openai.com/v1/audio/transcriptions';

  const form = new FormData();
  const bytes = await readFile(file);
  form.append('file', new Blob([bytes]), path.basename(file));
  form.append('model', model);
  form.append('language', 'ko');
  // 아이용 짧은 대사라 문맥을 조금 주면 인식률이 오른다
  form.append('prompt', '한글 학습 게임의 짧은 안내 문장입니다. 자모 이름(기역, 니은, 미음 등)과 낱말이 나옵니다.');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`음성 인식 실패 ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const result = await response.json();
  return String(result.text || '').trim();
}

// 빈 파일·잘린 파일이 멀쩡한 녹음을 덮어쓰지 않도록 하는 최소 기준
const MIN_SPEECH_MS = 250;

/** 다듬어 m4a로 저장. @param {string} file @param {{id: string, text: string}} line @param {string} tmpDir */
async function importOne(file, line, tmpDir) {
  const pcm = await decodeToPcm(file, tmpDir);
  if (!pcm) throw new Error('오디오를 읽지 못했습니다(코덱 확인 필요)');

  const stats = analyse(pcm.samples, pcm.rate);
  if (stats.silent) throw new Error('소리가 들어 있지 않습니다');
  if (stats.durationMs < MIN_SPEECH_MS) throw new Error(`너무 짧습니다(${stats.durationMs}ms) — 녹음이 제대로 저장됐는지 확인하세요`);

  const speech = findSpeech(pcm.samples, pcm.rate);
  const samples = speech ? pcm.samples.subarray(speech.startSample, speech.endSample) : pcm.samples;
  const speechMs = Math.round((samples.length / pcm.rate) * 1000);
  if (speechMs < MIN_SPEECH_MS) throw new Error(`말소리가 ${speechMs}ms 뿐입니다 — 확인이 필요합니다`);

  const wav = encodeWav(samples, pcm.rate);
  const saved = await saveRecording({ id: line.id, text: line.text, bytes: wav, mime: 'audio/wav' });
  return { ...saved, trimmedMs: speech ? Math.round(((pcm.samples.length - samples.length) / pcm.rate) * 1000) : 0 };
}

async function main() {
  if (!await fileExists(sourceDir)) {
    console.error(`폴더가 없습니다: ${sourceDir}`);
    process.exitCode = 1;
    return;
  }

  const lines = collectVoiceLines();
  const byId = new Map(lines.map(line => [line.id, line]));
  const recorded = (await readRecorded()).assets;
  const recordedTexts = new Set(Object.keys(recorded));

  /** 앱이 쓰지 않는 대사는 후보에서 뺀다(있으면 오인식을 늘린다) */
  let unused = new Set();
  try {
    unused = new Set(JSON.parse(await readFile(path.join(__dirname, 'voice-audit.json'), 'utf8')).unused || []);
  } catch { /* 검수 결과가 없으면 전부 후보 */ }
  const candidates = lines.filter(line => !unused.has(line.id));
  // --order 는 '대본 페이지에 보이는 순서대로 녹음했다'는 가정 → 같은 정렬을 쓴다
  const needList = sheetOrder(candidates.filter(line => rerecord || !recordedTexts.has(line.text)));

  const logPath = path.join(sourceDir, logName);
  /** @type {Record<string, string>} sha1 → id */
  let importLog = {};
  try {
    importLog = JSON.parse(await readFile(logPath, 'utf8'));
  } catch { /* 처음이면 빈 기록 */ }

  const entries = (await readdir(sourceDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && AUDIO_EXTS.includes(path.extname(entry.name).toLowerCase()))
    .map(entry => path.join(sourceDir, entry.name));
  if (!entries.length) {
    console.log(`${sourceDir} 에 오디오 파일이 없습니다.`);
    return;
  }

  const files = [];
  for (const file of entries) {
    const info = await stat(file);
    files.push({ file, mtime: info.mtimeMs, size: info.size });
  }
  files.sort((a, b) => a.mtime - b.mtime);

  /** @type {Record<string, string>} */
  let providedTranscripts = {};
  if (transcriptsPath) {
    providedTranscripts = JSON.parse(await readFile(path.resolve(transcriptsPath.replace(/^~(?=\/|$)/, os.homedir())), 'utf8'));
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!orderMode && !transcriptsPath && !apiKey) {
    console.error('OPENAI_API_KEY 가 없습니다. 음성 인식으로 대사를 찾으려면 키가 필요합니다.');
    console.error('  OPENAI_API_KEY=sk-... npm run match:voice -- --dry-run');
    console.error('키 없이 진행하려면: 파일 이름을 대본의 이름으로 저장했거나, 대본 순서대로 녹음했다면 --order 를 쓰세요.');
    process.exitCode = 1;
    return;
  }

  console.log(`${sourceDir} — 오디오 ${files.length}개`);
  const how = orderMode ? '녹음 순서' : transcriptsPath ? '주어진 전사 텍스트' : `음성 인식(${model})`;
  console.log(`판별 방식: 파일명 → ${how}`);
  console.log(`대상 대사: ${needList.length}개${rerecord ? ' (이미 녹음된 것도 덮어씀)' : ''}\n`);

  /** @type {{ file: string, line?: {id:string,text:string}, how: string, score: number, transcript?: string, note?: string }[]} */
  const plan = [];
  let orderCursor = 0;

  for (const { file } of files) {
    const name = path.basename(file);
    const hash = await sha1(file);
    if (importLog[hash]) {
      plan.push({ file, how: '건너뜀', score: 1, note: `이미 반영함 → ${importLog[hash]}` });
      continue;
    }

    const byName = byId.get(idFromFileName(name));
    if (byName) {
      plan.push({ file, line: byName, how: '파일명', score: 1 });
      continue;
    }

    if (orderMode) {
      const line = needList[orderCursor];
      orderCursor += 1;
      if (!line) plan.push({ file, how: '보류', score: 0, note: '대상 대사를 모두 채웠습니다' });
      else plan.push({ file, line, how: '순서', score: 0.5 });
      continue;
    }

    let transcript;
    try {
      transcript = providedTranscripts[name] ?? providedTranscripts[path.parse(name).name] ?? '';
      if (!transcript && !transcriptsPath) transcript = await transcribe(file, apiKey);
    } catch (error) {
      plan.push({ file, how: '보류', score: 0, note: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!transcript) {
      plan.push({ file, how: '보류', score: 0, transcript, note: transcriptsPath ? '전사 텍스트에 이 파일이 없습니다' : '인식된 말이 없습니다' });
      continue;
    }
    const match = bestMatch(transcript, candidates);
    const gap = match.score - match.runnerUp;
    if (match.score < minScore) {
      plan.push({ file, how: '보류', score: match.score, transcript, note: `가장 비슷한 대사: "${match.line.text}"` });
    } else {
      plan.push({
        file,
        line: match.line,
        how: '인식',
        score: match.score,
        transcript,
        note: gap < 0.06 ? `2등과 차이가 작음(${gap.toFixed(2)}) — 확인 권장` : undefined,
      });
    }
  }

  // 같은 대사에 여러 파일이면 마지막(가장 최근) 것만 쓴다 — 재테이크로 본다
  /** @type {Map<string, number>} */
  const lastIndexById = new Map();
  plan.forEach((item, index) => { if (item.line) lastIndexById.set(item.line.id, index); });

  const ready = [];
  const held = [];
  plan.forEach((item, index) => {
    if (!item.line) { held.push(item); return; }
    if (lastIndexById.get(item.line.id) !== index) {
      held.push({ ...item, how: '보류', note: '같은 대사의 이전 테이크 — 마지막 파일을 씁니다' });
      return;
    }
    if (!rerecord && recordedTexts.has(item.line.text)) {
      held.push({ ...item, how: '보류', note: '이미 녹음이 있습니다(덮어쓰려면 --rerecord)' });
      return;
    }
    ready.push(item);
  });

  console.log(`반영할 파일 ${ready.length}개`);
  for (const item of ready) {
    const score = item.how === '파일명' ? '' : ` (${item.score.toFixed(2)})`;
    console.log(`  ${path.basename(item.file)}`);
    console.log(`    → [${item.how}${score}] ${item.line.id}  "${item.line.text}"`);
    if (item.transcript) console.log(`       인식: "${item.transcript}"`);
    if (item.note) console.log(`       ! ${item.note}`);
  }
  if (held.length) {
    console.log(`\n보류 ${held.length}개 — 직접 확인이 필요합니다`);
    for (const item of held) {
      console.log(`  ${path.basename(item.file)}: ${item.note || '판별 실패'}${item.transcript ? `  (인식: "${item.transcript}")` : ''}`);
    }
  }

  if (dryRun) {
    console.log('\n--dry-run 이라 파일을 옮기지 않았습니다.');
    return;
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nuri-match-'));
  let done = 0;
  for (const item of ready) {
    try {
      const saved = await importOne(item.file, item.line, tmpDir);
      importLog[await sha1(item.file)] = item.line.id;
      done += 1;
      console.log(`[ok] ${item.line.id} ← ${path.basename(item.file)} (${(saved.bytes / 1024).toFixed(0)}KB, ${saved.trimmedMs}ms 다듬음)`);
      if (moveFiles) {
        const target = path.join(sourceDir, '_imported');
        await mkdir(target, { recursive: true });
        await rm(path.join(target, path.basename(item.file)), { force: true });
        await rename(item.file, path.join(target, path.basename(item.file)));
      }
    } catch (error) {
      console.error(`[fail] ${path.basename(item.file)}: ${error instanceof Error ? error.message : error}`);
    }
  }
  await rm(tmpDir, { recursive: true, force: true });
  await writeFile(logPath, `${JSON.stringify(importLog, null, 2)}\n`);

  console.log(`\n${done}개 반영 완료. 앱을 새로 고치면 바로 그 육성이 재생됩니다.`);
  console.log('대본 페이지 갱신:  npm run audit:voice -- --json && npm run sheet:voice');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
