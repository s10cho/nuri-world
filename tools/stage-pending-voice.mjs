#!/usr/bin/env node
// 아직 어느 대사에도 배치되지 않은 녹음 파일을 검증 페이지에서 들을 수 있게 옮겨 둔다.
//
//   npm run pending:voice            ~/Downloads 의 미반입 녹음 → public/assets/audio/pending/
//   npm run pending:voice -- --clear 옮겨 둔 파일 정리
//
// 페이지(voice-check.html)의 "📥 미반입 녹음" 필터가 tools/voice-pending.json 을 읽어
// 파일별로 ▶듣기 + 대사 고르기를 보여 준다. 고른 결과를 복사해 넘기면
// npm run place:voice 로 한 번에 배치할 수 있다.

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { AUDIO_EXTS } from './voice-audio.mjs';
import { fileExists } from './voice-recorder-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pendingDir = path.join(root, 'public/assets/audio/pending');
const pendingJson = path.join(__dirname, 'voice-pending.json');

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const found = argv.find(arg => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const sourceDir = path.resolve((value('dir', process.env.VOICE_SOURCE_DIR || path.join(os.homedir(), 'Downloads')) || '')
  .replace(/^~(?=\/|$)/, os.homedir()));
const namePattern = value('name', '^KakaoTalk_Audio_');
const sinceArg = value('since', '2026-08-22');
const sinceMs = Date.parse(sinceArg.length <= 10 ? `${sinceArg}T00:00:00Z` : sinceArg);

/** 파일 이름 속 녹음 시각 (match-recorded-voice.mjs 와 같은 규칙) */
function stampOf(name) {
  const m = name.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})[-_ T]?(\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2})/);
  if (!m) return 0;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

/** @param {number} stamp */
function label(stamp) {
  const d = new Date(stamp);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

async function main() {
  if (argv.includes('--clear')) {
    await rm(pendingDir, { recursive: true, force: true });
    await rm(pendingJson, { force: true });
    console.log('미반입 녹음 정리 완료 (public/assets/audio/pending, tools/voice-pending.json)');
    return;
  }

  const log = JSON.parse(await readFile(path.join(sourceDir, '.nuri-import-log.json'), 'utf8').catch(() => '{}'));
  const cache = JSON.parse(await readFile(path.join(sourceDir, '.nuri-transcripts.json'), 'utf8').catch(() => '{}'));
  const filter = new RegExp(namePattern);

  const names = (await readdir(sourceDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && AUDIO_EXTS.includes(path.extname(entry.name).toLowerCase()))
    .map(entry => entry.name)
    .filter(name => filter.test(name));

  await rm(pendingDir, { recursive: true, force: true });
  await mkdir(pendingDir, { recursive: true });

  const items = [];
  for (const name of names) {
    const stamp = stampOf(name);
    if (sinceMs && stamp && stamp < sinceMs) continue;
    const file = path.join(sourceDir, name);
    const hash = createHash('sha1').update(await readFile(file)).digest('hex');
    if (log[hash]) continue; // 이미 어느 대사에 배치됨

    const ext = path.extname(name).toLowerCase();
    const target = `${hash.slice(0, 10)}${ext}`;
    await copyFile(file, path.join(pendingDir, target));
    items.push({
      hash,
      source: name,
      src: `assets/audio/pending/${target}`,
      stamp,
      when: stamp ? label(stamp) : '',
      bytes: (await stat(file)).size,
      transcript: cache[hash]?.text || '',
      durationMs: cache[hash]?.durationMs || 0,
    });
  }
  items.sort((a, b) => a.stamp - b.stamp);

  await writeFile(pendingJson, `${JSON.stringify({ sourceDir, items }, null, 2)}\n`);
  const size = items.reduce((sum, item) => sum + item.bytes, 0);
  console.log(`미반입 녹음 ${items.length}개를 옮겼습니다 (${(size / 1024 / 1024).toFixed(1)}MB) → public/assets/audio/pending/`);
  console.log('검증 페이지를 다시 만들면 "📥 미반입 녹음" 필터에서 들어 볼 수 있습니다:  npm run verify:voice');
  if (!await fileExists(path.join(sourceDir, '.nuri-transcripts.json'))) {
    console.log('(인식 결과 캐시가 없어 전사 텍스트는 비어 있습니다)');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
