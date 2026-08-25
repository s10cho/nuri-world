#!/usr/bin/env node
// 검증 페이지에서 고른 "파일 → 대사" 매칭을 그대로 배치한다.
//
//   npm run place:voice -- --pairs=matches.txt     (한 줄에 하나: 파일이름 -> 대사id)
//   pbpaste | npm run place:voice                  (붙여넣기로 바로)
//   npm run place:voice -- --dry-run
//
// 옮기면서 앞뒤 무음·끝 클릭을 다듬고 m4a(AAC 모노 44.1kHz)로 변환한 뒤
// recorded-assets.json · manifest.json 을 갱신한다.

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { collectVoiceLines } from './generate-voice-assets.mjs';
import { analyse, decodeToPcm, encodeWav, findSpeech } from './voice-audio.mjs';
import { fileExists, saveRecording } from './voice-recorder-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const found = argv.find(arg => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const dryRun = argv.includes('--dry-run');
const pairsPath = value('pairs', '');
const MIN_SPEECH_MS = 250;

/** 표준 입력 전체 읽기 */
function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

/**
 * "파일이름 -> 대사id" 줄들을 해석한다. 화살표는 -> · → · = 를 모두 받는다.
 * @param {string} text
 */
export function parsePairs(text) {
  return String(text).split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const match = line.split(/\s*(?:->|→|=>|=|\t)\s*/);
      if (match.length < 2) return null;
      return { file: match[0].trim(), id: match[match.length - 1].trim() };
    })
    .filter(Boolean);
}

async function main() {
  const raw = pairsPath ? await readFile(path.resolve(pairsPath), 'utf8') : await readStdin();
  const pairs = parsePairs(raw);
  if (!pairs.length) {
    console.error('매칭 목록이 비어 있습니다. 검증 페이지의 "📋 매칭 목록 복사" 결과를 넣어 주세요.');
    console.error('  예)  npm run place:voice -- --pairs=matches.txt');
    console.error('       pbpaste | npm run place:voice');
    process.exitCode = 1;
    return;
  }

  const lines = collectVoiceLines();
  const byId = new Map(lines.map(line => [line.id, line]));
  const pending = JSON.parse(await readFile(path.join(__dirname, 'voice-pending.json'), 'utf8').catch(() => '{"items":[]}'));
  const bySource = new Map((pending.items || []).map(item => [item.source, item]));
  const sourceDir = pending.sourceDir || path.join(os.homedir(), 'Downloads');

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nuri-place-'));
  let done = 0;
  /** @type {Record<string, string>} */
  let log = {};
  const logPath = path.join(sourceDir, '.nuri-import-log.json');
  try {
    log = JSON.parse(await readFile(logPath, 'utf8'));
  } catch { /* 없으면 새로 만든다 */ }

  for (const pair of pairs) {
    const line = byId.get(pair.id);
    if (!line) { console.error(`[skip] 모르는 대사 id: ${pair.id}`); continue; }

    // 원본을 먼저 찾고, 없으면 옮겨 둔 사본을 쓴다
    let file = path.join(sourceDir, pair.file);
    if (!await fileExists(file)) {
      const staged = bySource.get(pair.file);
      if (staged) file = path.join(__dirname, '..', 'public', staged.src);
    }
    if (!await fileExists(file)) { console.error(`[skip] 파일을 찾지 못함: ${pair.file}`); continue; }

    const pcm = await decodeToPcm(file, tmp);
    if (!pcm) { console.error(`[skip] 오디오를 읽지 못함: ${pair.file}`); continue; }
    const stats = analyse(pcm.samples, pcm.rate);
    if (stats.silent || stats.durationMs < MIN_SPEECH_MS) {
      console.error(`[skip] 소리 없음/너무 짧음(${stats.durationMs}ms): ${pair.file}`);
      continue;
    }

    const speech = findSpeech(pcm.samples, pcm.rate);
    const samples = speech ? pcm.samples.subarray(speech.startSample, speech.endSample) : pcm.samples;
    console.log(`${dryRun ? '[dry] ' : ''}${line.id}  "${line.text}"  ← ${pair.file}`);
    if (dryRun) { done += 1; continue; }

    const saved = await saveRecording({ id: line.id, text: line.text, bytes: encodeWav(samples, pcm.rate), mime: 'audio/wav' });
    log[createHash('sha1').update(await readFile(file)).digest('hex')] = line.id;
    console.log(`   → ${saved.src} (${(saved.bytes / 1024).toFixed(0)}KB)`);
    done += 1;
  }

  await rm(tmp, { recursive: true, force: true });
  if (!dryRun && done) {
    await writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`);
    console.log(`\n${done}개 배치 완료. 다음으로 상태를 갱신하세요:`);
    console.log('  npm run audit:voice -- --json && npm run pending:voice && npm run verify:voice');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
