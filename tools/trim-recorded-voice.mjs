#!/usr/bin/env node
// 이미 녹음된 육성 파일의 앞뒤 무음과 끝부분 클릭(키보드 소리)을 잘라 낸다.
// 다시 녹음할 필요 없이 품질 문제 대부분을 해결한다.
//
//   npm run trim:voice -- --dry-run   무엇이 어떻게 잘리는지만 보기
//   npm run trim:voice                실제로 다듬어 덮어쓰기(원본은 .bak 로 남긴다)
//   npm run trim:voice -- --ids=ui/welcome,praise/correct-01   일부만
//
// 처리: m4a → (afconvert/ffmpeg) WAV → PCM에서 앞뒤 정리 → 다시 m4a(AAC 모노 44.1k)

import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { applyToManifest, countRecordedOnDisk, fileExists, manifestPath, readManifest, readRecorded, recordedJsonPath, root, toM4a } from './voice-recorder-store.mjs';

const dryRun = process.argv.includes('--dry-run');
const idsArg = process.argv.find(arg => arg.startsWith('--ids='));
const onlyIds = idsArg ? new Set(idsArg.slice('--ids='.length).split(',')) : null;

const LEAD_KEEP_MS = 80;    // 말 시작 앞에 남길 여유
const TAIL_KEEP_MS = 200;   // 말 끝 뒤에 남길 여유
const CLICK_GAP_MS = 150;   // 이만큼 조용했다가 나는 짧은 소리는 키보드 클릭으로 본다
const CLICK_BLOCK_MS = 120;

/** @param {string} cmd @param {string[]} args */
function run(cmd, args) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', code => resolve(code === 0));
  });
}

/** @param {string} file @param {string} tmpDir */
async function toPcm(file, tmpDir) {
  const wav = path.join(tmpDir, `${path.basename(file)}.wav`);
  const ok = await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', file, wav])
    || await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '44100', wav]);
  if (!ok) return null;
  let buffer;
  try {
    buffer = await readFile(wav);
  } catch {
    return null;
  }
  await rm(wav, { force: true });

  let offset = 12;
  let dataStart = -1;
  let dataSize = 0;
  let rate = 44100;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') rate = buffer.readUInt32LE(offset + 12);
    if (id === 'data') { dataStart = offset + 8; dataSize = size; break; }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0) return null;
  const count = Math.floor(Math.min(dataSize, buffer.length - dataStart) / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) samples[i] = buffer.readInt16LE(dataStart + i * 2) / 32768;
  return { samples, rate };
}

/**
 * 앞뒤 무음과 끝 클릭을 뺀 구간을 찾는다.
 * @param {Float32Array} samples @param {number} rate
 */
function findSpeech(samples, rate) {
  const frame = Math.round(rate * 0.01);
  /** @type {number[]} */
  const levels = [];
  for (let i = 0; i < samples.length; i += frame) {
    let sum = 0;
    const end = Math.min(i + frame, samples.length);
    for (let j = i; j < end; j += 1) sum += samples[j] * samples[j];
    levels.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  const peak = levels.reduce((max, level) => Math.max(max, level), 0);
  if (!peak) return null;
  const threshold = Math.max(peak * 0.08, 0.004);

  const first = levels.findIndex(level => level > threshold);
  let last = -1;
  for (let i = levels.length - 1; i >= 0; i -= 1) if (levels[i] > threshold) { last = i; break; }
  if (first < 0 || last < 0) return null;

  // 마지막 덩어리가 짧고 그 앞이 충분히 조용하면 클릭으로 보고 잘라 낸다
  let clickRemoved = false;
  let blockStart = last;
  while (blockStart > 0 && levels[blockStart - 1] > threshold) blockStart -= 1;
  let silence = 0;
  for (let i = blockStart - 1; i >= 0 && levels[i] <= threshold; i -= 1) silence += 1;
  if (blockStart > 0 && silence * 10 >= CLICK_GAP_MS && (last - blockStart + 1) * 10 <= CLICK_BLOCK_MS) {
    last = blockStart - silence; // 클릭 앞의 무음 시작 지점까지만 남긴다
    clickRemoved = true;
    while (last > 0 && levels[last] <= threshold) last -= 1;
  }

  const startSample = Math.max(0, (first * frame) - Math.round(rate * (LEAD_KEEP_MS / 1000)));
  const endSample = Math.min(samples.length, ((last + 1) * frame) + Math.round(rate * (TAIL_KEEP_MS / 1000)));
  return {
    startSample,
    endSample,
    clickRemoved,
    leadMs: first * 10,
    tailMs: Math.max(0, levels.length - 1 - last) * 10,
  };
}

/** @param {Float32Array} samples @param {number} rate */
function encodeWav(samples, rate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVEfmt ', 8, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(value < 0 ? value * 0x8000 : value * 0x7fff), 44 + i * 2);
  }
  return buffer;
}

