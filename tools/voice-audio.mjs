// 녹음 파일 다루기 공용 — PCM 디코드, 무음 분석, 앞뒤 다듬기, WAV 인코딩.
// audit / trim / match 도구가 함께 쓴다. 변환기는 macOS afconvert 또는 ffmpeg.

import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

export const AUDIO_EXTS = ['.m4a', '.mp4', '.mp3', '.wav', '.aac', '.caf', '.aif', '.aiff', '.webm', '.ogg'];

// 앞뒤 다듬기 기준
export const TRIM = {
  leadKeepMs: 80,     // 말 시작 앞에 남길 여유
  tailKeepMs: 200,    // 말 끝 뒤에 남길 여유
  clickGapMs: 150,    // 이만큼 조용했다가 나는 짧은 소리는 키보드 클릭으로 본다
  clickBlockMs: 120,
};

/** @param {string} cmd @param {string[]} args @returns {Promise<boolean>} */
export function run(cmd, args) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', code => resolve(code === 0));
  });
}

/**
 * 오디오 파일을 16bit 모노 44.1kHz PCM으로 읽는다.
 * @param {string} file @param {string} tmpDir
 * @returns {Promise<{ samples: Float32Array, rate: number } | null>}
 */
export async function decodeToPcm(file, tmpDir) {
  const wav = path.join(tmpDir, `${path.basename(file)}.decoded.wav`);
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
  return readWav(buffer);
}

/** @param {Buffer} buffer @returns {{ samples: Float32Array, rate: number } | null} */
export function readWav(buffer) {
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

/** 10ms 프레임별 RMS. @param {Float32Array} samples @param {number} rate */
export function frameLevels(samples, rate) {
  const frame = Math.round(rate * 0.01);
  /** @type {number[]} */
  const levels = [];
  let peak = 0;
  for (let i = 0; i < samples.length; i += frame) {
    let sum = 0;
    const end = Math.min(i + frame, samples.length);
    for (let j = i; j < end; j += 1) {
      sum += samples[j] * samples[j];
      peak = Math.max(peak, Math.abs(samples[j]));
    }
    levels.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  return { levels, frame, peak };
}

/**
 * 녹음 상태 요약 — 앞뒤 무음, 음량, 길이, 끝부분 클릭 의심.
 * @param {Float32Array} samples @param {number} rate
 */
export function analyse(samples, rate) {
  const { levels, peak } = frameLevels(samples, rate);
  const framePeak = levels.reduce((max, level) => Math.max(max, level), 0);
  const threshold = Math.max(framePeak * 0.08, 0.004);
  const first = levels.findIndex(level => level > threshold);
  let last = -1;
  for (let i = levels.length - 1; i >= 0; i -= 1) if (levels[i] > threshold) { last = i; break; }

  let tailClick = false;
  if (last >= 0) {
    let blockStart = last;
    while (blockStart > 0 && levels[blockStart - 1] > threshold) blockStart -= 1;
    let silence = 0;
    for (let i = blockStart - 1; i >= 0 && levels[i] <= threshold; i -= 1) silence += 1;
    tailClick = blockStart > 0 && silence * 10 >= TRIM.clickGapMs && (last - blockStart + 1) * 10 <= TRIM.clickBlockMs;
  }

  return {
    durationMs: Math.round((samples.length / rate) * 1000),
    leadMs: first < 0 ? Math.round((samples.length / rate) * 1000) : first * 10,
    tailMs: last < 0 ? 0 : Math.max(0, levels.length - 1 - last) * 10,
    peakDb: peak > 0 ? Number((20 * Math.log10(peak)).toFixed(1)) : -99,
    tailClick,
    silent: first < 0,
  };
}

/**
 * 앞뒤 무음과 끝 클릭을 뺀 구간.
 * @param {Float32Array} samples @param {number} rate
 * @returns {{ startSample: number, endSample: number, clickRemoved: boolean, leadMs: number, tailMs: number } | null}
 */
export function findSpeech(samples, rate) {
  const { levels, frame } = frameLevels(samples, rate);
  const peak = levels.reduce((max, level) => Math.max(max, level), 0);
  if (!peak) return null;
  const threshold = Math.max(peak * 0.08, 0.004);

  const first = levels.findIndex(level => level > threshold);
  let last = -1;
  for (let i = levels.length - 1; i >= 0; i -= 1) if (levels[i] > threshold) { last = i; break; }
  if (first < 0 || last < 0) return null;

  let clickRemoved = false;
  let clickStart = -1;
  let blockStart = last;
  while (blockStart > 0 && levels[blockStart - 1] > threshold) blockStart -= 1;
  let silence = 0;
  for (let i = blockStart - 1; i >= 0 && levels[i] <= threshold; i -= 1) silence += 1;
  if (blockStart > 0 && silence * 10 >= TRIM.clickGapMs && (last - blockStart + 1) * 10 <= TRIM.clickBlockMs) {
    clickStart = blockStart;
    last = blockStart - silence;
    clickRemoved = true;
    while (last > 0 && levels[last] <= threshold) last -= 1;
  }

  // 말끝 뒤에 여유를 두되, 잘라 낸 클릭을 다시 포함하지 않도록 그 앞에서 멈춘다
  // (여유 200ms > 클릭까지의 무음 160ms 인 경우가 있어 클릭이 되살아났다)
  let endSample = Math.min(samples.length, ((last + 1) * frame) + Math.round(rate * (TRIM.tailKeepMs / 1000)));
  if (clickRemoved && clickStart > 0) {
    endSample = Math.min(endSample, Math.max((last + 1) * frame, (clickStart * frame) - Math.round(rate * 0.03)));
  }

  return {
    startSample: Math.max(0, (first * frame) - Math.round(rate * (TRIM.leadKeepMs / 1000))),
    endSample,
    clickRemoved,
    leadMs: first * 10,
    tailMs: Math.max(0, levels.length - 1 - last) * 10,
  };
}

/** Float32 모노 PCM → 16bit WAV. @param {Float32Array} samples @param {number} rate @returns {Buffer} */
export function encodeWav(samples, rate) {
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
