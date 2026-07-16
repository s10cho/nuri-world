#!/usr/bin/env node
// Azure Speech(뉴럴 TTS)로 앱의 모든 음성 파일을 생성한다.
// 사용: AZURE_SPEECH_KEY=... [AZURE_SPEECH_REGION=koreacentral] node tools/generate-voice-assets-azure.mjs
// 옵션: --dry-run(목록만) --force(기존 파일 덮어쓰기) --missing-only(현 manifest에 없는 대사만)
//       --limit=N(앞 N개만 — 샘플 청취용) --out=DIR(출력 폴더 변경 — 샘플용)

import { mkdir, writeFile, readFile, access, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { collectVoiceLines } from './generate-voice-assets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const key = process.env.AZURE_SPEECH_KEY;
const region = process.env.AZURE_SPEECH_REGION || 'koreacentral';
const voice = process.env.AZURE_TTS_VOICE || 'ko-KR-SunHiNeural';
// 전역 기본 속도(안내·스토리 문장). 유아 대상 연구 근거: 한국어 유아용 동화 내레이션
// 실측이 성인 대화 속도의 80~85%이고, 자연스러운 아동 지향 발화의 감속 폭도 10~20%다.
const defaultRate = process.env.AZURE_TTS_RATE || '-12%';
const outputFormat = 'audio-48khz-192kbitrate-mono-mp3';

// 대사 분류(id 첫 세그먼트)별 속도 오버라이드. 연구 근거: 균일한 감속이 아니라
// '학습 목표 항목만 문장보다 더 느리게' 하는 속도 대비가 아동의 단어 학습을 예측한다.
// 그래서 자모 이름·낱말·음절(학습 타깃)은 -25%, 칭찬은 거의 정상(-5%)으로 대비를 만든다.
const RATE_BY_CATEGORY = {
  jamo: '-25%',
  'jamo-intro': '-18%', // 타깃(자모 이름) + 설명 문장이 섞인 대사라 중간값
  words: '-25%',
  syllables: '-25%',
  praise: '-5%',
};

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run') || args.has('--list');
const force = args.has('--force');
const missingOnly = args.has('--missing-only');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity;
const outArg = process.argv.find(a => a.startsWith('--out='));
const outDir = outArg ? path.resolve(root, outArg.slice('--out='.length)) : path.join(root, 'public/assets/audio/ko');
const manifestPath = path.join(root, 'public/assets/audio/ko/manifest.json');

/** js/audio.js voiceKey()와 동일한 정규화 — manifest 키로 쓰인다. @param {string} text */
function voiceKey(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/** @param {string} text */
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** @param {string} id @param {string} text */
function ssml(id, text) {
  const category = id.split('/')[0];
  const rate = RATE_BY_CATEGORY[category] || defaultRate;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ko-KR">` +
    `<voice name="${voice}"><prosody rate="${rate}">${escapeXml(text)}</prosody></voice></speak>`;
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** @param {string} id @param {string} text @returns {Promise<Buffer>} */
async function synthesize(id, text) {
  const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  // F0(무료) 티어는 분당 요청 제한이 낮아 429가 나올 수 있다 → Retry-After 존중 후 재시도
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': outputFormat,
        'User-Agent': 'nuri-world-voice-gen',
      },
      body: ssml(id, text),
    });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (response.status === 429 && attempt < 6) {
      const retryAfter = Number(response.headers.get('retry-after')) || attempt * 5;
      console.log(`  [429] ${retryAfter}s 대기 후 재시도 (${attempt}/5)`);
      await sleep(retryAfter * 1000);
      continue;
    }
    const body = await response.text().catch(() => '');
    throw new Error(`Azure TTS failed (${id}): ${response.status} ${response.statusText}${body ? `\n${body}` : ''}`);
  }
}

async function fileExists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function main() {
  let lines = collectVoiceLines();

  /** @type {Record<string, { id?: string, src: string, bytes?: number }>} */
  let existingAssets = {};
  try {
    existingAssets = JSON.parse(await readFile(manifestPath, 'utf8'))?.assets || {};
  } catch { /* 첫 생성이면 manifest가 없을 수 있음 */ }

  if (missingOnly) {
    lines = lines.filter(line => !existingAssets[voiceKey(line.text)]);
  }
  if (Number.isFinite(limit)) lines = lines.slice(0, limit);

  if (dryRun) {
    for (const line of lines) {
      const rate = RATE_BY_CATEGORY[line.id.split('/')[0]] || defaultRate;
      console.log(`${line.id}.mp3\t[${rate}]\t${line.text}`);
    }
    console.log(`\n${lines.length} voice assets (voice: ${voice})`);
    return;
  }

  if (!key) {
    console.error('AZURE_SPEECH_KEY가 없습니다. 예: AZURE_SPEECH_KEY=... node tools/generate-voice-assets-azure.mjs');
    process.exitCode = 1;
    return;
  }

  await mkdir(outDir, { recursive: true });

  /** @type {Map<string, { id: string, src: string, bytes: number }>} */
  const generated = new Map();
  let made = 0;
  let skipped = 0;
  for (const [index, line] of lines.entries()) {
    const file = path.join(outDir, `${line.id}.mp3`);
    if (!force && await fileExists(file)) {
      skipped += 1;
      const bytes = (await stat(file)).size;
      generated.set(voiceKey(line.text), { id: line.id, src: `assets/audio/ko/${line.id}.mp3`, bytes });
      console.log(`[skip ${index + 1}/${lines.length}] ${line.id}.mp3`);
      continue;
    }
    await mkdir(path.dirname(file), { recursive: true });
    console.log(`[make ${index + 1}/${lines.length}] ${line.id}.mp3 <- ${line.text}`);
    const audio = await synthesize(line.id, line.text);
    await writeFile(file, audio);
    generated.set(voiceKey(line.text), { id: line.id, src: `assets/audio/ko/${line.id}.mp3`, bytes: audio.length });
    made += 1;
    await sleep(400); // F0 분당 제한 완화용 간격
  }

  // --out(샘플 폴더) 모드에서는 manifest를 건드리지 않는다
  if (outDir === path.join(root, 'public/assets/audio/ko')) {
    const assets = missingOnly
      ? { ...existingAssets, ...Object.fromEntries(generated) }
      : Object.fromEntries(generated);
    const manifest = {
      format: 'mp3',
      voice,
      region,
      count: Object.keys(assets).length,
      assets,
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`manifest.json 갱신 (${manifest.count}개)`);
  }

  console.log(`완료: 생성 ${made}, 건너뜀 ${skipped}. 출력: ${path.relative(root, outDir)}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