async function main() {
  const recorded = await readRecorded();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nuri-trim-'));
  let manifest = await readManifest();
  let trimmed = 0;
  let skipped = 0;
  /** @type {string[]} */
  const failed = [];

  for (const [text, asset] of Object.entries(recorded.assets)) {
    if (onlyIds && !onlyIds.has(asset.id)) continue;
    const file = path.join(root, 'public', asset.src);
    if (!await fileExists(file)) continue;

    const pcm = await toPcm(file, tmpDir);
    if (!pcm) {
      failed.push(`${asset.id} — 오디오를 읽지 못함(코덱 확인 필요)`);
      continue;
    }
    const speech = findSpeech(pcm.samples, pcm.rate);
    if (!speech) {
      failed.push(`${asset.id} — 소리가 감지되지 않음`);
      continue;
    }

    const cutMs = Math.round(((pcm.samples.length - (speech.endSample - speech.startSample)) / pcm.rate) * 1000);
    if (cutMs < 60 && !speech.clickRemoved) { skipped += 1; continue; }

    const label = `${asset.id}: 앞 ${speech.leadMs}ms · 뒤 ${speech.tailMs}ms${speech.clickRemoved ? ' · 끝 클릭 제거' : ''} → ${cutMs}ms 잘라냄`;
    if (dryRun) {
      console.log(`[dry] ${label}`);
      trimmed += 1;
      continue;
    }

    const wav = encodeWav(pcm.samples.subarray(speech.startSample, speech.endSample), pcm.rate);
    const m4a = await toM4a(wav, '.wav');
    if (!m4a) {
      failed.push(`${asset.id} — m4a 변환 실패`);
      continue;
    }

    await copyFile(file, `${file}.bak`);
    const target = file.replace(/\.(mp3\.m4a|m4a|mp4|webm|ogg|wav)$/, '.m4a');
    await writeFile(target, m4a);
    if (target !== file) await rm(file, { force: true });

    const relative = path.relative(path.join(root, 'public'), target);
    recorded.assets[text] = { id: asset.id, src: relative, bytes: (await stat(target)).size };
    manifest = applyToManifest(manifest, text, recorded.assets[text], manifest.recorded);
    trimmed += 1;
    console.log(`[ok] ${label}`);
  }

  await rm(tmpDir, { recursive: true, force: true });

  if (!dryRun && trimmed) {
    manifest.recorded = await countRecordedOnDisk(recorded.assets);
    await writeFile(recordedJsonPath, `${JSON.stringify(recorded, null, 2)}\n`);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  console.log(`\n다듬음 ${trimmed}개, 그대로 둠 ${skipped}개, 실패 ${failed.length}개`);
  for (const message of failed) console.log(`  ! ${message}`);
  if (!dryRun && trimmed) console.log('원본은 같은 폴더에 .bak 로 남겨 두었습니다. 확인 후 지우세요:  find public/assets/audio/ko -name "*.bak" -delete');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
