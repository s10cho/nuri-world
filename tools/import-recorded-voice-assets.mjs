#!/usr/bin/env node

import { copyFile, mkdir, writeFile, access, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { collectVoiceLines } from './generate-voice-assets.mjs';

const sourceDir = process.env.VOICE_SOURCE_DIR || path.join(process.env.HOME || '', 'Downloads');
const outputDir = process.env.VOICE_OUTPUT_DIR || path.join(process.cwd(), 'public/assets/audio/ko');
const positionalArgs = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const until = process.env.VOICE_IMPORT_UNTIL || positionalArgs[0] || 'words/ko-c3c6d557d9.mp3';
const sourceExt = process.env.VOICE_SOURCE_EXT || '.mp3.m4a';
const dryRun = process.argv.includes('--dry-run');

/** @param {string} file */
async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} assetFile */
function sourceName(assetFile) {
  return assetFile.replaceAll('/', ':').replace(/\.mp3$/, sourceExt);
}

async function main() {
  const lines = collectVoiceLines();
  const untilIndex = lines.findIndex(line => `${line.id}.mp3` === until);
  if (untilIndex < 0) {
    throw new Error(`Could not find target asset in voice list: ${until}`);
  }

  const selected = lines.slice(0, untilIndex + 1);
  const missing = [];
  const imported = [];

  for (const line of selected) {
    const assetFile = `${line.id}.mp3`;
    const src = path.join(sourceDir, sourceName(assetFile));
    const dest = path.join(outputDir, `${line.id}${sourceExt}`);

    if (!await fileExists(src)) {
      missing.push(src);
      continue;
    }

    const info = await stat(src);
    imported.push({
      id: line.id,
      text: line.text,
      src: `assets/audio/ko/${line.id}${sourceExt}`,
      bytes: info.size,
    });

    if (!dryRun) {
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(src, dest);
    }
  }

  if (missing.length) {
    console.error(`Missing ${missing.length} source files:`);
    for (const file of missing) console.error(`- ${file}`);
    process.exitCode = 1;
    return;
  }

  if (!dryRun) {
    await mkdir(outputDir, { recursive: true });
    const manifest = {
      format: 'm4a',
      importedUntil: until,
      count: imported.length,
      assets: Object.fromEntries(imported.map(item => [
        item.text.replace(/\s+/g, ' ').trim(),
        {
          id: item.id,
          src: item.src,
          bytes: item.bytes,
        },
      ])),
    };
    await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  console.log(`${dryRun ? 'Would import' : 'Imported'} ${imported.length} files through ${until}`);
  console.log(`Output: ${path.relative(process.cwd(), outputDir)}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
