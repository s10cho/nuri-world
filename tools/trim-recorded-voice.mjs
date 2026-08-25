#!/usr/bin/env node
// 이미 녹음된 육성 파일의 앞뒤 무음과 끝부분 클릭(키보드 소리)을 잘라 낸다.
// 다시 녹음할 필요 없이 품질 문제 대부분을 해결한다.
//
//   npm run trim:voice -- --dry-run   무엇이 어떻게 잘리는지만 보기
//   npm run trim:voice                실제로 다듬어 덮어쓰기(원본은 .voice-backup/ 로 옮겨 둔다)
//   npm run trim:voice -- --ids=ui/welcome,praise/correct-01   일부만
//
// 처리: m4a → (afconvert/ffmpeg) WAV → PCM에서 앞뒤 정리 → 다시 m4a(AAC 모노 44.1k)

import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { decodeToPcm, encodeWav, findSpeech } from './voice-audio.mjs';
import { applyToManifest, countRecordedOnDisk, fileExists, manifestPath, readManifest, readRecorded, recordedJsonPath, root, toM4a } from './voice-recorder-store.mjs';

const dryRun = process.argv.includes('--dry-run');
const backupDir = path.join(root, '.voice-backup');
const idsArg = process.argv.find(arg => arg.startsWith('--ids='));
const onlyIds = idsArg ? new Set(idsArg.slice('--ids='.length).split(',')) : null;

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

    const pcm = await decodeToPcm(file, tmpDir);
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

    // 원본은 public/ 바깥에 둔다. public/ 은 통째로 빌드 산출물에 복사되므로
    // 여기에 .bak 를 남기면 그대로 배포된다(21MB가 그렇게 실려 나간 적이 있다).
    const backup = path.join(backupDir, `${path.relative(path.join(root, 'public'), file)}.bak`);
    await mkdir(path.dirname(backup), { recursive: true });
    await copyFile(file, backup);
    const target = file.replace(/\.(mp3\.m4a|m4a|mp4|webm|ogg|wav)$/, '.m4a');
    await writeFile(target, m4a);
    if (target !== file) await rm(file, { force: true });

    const relative = path.relative(path.join(root, 'public'), target);
    const next = { id: asset.id, src: relative, bytes: (await stat(target)).size };
    // 같은 파일을 가리키는 다른 항목(옛 표기 등)도 함께 고친다.
    // 안 그러면 그 항목만 사라진 옛 경로에 남아 앱에서 소리가 안 난다.
    for (const [otherText, other] of Object.entries(recorded.assets)) {
      if (other.src !== asset.src && otherText !== text) continue;
      recorded.assets[otherText] = { ...next };
      manifest = applyToManifest(manifest, otherText, recorded.assets[otherText], manifest.recorded);
    }
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
