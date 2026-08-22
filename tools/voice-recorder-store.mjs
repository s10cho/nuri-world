// 녹음 페이지(public/voice-scripts.html)가 저장한 육성 파일을 디스크에 반영하는 로직.
// Vite 개발 서버 플러그인(tools/vite-plugin-voice-recorder.mjs)과 재변환 스크립트가 공유하고,
// 순수 함수는 tests/voice-recorder-store.test.js에서 검증한다.

import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, '..');
export const audioDir = path.join(root, 'public/assets/audio/ko');
export const recordedJsonPath = path.join(__dirname, 'recorded-assets.json');
export const manifestPath = path.join(audioDir, 'manifest.json');

// 녹음본이 가질 수 있는 확장자. `.mp3.m4a`는 초기 수동 반입(import:voice) 때 붙던 형식이라
// 기존 파일과의 호환을 위해 계속 인식한다. TTS 생성본(`.mp3`)은 절대 이 목록에 넣지 않는다.
export const RECORDING_EXTS = ['.mp3.m4a', '.m4a', '.mp4', '.webm', '.ogg', '.wav'];

// iOS(Capacitor WebView)에서 재생되지 않는 컨테이너 — 저장은 하되 경고를 띄운다.
const RISKY_EXTS = new Set(['.webm', '.ogg']);

/** js/audio.js voiceKey()와 동일한 정규화 — manifest·recorded-assets 키. @param {string} text */
export function voiceKey(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * MediaRecorder가 준 MIME → 저장 확장자.
 * @param {string} [mime] 예: 'audio/webm;codecs=opus'
 * @returns {string}
 */
export function extForMime(mime) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  switch (base) {
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/x-m4a':
    case 'audio/aac':
      return '.m4a';
    case 'audio/mpeg':
      return '.m4a'; // .mp3는 TTS 생성본 자리라 녹음본은 컨테이너만 m4a로 맞춘다
    case 'audio/ogg':
      return '.ogg';
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return '.wav';
    case 'audio/webm':
    default:
      return '.webm';
  }
}

/** ffmpeg 없이 그대로 저장했을 때 iOS에서 문제가 될 확장자인가. @param {string} ext */
export function isRiskyExt(ext) {
  return RISKY_EXTS.has(ext);
}

/** @param {string} file */
export async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** @type {boolean | null} */
let ffmpegCache = null;

/** ffmpeg 사용 가능 여부(프로세스당 1회 확인). @returns {Promise<boolean>} */
export async function hasFfmpeg() {
  if (ffmpegCache !== null) return ffmpegCache;
  ffmpegCache = await new Promise(resolve => {
    const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', code => resolve(code === 0));
  });
  return ffmpegCache;
}

/**
 * ffmpeg로 m4a(AAC 모노)로 변환. 실패하면 null.
 * @param {Buffer} input
 * @param {string} inputExt 원본 확장자(.webm 등)
 * @returns {Promise<Buffer | null>}
 */
