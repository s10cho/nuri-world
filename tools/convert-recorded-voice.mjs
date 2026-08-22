#!/usr/bin/env node
// 녹음 페이지가 wav/webm/ogg로 저장한 육성 파일을 m4a(AAC)로 변환한다.
// Chrome은 webm(opus)로만 녹음할 수 있는데 iOS WebView는 그 컨테이너를 재생하지 못하므로,
// ffmpeg가 없던 시점에 저장한 파일들을 나중에 한 번에 정리하는 용도다.
//
//   brew install ffmpeg && npm run convert:voice
//   npm run convert:voice -- --dry-run

import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  applyToManifest,
  audioDir,
  countRecordedOnDisk,
  fileExists,
  findConverter,
  manifestPath,
  readManifest,
  readRecorded,
  recordedJsonPath,
  root,
  toM4a,
} from './voice-recorder-store.mjs';

const dryRun = process.argv.includes('--dry-run');
const CONVERTIBLE = /\.(webm|ogg|wav)$/;

async function main() {
  const converter = await findConverter();
  if (!converter) {
    console.error('변환기를 찾을 수 없습니다. brew install ffmpeg 후 다시 실행하세요(macOS는 보통 afconvert가 기본 탑재).');
    process.exitCode = 1;
    return;
  }
  console.log(`변환기: ${converter}${converter === 'afconvert' ? ' (wav만 변환 가능 — webm/ogg는 ffmpeg 필요)' : ''}`);

  const recorded = await readRecorded();
  const targets = Object.entries(recorded.assets).filter(([, asset]) => CONVERTIBLE.test(asset.src));
  if (!targets.length) {
    console.log('변환할 파일이 없습니다. 모든 녹음이 이미 m4a입니다.');
    return;
  }

  let manifest = await readManifest();
  let converted = 0;

  for (const [key, asset] of targets) {
    const source = path.join(root, 'public', asset.src);
    if (!await fileExists(source)) {
      console.warn(`[skip] 파일 없음: ${asset.src}`);
      continue;
    }
    const ext = path.extname(asset.src);
    if (dryRun) {
      console.log(`[dry] ${asset.src} → ${asset.src.replace(CONVERTIBLE, '.m4a')}`);
      continue;
    }

    const output = await toM4a(await readFile(source), ext);
    if (!output) {
      console.warn(`[fail] 변환 실패: ${asset.src}${converter === 'afconvert' && ext !== '.wav' ? ' (afconvert는 이 형식을 못 읽습니다 — brew install ffmpeg)' : ''}`);
      continue;
    }

    const relative = `assets/audio/ko/${asset.id}.m4a`;
    await writeFile(path.join(audioDir, `${asset.id}.m4a`), output);
    await rm(source, { force: true });

    const next = { id: asset.id, src: relative, bytes: output.length };
    recorded.assets[key] = next;
    manifest = applyToManifest(manifest, key, next, manifest.recorded);
    converted += 1;
    console.log(`[ok] ${asset.src} → ${relative} (${(output.length / 1024).toFixed(0)}KB)`);
  }

  if (dryRun || !converted) return;

  manifest.recorded = await countRecordedOnDisk(recorded.assets);
  await writeFile(recordedJsonPath, `${JSON.stringify(recorded, null, 2)}\n`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n${converted}개 변환 완료. recorded-assets.json · manifest.json 갱신됨.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
