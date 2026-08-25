// 로컬 음성 인식(whisper.cpp) 공용 부분.
// match:voice(내려받은 파일 판별)와 listen:voice(반입된 녹음 역검증)가 함께 쓴다.

import { spawn } from 'node:child_process';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** @param {string} cmd @param {string[]} args @returns {Promise<{ ok: boolean, out: string }>} */
export function runCapture(cmd, args) {
  return new Promise(resolve => {
    const child = spawn(cmd, args);
    let out = '';
    child.stdout?.on('data', chunk => { out += chunk; });
    child.stderr?.on('data', () => { /* whisper는 진행 로그를 stderr로 낸다 */ });
    child.on('error', () => resolve({ ok: false, out: '' }));
    child.on('close', code => resolve({ ok: code === 0, out }));
  });
}

/** whisper-cli 실행 파일. @returns {Promise<string>} */
export async function findWhisperCli() {
  for (const candidate of ['whisper-cli', '/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli']) {
    const { ok } = await runCapture(candidate, ['--help']);
    if (ok) return candidate;
  }
  return '';
}

/**
 * 한국어를 알아들을 만한 모델 파일을 찾는다.
 * @param {string} [override] --whisper-model= 로 준 경로
 * @returns {Promise<string>}
 */
export async function findWhisperModel(override = '') {
  if (override) return override.replace(/^~(?=\/|$)/, os.homedir());
  const dirs = [
    path.join(os.homedir(), '.cache/whisper.cpp'),
    path.join(os.homedir(), 'Library/Application Support/whisper.cpp'),
    '/opt/homebrew/share/whisper-cpp',
  ];
  /** @type {string[]} */
  const found = [];
  for (const dir of dirs) {
    try {
      for (const name of await readdir(dir)) {
        if (name.endsWith('.bin')) found.push(path.join(dir, name));
      }
    } catch { /* 없는 폴더는 건너뛴다 */ }
  }
  if (!found.length) return '';
  // 큰 모델(large/turbo)을 우선 — 한국어 짧은 문장은 작은 모델이 잘 틀린다
  const rank = file => (/large|turbo/.test(file) ? 0 : /medium/.test(file) ? 1 : /small/.test(file) ? 2 : 3);
  found.sort((a, b) => rank(a) - rank(b));
  return found[0];
}

/** whisper.cpp 를 쓸 수 있으면 {cli, model}, 아니면 안내와 함께 null. */
export async function findWhisper(override = '') {
  const cli = await findWhisperCli();
  const model = cli ? await findWhisperModel(override) : '';
  if (cli && model) return { cli, model };
  return null;
}

/**
 * whisper.cpp 로 받아쓰기. 16kHz 모노 WAV만 받으므로 먼저 변환한다.
 * @param {string} file @param {string} tmpDir @param {{ cli: string, model: string }} whisper
 * @returns {Promise<{ text: string, durationMs: number }>}
 */
export async function transcribeLocal(file, tmpDir, whisper) {
  const wav = path.join(tmpDir, `${path.basename(file)}.16k.wav`);
  const converted = await runCapture('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', file, wav]);
  if (!converted.ok) {
    const viaFfmpeg = await runCapture('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', wav]);
    if (!viaFfmpeg.ok) throw new Error('16kHz WAV 변환 실패');
  }

  let durationMs = 0;
  try {
    const info = await stat(wav);
    durationMs = Math.round(((info.size - 44) / (16000 * 2)) * 1000); // 16kHz 16bit 모노
  } catch { /* 길이를 못 재면 점수에 반영하지 않는다 */ }

  const prefix = path.join(tmpDir, `${path.basename(file)}.out`);
  const result = await runCapture(whisper.cli, [
    '-m', whisper.model,
    '-f', wav,
    '-l', 'ko',
    '-nt',                 // 타임스탬프 없이
    '-np',                 // 진행 출력 끄기
    '-otxt', '-of', prefix,
    // --prompt 는 쓰지 않는다: 짧고 조용한 클립에서 프롬프트 문장을 그대로 받아쓰는 환각이 있었다
  ]);
  await rm(wav, { force: true });
  if (!result.ok) throw new Error('whisper 실행 실패');

  let text = result.out.trim();
  try {
    text = (await readFile(`${prefix}.txt`, 'utf8')).trim() || text;
    await rm(`${prefix}.txt`, { force: true });
  } catch { /* 파일이 없으면 stdout 사용 */ }
  return { text: text.replace(/\s+/g, ' ').trim(), durationMs };
}