export async function toM4a(input, inputExt) {
  if (!await hasFfmpeg()) return null;
  const stamp = process.hrtime.bigint().toString(36);
  const dir = await mkdtempSafe();
  const src = path.join(dir, `rec-${stamp}${inputExt}`);
  const dest = path.join(dir, `rec-${stamp}.m4a`);
  try {
    await writeFile(src, input);
    const ok = await new Promise(resolve => {
      const child = spawn('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', src,
        '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '96k',
        dest,
      ], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('close', code => resolve(code === 0));
    });
    if (!ok) return null;
    return await readFile(dest);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function mkdtempSafe() {
  const dir = path.join(os.tmpdir(), `nuri-voice-${process.pid}-${process.hrtime.bigint().toString(36)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** @typedef {{ id: string, src: string, bytes: number }} VoiceAsset */

/** recorded-assets.json 읽기(없으면 빈 목록). @returns {Promise<{ _설명?: string, assets: Record<string, VoiceAsset> }>} */
export async function readRecorded() {
  try {
    const parsed = JSON.parse(await readFile(recordedJsonPath, 'utf8'));
    return { ...parsed, assets: parsed?.assets || {} };
  } catch {
    return { assets: {} };
  }
}

/** manifest.json 읽기(없으면 기본 골격). @returns {Promise<Record<string, any>>} */
export async function readManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    return { format: 'mp3', count: 0, recorded: 0, assets: {} };
  }
}

/**
 * manifest에 한 항목을 반영한다(녹음 저장/삭제 공통). asset이 null이면 키를 제거한다.
 * 앱(js/audio.js)은 assets[voiceKey(대사)].src를 그대로 재생하므로 이 한 곳만 맞으면 된다.
 * @param {Record<string, any>} manifest
 * @param {string} key voiceKey(대사)
 * @param {VoiceAsset | null} asset
 * @param {number} recordedCount 실제 존재하는 녹음 파일 수
 * @returns {Record<string, any>} 새 manifest 객체
 */
export function applyToManifest(manifest, key, asset, recordedCount) {
  const assets = { ...(manifest.assets || {}) };
  if (asset) assets[key] = asset;
  else delete assets[key];
  return { ...manifest, count: Object.keys(assets).length, recorded: recordedCount, assets };
}

/**
 * 디스크에 실제로 존재하는 녹음 개수.
 * @param {Record<string, VoiceAsset>} recordedAssets
 * @returns {Promise<number>}
 */
export async function countRecordedOnDisk(recordedAssets) {
  let count = 0;
  for (const asset of Object.values(recordedAssets)) {
    if (await fileExists(path.join(root, 'public', asset.src))) count += 1;
  }
  return count;
}

/**
 * 같은 대사의 예전 녹음 파일들을 지운다(확장자가 바뀐 재녹음 대비).
 * TTS 생성본(`.mp3`)은 건드리지 않는다.
 * @param {string} id
 * @param {string} [keepExt] 남겨 둘 확장자
 * @returns {Promise<string[]>} 지운 파일의 public 기준 상대 경로
 */
export async function removeStaleRecordings(id, keepExt) {
  const removed = [];
  for (const ext of RECORDING_EXTS) {
    if (ext === keepExt) continue;
    const file = path.join(audioDir, `${id}${ext}`);
    if (await fileExists(file)) {
      await rm(file, { force: true });
      removed.push(`assets/audio/ko/${id}${ext}`);
    }
  }
  return removed;
}

/** 두 JSON 파일을 프로젝트 포맷(2칸 들여쓰기 + 개행)으로 쓴다. */
async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * 녹음본 저장 — 파일 기록 + recorded-assets.json + manifest.json 갱신.
 * @param {{ id: string, text: string, bytes: Buffer, mime?: string, convert?: boolean }} input
 * @returns {Promise<{ src: string, bytes: number, converted: boolean, warning?: string }>}
 */
export async function saveRecording({ id, text, bytes, mime, convert = true }) {
  const sourceExt = extForMime(mime);
  let data = bytes;
  let ext = sourceExt;
  let converted = false;

  if (convert && sourceExt !== '.m4a') {
    const m4a = await toM4a(bytes, sourceExt);
    if (m4a) {
      data = m4a;
      ext = '.m4a';
      converted = true;
    }
  }

  const relative = `assets/audio/ko/${id}${ext}`;
  const file = path.join(audioDir, `${id}${ext}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  await removeStaleRecordings(id, ext);

  const key = voiceKey(text);
  const asset = { id, src: relative, bytes: data.length };

  const recorded = await readRecorded();
  // 같은 대사의 옛 항목(키가 정규화 전 원문일 수 있음)을 정리하고 새로 넣는다
  for (const [oldKey, oldAsset] of Object.entries(recorded.assets)) {
    if (oldAsset?.id === id && oldKey !== key) delete recorded.assets[oldKey];
  }
  recorded.assets[key] = asset;
  await writeJson(recordedJsonPath, recorded);

  const recordedCount = await countRecordedOnDisk(recorded.assets);
  await writeJson(manifestPath, applyToManifest(await readManifest(), key, asset, recordedCount));

  const warning = !converted && isRiskyExt(ext)
    ? `${ext} 형식으로 저장했습니다. iOS 앱에서는 재생되지 않을 수 있어요 — ffmpeg 설치(brew install ffmpeg) 후 npm run convert:voice 를 실행하거나 Safari로 녹음하세요.`
    : undefined;

  return { src: relative, bytes: data.length, converted, warning };
}

/**
 * 녹음본 삭제 — 파일 제거 후 TTS 생성본이 있으면 manifest를 그쪽으로 되돌린다.
 * @param {{ id: string, text: string, ttsFormat?: string }} input
 * @returns {Promise<{ removed: string[], fallback: VoiceAsset | null }>}
 */
export async function deleteRecording({ id, text, ttsFormat = 'mp3' }) {
  const removed = await removeStaleRecordings(id);
  const key = voiceKey(text);

  const recorded = await readRecorded();
  /** @type {string[]} */
  const orphanCandidates = [];
  for (const [existingKey, asset] of Object.entries(recorded.assets)) {
    if (existingKey === key || asset?.id === id) {
      orphanCandidates.push(asset.src);
      delete recorded.assets[existingKey];
    }
  }
  // 같은 대사를 다른 id로 녹음해 둔 항목이 있었다면 그 파일도 정리한다
  // (남은 항목이 아직 쓰고 있는 파일은 건드리지 않는다)
  const stillUsed = new Set(Object.values(recorded.assets).map(asset => asset.src));
  for (const src of orphanCandidates) {
    if (stillUsed.has(src) || removed.includes(src)) continue;
    if (!RECORDING_EXTS.some(ext => src.endsWith(ext))) continue;
    await rm(path.join(root, 'public', src), { force: true });
    removed.push(src);
  }
  await writeJson(recordedJsonPath, recorded);

  /** @type {VoiceAsset | null} */
  let fallback = null;
  const ttsFile = path.join(audioDir, `${id}.${ttsFormat}`);
  if (await fileExists(ttsFile)) {
    fallback = { id, src: `assets/audio/ko/${id}.${ttsFormat}`, bytes: (await stat(ttsFile)).size };
  }

  const recordedCount = await countRecordedOnDisk(recorded.assets);
  await writeJson(manifestPath, applyToManifest(await readManifest(), key, fallback, recordedCount));

  return { removed, fallback };
}

/**
 * 현재 녹음 현황 — 페이지가 열릴 때 배지·진행률을 서버 기준으로 맞추는 데 쓴다.
 * 앱(js/audio.js)과 같은 기준인 '대사 텍스트'로 키잉한다. id로 키잉하면 같은 낱말이
 * 두 분류(jamo '유' · syllables '유')에 걸쳐 있을 때 한쪽이 미녹음으로 보인다.
 * @returns {Promise<{ ffmpeg: boolean, recorded: Record<string, VoiceAsset & { mtime: number }> }>}
 */
export async function recordingStatus() {
  const recorded = await readRecorded();
  /** @type {Record<string, VoiceAsset & { mtime: number }>} */
  const byText = {};
  for (const [text, asset] of Object.entries(recorded.assets)) {
    const file = path.join(root, 'public', asset.src);
    if (!await fileExists(file)) continue;
    const info = await stat(file);
    byText[voiceKey(text)] = { ...asset, bytes: info.size, mtime: info.mtimeMs };
  }
  return { ffmpeg: await hasFfmpeg(), recorded: byText };
}
