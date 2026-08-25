#!/usr/bin/env node
// 한 폴더에 모아 둔 녹음 파일들이 '어떤 대사'인지 알아내 프로젝트 구조로 복사한다.
//
//   npm run match:voice -- --dry-run          무엇이 어디로 갈지 계획만 보기
//   OPENAI_API_KEY=sk-... npm run match:voice 실제 반영(음성 인식으로 대사 판별)
//   npm run match:voice -- --order            인식 없이 '녹음한 순서 = 대본 순서'로 배치
//   npm run match:voice -- --dir=~/Desktop/녹음 --move
//
// 판별 순서
//  1) 파일명이 대본의 파일 이름 규칙과 맞으면 그대로 사용 (분류:파일명.mp3.m4a 또는 분류/파일명.m4a)
//  2) 음성 인식(OpenAI) → 600개 대사와 글자 단위 유사도 비교 → 가장 비슷한 대사
//  3) --order 모드: 파일 수정 시각 순서를 대본(녹음할 것) 순서에 1:1로 맞춤
//
// 확정된 것만 반영하고, 애매한 것(--min 미만·같은 대사에 여러 파일)은 보류 목록으로 보여 준다.
// 반영할 때 앞뒤 무음과 끝부분 클릭을 다듬고 m4a(AAC 모노 44.1kHz)로 변환한다.

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { collectVoiceLines } from './generate-voice-assets.mjs';
import { sheetOrder } from './generate-voice-check.mjs';
import { analyse, AUDIO_EXTS, decodeToPcm, encodeWav, findSpeech } from './voice-audio.mjs';
import { findWhisperCli, findWhisperModel, transcribeLocal } from './voice-stt.mjs';
import { fileExists, readRecorded, saveRecording } from './voice-recorder-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const found = argv.find(arg => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const sourceDir = path.resolve(
  (value('dir', process.env.VOICE_SOURCE_DIR || path.join(os.homedir(), 'Downloads')) || '')
    .replace(/^~(?=\/|$)/, os.homedir()),
);
const dryRun = flag('dry-run');
const orderMode = flag('order');
// 인식 + '대체로 대본 순서대로 녹음했다'를 함께 쓴다(기본값).
// 자모 하나만 다른 문장 수십 개는 소리만으로 못 가르는데, 순서가 그걸 갈라 준다.
// 순서를 전혀 믿을 수 없으면 --no-sequential.
const sequential = !flag('no-sequential');
const moveFiles = flag('move');
const rerecord = flag('rerecord');      // 이미 녹음된 대사도 덮어쓸지
const minScore = Number(value('min', '0.62'));
// 비슷한 대사가 많아(자모만 다른 문장 수십 개) 1등과 2등이 붙으면 사람이 봐야 한다
const minGap = Number(value('gap', '0.08'));
// --sequential 에서 '이 정도는 돼야 소리로 확정' 기준. 그 아래는 자리(순서)로만 채운다.
// 이보다 낮게 배치된 항목은 '확인 권장'으로 표시한다
const shakyScore = Number(value('shaky', '0.5'));
const model = value('model', 'gpt-4o-transcribe');
// stt: auto(로컬 있으면 로컬, 없으면 API) | local | api
const sttMode = value('stt', 'auto');
const whisperModelArg = value('whisper-model', process.env.WHISPER_MODEL || '');
// 이미 전사 텍스트가 있으면(예: 음성 메모 앱의 자동 받아쓰기) API 없이 그걸로 맞춘다.
// JSON 형식: { "녹음 1.m4a": "딩동댕 잘 찾았어요", ... }
const transcriptsPath = value('transcripts', '');
const logName = '.nuri-import-log.json';
// --since=2026-08-24 : 그 날짜 이후 녹음만(파일 이름의 시각, 없으면 수정 시각 기준)
const sinceArg = value('since', '');
const sinceMs = sinceArg ? Date.parse(sinceArg.length <= 10 ? `${sinceArg}T00:00:00Z` : sinceArg) : 0;
// --name=패턴 : 파일 이름으로 한 번 더 거르기(폴더에 녹음 아닌 오디오가 섞여 있을 때)
const namePattern = value('name', '');
// 녹음할 때 어떤 순서로 읽었는지: sheet(대본 페이지 묶음 순서) | list(대사 목록 순서)
const alignOrder = value('align', 'sheet');

/** 대사 비교용 정규화 — 구두점·공백·이모지를 털어 낸다. @param {string} text */
export function normalize(text) {
  return String(text)
    .replace(/[\p{Extended_Pictographic}️]/gu, '')
    .replace(/[^\p{Script=Hangul}\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

/** 두 글자 묶음(bigram) 세기. @param {string} text */
function bigrams(text) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (let i = 0; i < text.length - 1; i += 1) {
    const pair = text.slice(i, i + 2);
    map.set(pair, (map.get(pair) || 0) + 1);
  }
  if (!map.size && text) map.set(text, 1); // 한 글자짜리 대사
  return map;
}

/** 두 글자 묶음 기준 Dice 유사도 0~1 (단순 비교용). @param {string} a @param {string} b */
export function similarity(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const left = bigrams(x);
  const right = bigrams(y);
  let shared = 0;
  for (const [pair, count] of left) shared += Math.min(count, right.get(pair) || 0);
  const total = [...left.values()].reduce((a2, b2) => a2 + b2, 0) + [...right.values()].reduce((a2, b2) => a2 + b2, 0);
  return total ? (2 * shared) / total : 0;
}

/** 최장 공통 부분수열 길이. @param {string} a @param {string} b */
function lcsLength(a, b) {
  /** @type {number[]} */
  let previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * 인식 결과가 대사 안에 얼마나 들어 있는지 0~1.
 * 인식기가 문장 앞부분을 흘리는 경우("기역! 가방의 가." → "가방에 가")를 살린다.
 * @param {string} transcript @param {string} candidate
 */
export function containment(transcript, candidate) {
  const x = normalize(transcript);
  const y = normalize(candidate);
  if (!x || !y) return 0;
  return lcsLength(x, y) / x.length;
}

/**
 * 대사 뭉치에서 '흔한 표현'과 '그 대사만의 표현'을 구분하는 가중치(IDF)를 만든다.
 * 이 앱 대사에는 "{자모}! 짝을 찾았어요!"처럼 틀이 같고 한 낱말만 다른 문장이 수십 개라,
 * 가중치 없이 비교하면 공통 부분이 점수를 지배해 엉뚱한 자모에 붙는다.
 * @param {{ id: string, text: string }[]} candidates
 */
export function buildIndex(candidates) {
  /** @type {Map<string, number>} */
  const df = new Map();
  const docs = candidates.map(line => bigrams(normalize(line.text)));
  for (const doc of docs) {
    for (const pair of doc.keys()) df.set(pair, (df.get(pair) || 0) + 1);
  }
  const total = Math.max(1, candidates.length);
  /** @param {string} pair */
  const idf = pair => Math.log((total + 1) / ((df.get(pair) || 0) + 1)) + 1;

  const vectors = docs.map(doc => {
    /** @type {Map<string, number>} */
    const vector = new Map();
    let norm = 0;
    for (const [pair, count] of doc) {
      const weight = count * idf(pair);
      vector.set(pair, weight);
      norm += weight * weight;
    }
    return { vector, norm: Math.sqrt(norm) || 1 };
  });

  return { candidates, vectors, idf };
}

/** @typedef {ReturnType<typeof buildIndex>} MatchIndex */

/** 같은 후보 배열로 여러 번 부를 때 색인을 다시 만들지 않도록 기억해 둔다 */
const indexCache = new WeakMap();

/**
 * 대사를 소리 내 읽으면 대략 몇 ms 걸리는지 — 길이로 후보를 걸러내는 데 쓴다.
 * (아이에게 또박또박 읽는 속도 기준)
 * @param {string} text
 */
export function expectedDurationMs(text) {
  return 350 + normalize(text).length * 230;
}

/**
 * 실제 길이와 예상 길이가 얼마나 맞는지 0.4~1. 짧은 낱말 대사가 긴 문장을 가로채는 것을 막는다.
 * @param {number} actualMs @param {string} text
 */
export function durationFit(actualMs, text) {
  if (!actualMs) return 1;
  const ratio = actualMs / expectedDurationMs(text);
  const off = Math.abs(Math.log2(ratio));
  return Math.max(0.4, 1 - 0.45 * off);
}

/**
 * 인식된 문장과 가장 비슷한 대사를 찾는다.
 * @param {string} transcript
 * @param {{ id: string, text: string }[]} candidates
 * @param {number} [durationMs] 녹음 길이(알면 정확도가 올라간다)
 * @returns {{ line: { id: string, text: string }, score: number, runnerUp: number }}
 */
export function bestMatch(transcript, candidates, durationMs = 0) {
  const scores = scoreAll(transcript, candidates, durationMs);
  let best = -1;
  let bestIndex = 0;
  let runnerUp = -1;
  scores.forEach((score, i) => {
    if (score > best) { runnerUp = best; best = score; bestIndex = i; }
    else if (score > runnerUp) runnerUp = score;
  });
  return { line: candidates[bestIndex], score: best, runnerUp: Math.max(0, runnerUp) };
}

/**
 * 인식 결과와 모든 후보의 점수.
 * @param {string} transcript
 * @param {{ id: string, text: string }[]} candidates
 * @param {number} [durationMs]
 * @returns {number[]}
 */
export function scoreAll(transcript, candidates, durationMs = 0) {
  let index = indexCache.get(candidates);
  if (!index) {
    index = buildIndex(candidates);
    indexCache.set(candidates, index);
  }

  const query = bigrams(normalize(transcript));
  /** @type {Map<string, number>} */
  const queryVector = new Map();
  let queryNorm = 0;
  for (const [pair, count] of query) {
    const weight = count * index.idf(pair);
    queryVector.set(pair, weight);
    queryNorm += weight * weight;
  }
  queryNorm = Math.sqrt(queryNorm) || 1;

  return candidates.map((line, i) => {
    const { vector, norm } = index.vectors[i];
    let dot = 0;
    for (const [pair, weight] of queryVector) {
      const other = vector.get(pair);
      if (other) dot += weight * other;
    }
    const cosine = dot / (queryNorm * norm);
    // 인식기가 앞부분을 흘려도 살리되, 흔한 표현만 겹치는 경우를 부풀리지 않도록 가중치를 낮춘다
    const base = Math.max(cosine, 0.75 * containment(transcript, line.text) * cosine ** 0.25);
    return base * durationFit(durationMs, line.text);
  });
}

/**
 * 확실히 배치된 두 파일 사이에 남은 파일 수와 대사 수가 정확히 같으면 순서대로 채운다.
 * (예: 21번은 'ㅈ', 23번은 'ㅊ'로 확정됐고 그 사이 파일 1개·대사 1개 → 22번은 그 대사)
 * 소리로는 못 가렸지만 자리로는 하나뿐인 경우를 살린다.
 * @param {number[]} assignment @returns {number[]}
 */
export function fillOrderedGaps(assignment) {
  const filled = [...assignment];
  const anchors = [];
  filled.forEach((lineIndex, i) => { if (lineIndex >= 0) anchors.push(i); });

  for (let a = 0; a + 1 < anchors.length; a += 1) {
    const left = anchors[a];
    const right = anchors[a + 1];
    const files = right - left - 1;
    const lines = filled[right] - filled[left] - 1;
    if (files > 0 && files === lines) {
      for (let k = 1; k <= files; k += 1) filled[left + k] = filled[left] + k;
    }
  }
  return filled;
}

/**
 * '대체로 대본 순서대로 녹음했다'는 전제를 인식 점수와 함께 쓴다.
 *
 * 점수 합이 최대가 되도록 통째로 정렬(DP)하면, 이 앱처럼 비슷한 문장이 수십 개라
 * 점수가 평평한 구간에서 전체가 한 칸씩 밀려도 총점이 거의 같아 조용히 다 틀린다.
 * 그래서 반대로 간다 — **확신이 서는 것만 앵커로 박고, 앵커 사이만 자리로 채운다.**
 * 순서가 한두 개 어긋나도 그 근처만 보류될 뿐 전체가 무너지지 않는다.
 *
 * @param {number[][]} scores files × lines 점수 행렬
 * @param {{ minScore?: number, minGap?: number }} [opts]
 * @returns {number[]} 파일별 대사 인덱스(정하지 못하면 -1)
 */
export function alignSequential(scores, { minScore = 0.62, minGap = 0.08 } = {}) {
  const files = scores.length;
  if (!files || !scores[0].length) return new Array(files).fill(-1);

  // 1) 소리만으로 충분히 뚜렷한 파일 = 앵커
  /** @type {{ file: number, line: number, score: number }[]} */
  const anchors = [];
  scores.forEach((row, file) => {
    let best = -1;
    let bestLine = -1;
    let second = -1;
    row.forEach((score, line) => {
      if (score > best) { second = best; best = score; bestLine = line; }
      else if (score > second) second = score;
    });
    if (best >= minScore && best - Math.max(0, second) >= minGap) {
      anchors.push({ file, line: bestLine, score: best });
    }
  });

  // 2) 앵커끼리 순서가 어긋나면(녹음 순서를 벗어난 파일) 가장 긴 '순서 맞는' 묶음만 남긴다
  const keep = longestIncreasing(anchors.map(anchor => anchor.line));
  const result = new Array(files).fill(-1);
  for (const index of keep) result[anchors[index].file] = anchors[index].line;
  return result;
}

/**
 * 앵커와 앵커 사이(그리고 앞뒤 끝)에서만 국소 정렬을 돌려 남은 파일을 채운다.
 * 구간이 앵커로 묶여 있으니 전체가 밀릴 수 없고, 틀려도 그 구간 안에서 끝난다.
 * @param {number[][]} scores @param {number[]} assignment @param {{ floor?: number }} [opts]
 * @returns {number[]}
 */
export function refineBetweenAnchors(scores, assignment, { floor = 0.3 } = {}) {
  const files = scores.length;
  const lines = files ? scores[0].length : 0;
  const filled = [...assignment];
  const anchors = [];
  filled.forEach((line, file) => { if (line >= 0) anchors.push({ file, line }); });
  if (!anchors.length) return filled;

  /** 한 구간을 단조 정렬한다(양 끝은 열려 있을 수 있다) */
  const solve = (fileFrom, fileTo, lineFrom, lineTo) => {
    const f = fileTo - fileFrom;
    const l = lineTo - lineFrom;
    if (f <= 0 || l <= 0) return;
    const dp = Array.from({ length: f + 1 }, () => new Float64Array(l + 1).fill(0));
    const from = Array.from({ length: f + 1 }, () => new Uint8Array(l + 1));
    for (let i = 1; i <= f; i += 1) {
      for (let j = 1; j <= l; j += 1) {
        let best = dp[i - 1][j];   // 파일 버림
        let choice = 2;
        if (dp[i][j - 1] > best) { best = dp[i][j - 1]; choice = 0; } // 대사 건너뜀
        const score = scores[fileFrom + i - 1][lineFrom + j - 1];
        if (score >= floor && dp[i - 1][j - 1] + score > best) {
          best = dp[i - 1][j - 1] + score;
          choice = 1;
        }
        dp[i][j] = best;
        from[i][j] = choice;
      }
    }
    let i = f;
    let j = l;
    while (i > 0 && j > 0) {
      const choice = from[i][j];
      if (choice === 1) { filled[fileFrom + i - 1] = lineFrom + j - 1; i -= 1; j -= 1; }
      else if (choice === 0) j -= 1;
      else i -= 1;
    }
  };

  // 앵커 사이
  for (let a = 0; a + 1 < anchors.length; a += 1) {
    solve(anchors[a].file + 1, anchors[a + 1].file, anchors[a].line + 1, anchors[a + 1].line);
  }
  // 첫 앵커 앞과 마지막 앵커 뒤는 한쪽만 묶여 있어 밀릴 수 있다.
  // 파일 수와 대사 수가 정확히 같아 자리가 하나뿐일 때만 채운다(fillOrderedGaps와 같은 원칙).
  const first = anchors[0];
  if (first.file > 0 && first.file === first.line) {
    for (let k = 0; k < first.file; k += 1) filled[k] = k;
  }
  const last = anchors[anchors.length - 1];
  if (files - last.file - 1 > 0 && files - last.file - 1 === lines - last.line - 1) {
    for (let k = 1; k <= files - last.file - 1; k += 1) filled[last.file + k] = last.line + k;
  }
  return filled;
}

/**
 * 값이 커지는 가장 긴 부분수열의 인덱스들. 같은 값은 순서 위반으로 본다(한 대사에 두 파일).
 * @param {number[]} values @returns {number[]}
 */
export function longestIncreasing(values) {
  if (!values.length) return [];
  /** @type {number[]} */
  const tails = [];
  /** @type {number[]} */
  const tailIndex = [];
  const previous = new Array(values.length).fill(-1);

  values.forEach((value, i) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tails[mid] < value) low = mid + 1;
      else high = mid;
    }
    tails[low] = value;
    tailIndex[low] = i;
    previous[i] = low > 0 ? tailIndex[low - 1] : -1;
  });

  const result = [];
  for (let i = tailIndex[tails.length - 1]; i >= 0; i = previous[i]) result.push(i);
  return result.reverse();
}

/** 대본의 파일 이름(분류:파일명.mp3.m4a) 또는 경로형 이름에서 id를 뽑는다. @param {string} name */
export function idFromFileName(name) {
  const base = name.replace(/\.(mp3\.m4a|m4a|mp4|mp3|wav|aac|caf|aiff?|webm|ogg)$/i, '');
  const candidate = base.includes(':') ? base.replaceAll(':', '/') : base;
  return candidate.replace(/^\/+|\/+$/g, '');
}

/**
 * 파일 이름에 든 녹음 시각(예: KakaoTalk_Audio_20260825-000451.m4a, 20260825_000451, 2026-08-25 00:04:51).
 * 한꺼번에 내려받으면 파일 수정 시각이 전부 같아져 순서 정보가 사라지므로 이름을 먼저 본다.
 * @param {string} name @returns {number} 정렬용 값(없으면 0)
 */
export function timeFromFileName(name) {
  const compact = name.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})[-_ T]?(\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2})/);
  if (compact) {
    const [, y, mo, d, h, mi, sec] = compact.map(Number);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h < 24 && mi < 60 && sec < 60) {
      return Date.UTC(y, mo - 1, d, h, mi, sec);
    }
  }
  // 이름 끝의 일련번호(녹음 1, recording (12) 등)도 순서로 쓸 수 있다
  const numbered = name.match(/(\d+)\s*[).]?\s*$/);
  return numbered ? Number(numbered[1]) : 0;
}

/** @param {string} file */
async function sha1(file) {
  return createHash('sha1').update(await readFile(file)).digest('hex');
}

/**
 * OpenAI 음성 인식.
 * @param {string} file @param {string} apiKey
 * @returns {Promise<string>}
 */
async function transcribe(file, apiKey) {
  const endpoint = process.env.OPENAI_BASE_URL
    ? `${process.env.OPENAI_BASE_URL.replace(/\/$/, '')}/audio/transcriptions`
    : 'https://api.openai.com/v1/audio/transcriptions';

  const form = new FormData();
  const bytes = await readFile(file);
  form.append('file', new Blob([bytes]), path.basename(file));
  form.append('model', model);
  form.append('language', 'ko');
  // 아이용 짧은 대사라 문맥을 조금 주면 인식률이 오른다
  form.append('prompt', '한글 학습 게임의 짧은 안내 문장입니다. 자모 이름(기역, 니은, 미음 등)과 낱말이 나옵니다.');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`음성 인식 실패 ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const result = await response.json();
  return String(result.text || '').trim();
}

// 빈 파일·잘린 파일이 멀쩡한 녹음을 덮어쓰지 않도록 하는 최소 기준
const MIN_SPEECH_MS = 250;

/** 다듬어 m4a로 저장. @param {string} file @param {{id: string, text: string}} line @param {string} tmpDir */
async function importOne(file, line, tmpDir) {
  const pcm = await decodeToPcm(file, tmpDir);
  if (!pcm) throw new Error('오디오를 읽지 못했습니다(코덱 확인 필요)');

  const stats = analyse(pcm.samples, pcm.rate);
  if (stats.silent) throw new Error('소리가 들어 있지 않습니다');
  if (stats.durationMs < MIN_SPEECH_MS) throw new Error(`너무 짧습니다(${stats.durationMs}ms) — 녹음이 제대로 저장됐는지 확인하세요`);

  const speech = findSpeech(pcm.samples, pcm.rate);
  const samples = speech ? pcm.samples.subarray(speech.startSample, speech.endSample) : pcm.samples;
  const speechMs = Math.round((samples.length / pcm.rate) * 1000);
  if (speechMs < MIN_SPEECH_MS) throw new Error(`말소리가 ${speechMs}ms 뿐입니다 — 확인이 필요합니다`);

  const wav = encodeWav(samples, pcm.rate);
  const saved = await saveRecording({ id: line.id, text: line.text, bytes: wav, mime: 'audio/wav' });
  return { ...saved, trimmedMs: speech ? Math.round(((pcm.samples.length - samples.length) / pcm.rate) * 1000) : 0 };
}

async function main() {
  if (!await fileExists(sourceDir)) {
    console.error(`폴더가 없습니다: ${sourceDir}`);
    process.exitCode = 1;
    return;
  }

  const lines = collectVoiceLines();
  const byId = new Map(lines.map(line => [line.id, line]));
  const recorded = (await readRecorded()).assets;
  const recordedTexts = new Set(Object.keys(recorded));

  /** 앱이 쓰지 않는 대사는 후보에서 뺀다(있으면 오인식을 늘린다) */
  let unused = new Set();
  try {
    unused = new Set(JSON.parse(await readFile(path.join(__dirname, 'voice-audit.json'), 'utf8')).unused || []);
  } catch { /* 검수 결과가 없으면 전부 후보 */ }
  const candidates = lines.filter(line => !unused.has(line.id));
  // --order 는 '대본 페이지에 보이는 순서대로 녹음했다'는 가정 → 같은 정렬을 쓴다
  const needList = sheetOrder(candidates.filter(line => rerecord || !recordedTexts.has(line.text)));
  // 순서 정렬은 이미 녹음한 대사까지 포함한 '대본 전체 순서'로 한다.
  // 그래야 다시 녹음한 대사가 섞여 있어도 뒤가 통째로 밀리지 않는다.
  const alignList = alignOrder === 'list' ? candidates : sheetOrder(candidates);

  const cachePath = path.join(sourceDir, '.nuri-transcripts.json');
  /** @type {Record<string, { text: string, durationMs: number }>} sha1 → 인식 결과 */
  let transcriptCache = {};
  try {
    transcriptCache = JSON.parse(await readFile(cachePath, 'utf8'));
  } catch { /* 처음이면 빈 캐시 */ }
  let cacheDirty = false;

  const logPath = path.join(sourceDir, logName);
  /** @type {Record<string, string>} sha1 → id */
  let importLog = {};
  try {
    importLog = JSON.parse(await readFile(logPath, 'utf8'));
  } catch { /* 처음이면 빈 기록 */ }

  const nameFilter = namePattern ? new RegExp(namePattern) : null;
  const entries = (await readdir(sourceDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && AUDIO_EXTS.includes(path.extname(entry.name).toLowerCase()))
    .filter(entry => !nameFilter || nameFilter.test(entry.name))
    .map(entry => path.join(sourceDir, entry.name));
  if (!entries.length) {
    console.log(`${sourceDir} 에 오디오 파일이 없습니다.`);
    return;
  }

  const files = [];
  for (const file of entries) {
    const info = await stat(file);
    files.push({ file, mtime: info.mtimeMs, size: info.size, stamp: timeFromFileName(path.basename(file)) });
  }
  // 이름에 녹음 시각이 있으면 그것이 진짜 순서다(한꺼번에 내려받으면 수정 시각은 전부 같다)
  const named = files.filter(item => item.stamp > 1e12).length; // 날짜로 읽힌 것만
  const useName = named >= files.length * 0.5;

  if (useName) {
    const unnamed = files.filter(item => item.stamp <= 1e12);
    if (unnamed.length) {
      // 이름에 녹음 시각이 없는 파일은 순서를 알 수 없다. 한꺼번에 내려받으면 수정 시각도
      // 전부 같아 쓸 수 없으므로 순서 정렬에서 빼고 따로 알려 준다.
      files.splice(0, files.length, ...files.filter(item => item.stamp > 1e12));
      console.log(`이름에 녹음 시각이 없는 오디오 ${unnamed.length}개는 건너뜁니다(순서를 알 수 없음).`);
    }
  }

  if (sinceMs) {
    const before = files.length;
    files.splice(0, files.length, ...files.filter(item => (useName ? item.stamp : item.mtime) >= sinceMs));
    console.log(`${sinceArg} 이후 녹음만: ${files.length}개 (제외 ${before - files.length}개)`);
  }
  files.sort((a, b) => (useName ? a.stamp - b.stamp : a.mtime - b.mtime) || a.file.localeCompare(b.file));

  /** @type {Record<string, string>} */
  let providedTranscripts = {};
  if (transcriptsPath) {
    providedTranscripts = JSON.parse(await readFile(path.resolve(transcriptsPath.replace(/^~(?=\/|$)/, os.homedir())), 'utf8'));
  }

  const apiKey = process.env.OPENAI_API_KEY;
  /** @type {{ cli: string, model: string } | null} */
  let whisper = null;
  if (!orderMode && !transcriptsPath && sttMode !== 'api') {
    const cli = await findWhisperCli();
    const localModel = cli ? await findWhisperModel(whisperModelArg) : '';
    if (cli && localModel) whisper = { cli, model: localModel };
    else if (sttMode === 'local') {
      console.error('로컬 음성 인식을 쓸 수 없습니다.');
      if (!cli) console.error('  whisper-cli 가 없습니다:  brew install whisper-cpp');
      else console.error('  모델 파일이 없습니다. ~/.cache/whisper.cpp/ 에 ggml-*.bin 을 두거나 --whisper-model=경로 를 주세요.');
      process.exitCode = 1;
      return;
    }
  }

  if (!orderMode && !transcriptsPath && !whisper && !apiKey) {
    console.error('음성 인식 수단이 없습니다. 다음 중 하나를 쓰세요.');
    console.error('  · 로컬(무료):  brew install whisper-cpp  +  ~/.cache/whisper.cpp/ggml-large-v3-turbo-q5_0.bin');
    console.error('  · API:        OPENAI_API_KEY=sk-... npm run match:voice');
    console.error('  · 인식 없이:   --order (대본 순서대로 녹음한 경우) 또는 --transcripts=받아쓴텍스트.json');
    process.exitCode = 1;
    return;
  }

  console.log(`${sourceDir} — 오디오 ${files.length}개`);
  const how = orderMode ? '녹음 순서만'
    : transcriptsPath ? '주어진 전사 텍스트'
      : sequential ? `순서 + ${whisper ? `로컬 인식(${path.basename(whisper.model)})` : `인식(${model})`}`
        : whisper ? `로컬 음성 인식(${path.basename(whisper.model)})`
          : `음성 인식(${model})`;
  console.log(`판별 방식: 파일명 → ${how}`);
  console.log(`대상 대사: ${needList.length}개${rerecord ? ' (이미 녹음된 것도 덮어씀)' : ''}\n`);

  const sttTmpDir = await mkdtemp(path.join(os.tmpdir(), 'nuri-stt-'));

  let transcribed = 0;
  /** @type {{ file: string, transcript: string, durationMs: number }[]} 순서 정렬 모드용 */
  const pending = [];

  /** @type {{ file: string, line?: {id:string,text:string}, how: string, score: number, transcript?: string, note?: string }[]} */
  const plan = [];
  let orderCursor = 0;

  for (const { file } of files) {
    const name = path.basename(file);
    const hash = await sha1(file);
    if (importLog[hash]) {
      plan.push({ file, how: '건너뜀', score: 1, note: `이미 반영함 → ${importLog[hash]}` });
      continue;
    }

    let durationMs = 0;
    const byName = byId.get(idFromFileName(name));
    if (byName) {
      plan.push({ file, line: byName, how: '파일명', score: 1 });
      continue;
    }

    if (orderMode) {
      const line = needList[orderCursor];
      orderCursor += 1;
      if (!line) plan.push({ file, how: '보류', score: 0, note: '대상 대사를 모두 채웠습니다' });
      else plan.push({ file, line, how: '순서', score: 0.5 });
      continue;
    }

    let transcript;
    try {
      transcript = providedTranscripts[name] ?? providedTranscripts[path.parse(name).name] ?? '';
      if (!transcript && !transcriptsPath) {
        const cached = transcriptCache[hash];
        if (cached) {
          transcript = cached.text;
          durationMs = cached.durationMs || 0;
        } else {
          process.stdout.write(`  인식 중… ${++transcribed}/${files.length} ${name}`.padEnd(70) + '\r');
          if (whisper) {
            const local = await transcribeLocal(file, sttTmpDir, whisper);
            transcript = local.text;
            durationMs = local.durationMs;
          } else {
            transcript = await transcribe(file, apiKey);
          }
          transcriptCache[hash] = { text: transcript, durationMs };
          cacheDirty = true;
        }
      }
    } catch (error) {
      plan.push({ file, how: '보류', score: 0, note: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!transcript) {
      plan.push({ file, how: '보류', score: 0, transcript, note: transcriptsPath ? '전사 텍스트에 이 파일이 없습니다' : '인식된 말이 없습니다' });
      continue;
    }
    if (sequential && !transcriptsPath) {
      pending.push({ file, transcript, durationMs });
      continue;
    }

    const match = bestMatch(transcript, candidates, durationMs);
    const gap = match.score - match.runnerUp;
    if (match.score < minScore) {
      plan.push({ file, how: '보류', score: match.score, transcript, note: `가장 비슷한 대사: "${match.line.text}" (${match.score.toFixed(2)})` });
    } else if (gap < minGap) {
      plan.push({
        file,
        how: '보류',
        score: match.score,
        transcript,
        note: `비슷한 대사가 여럿 — 1등 "${match.line.text}" (${match.score.toFixed(2)}), 2등과 차이 ${gap.toFixed(2)}`,
      });
    } else {
      plan.push({ file, line: match.line, how: '인식', score: match.score, transcript });
    }
  }

  await rm(sttTmpDir, { recursive: true, force: true });
  if (!orderMode && !transcriptsPath) process.stdout.write(' '.repeat(72) + '\r');
  // 인식 결과는 파일 내용 해시로 캐시해 둔다 — 다시 돌릴 때 몇 분을 아낀다
  if (cacheDirty) await writeFile(cachePath, `${JSON.stringify(transcriptCache, null, 1)}\n`);

  if (sequential && pending.length) {
    // 인식 점수 + 순서를 함께 만족하는 배치를 찾는다(단조 정렬)
    const scores = pending.map(item => scoreAll(item.transcript, alignList, item.durationMs));
    const aligned = alignSequential(scores, { minScore, minGap });
    // 앵커(확신) → 앵커 사이 국소 정렬 → 자리가 하나뿐인 곳 채우기
    const assignment = fillOrderedGaps(refineBetweenAnchors(scores, aligned));
    pending.forEach((item, i) => {
      const lineIndex = assignment[i];
      if (lineIndex < 0) {
        // 순서에서 벗어난 파일 — 소리만으로 충분히 확실할 때만 구제한다
        const alone = bestMatch(item.transcript, alignList, item.durationMs);
        const gap = alone.score - alone.runnerUp;
        const taken = assignment.some((assigned, k) => k !== i && assigned >= 0 && alignList[assigned].id === alone.line.id);
        if (alone.score >= minScore && gap >= minGap && !taken) {
          plan.push({
            file: item.file,
            line: alone.line,
            how: '인식(순서 밖)',
            score: alone.score,
            transcript: item.transcript,
            note: '순서와 맞지 않지만 소리가 뚜렷해 배치했습니다',
          });
        } else {
          plan.push({
            file: item.file,
            how: '보류',
            score: alone.score,
            transcript: item.transcript,
            note: `순서에 맞는 대사를 찾지 못했습니다 — 가장 비슷한 대사 "${alone.line.text}" (${alone.score.toFixed(2)})`,
          });
        }
        return;
      }
      const line = alignList[lineIndex];
      const score = scores[i][lineIndex];
      const alone = bestMatch(item.transcript, alignList, item.durationMs);
      const filledByOrder = aligned[i] < 0;
      // 자리로만 채웠는데 소리가 전혀 안 맞으면(인식 실패·다른 대사) 손대지 않는다
      if (filledByOrder && score < 0.2) {
        plan.push({
          file: item.file,
          how: '보류',
          score,
          transcript: item.transcript,
          note: `자리로는 "${line.text}" 인데 소리가 맞지 않습니다`,
        });
        return;
      }
      plan.push({
        file: item.file,
        line,
        how: filledByOrder ? '순서로 채움' : '순서+인식',
        score,
        transcript: item.transcript,
        note: filledByOrder
          ? '앞뒤가 확정돼 자리로 정했습니다 — 한 번 들어 보세요'
          : alone.line.id !== line.id
            ? `소리만 봤을 땐 "${alone.line.text}"(${alone.score.toFixed(2)}) — 순서를 우선했습니다`
            : score < shakyScore
              ? '인식이 흐릿합니다 — 한 번 들어 보세요'
              : undefined,
      });
    });
  }

  // 같은 대사에 여러 파일이면 마지막(가장 최근) 것만 쓴다 — 재테이크로 본다
  /** @type {Map<string, number>} */
  const lastIndexById = new Map();
  plan.forEach((item, index) => { if (item.line) lastIndexById.set(item.line.id, index); });

  const ready = [];
  const held = [];
  plan.forEach((item, index) => {
    if (!item.line) { held.push(item); return; }
    if (lastIndexById.get(item.line.id) !== index) {
      held.push({ ...item, how: '보류', note: '같은 대사의 이전 테이크 — 마지막 파일을 씁니다' });
      return;
    }
    if (!rerecord && recordedTexts.has(item.line.text)) {
      held.push({ ...item, how: '보류', note: '이미 녹음이 있습니다(덮어쓰려면 --rerecord)' });
      return;
    }
    ready.push(item);
  });

  const sure = ready.filter(item => item.how !== '순서로 채움');
  const guessed = ready.filter(item => item.how === '순서로 채움');

  /** @param {typeof ready} list */
  const print = list => {
    for (const item of list) {
      const score = item.how === '파일명' ? '' : ` (${item.score.toFixed(2)})`;
      console.log(`  ${path.basename(item.file)}`);
      console.log(`    → [${item.how}${score}] ${item.line.id}  "${item.line.text}"`);
      if (item.transcript) console.log(`       인식: "${item.transcript}"`);
      if (item.note) console.log(`       ! ${item.note}`);
    }
  };

  console.log(`확정 ${sure.length}개 — 소리로 확인된 배치`);
  print(sure);
  if (guessed.length) {
    console.log(`\n자리로 채움 ${guessed.length}개 — 앞뒤가 확정돼 순서로 정했습니다. 한 번씩 들어 보세요`);
    print(guessed);
  }
  if (held.length) {
    console.log(`\n보류 ${held.length}개 — 직접 확인이 필요합니다`);
    for (const item of held) {
      console.log(`  ${path.basename(item.file)}: ${item.note || '판별 실패'}${item.transcript ? `  (인식: "${item.transcript}")` : ''}`);
    }
  }

  if (dryRun) {
    console.log('\n--dry-run 이라 파일을 옮기지 않았습니다.');
    return;
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nuri-match-'));
  let done = 0;
  for (const item of ready) {
    try {
      const saved = await importOne(item.file, item.line, tmpDir);
      importLog[await sha1(item.file)] = item.line.id;
      done += 1;
      console.log(`[ok] ${item.line.id} ← ${path.basename(item.file)} (${(saved.bytes / 1024).toFixed(0)}KB, ${saved.trimmedMs}ms 다듬음)`);
      if (moveFiles) {
        const target = path.join(sourceDir, '_imported');
        await mkdir(target, { recursive: true });
        await rm(path.join(target, path.basename(item.file)), { force: true });
        await rename(item.file, path.join(target, path.basename(item.file)));
      }
    } catch (error) {
      console.error(`[fail] ${path.basename(item.file)}: ${error instanceof Error ? error.message : error}`);
    }
  }
  await rm(tmpDir, { recursive: true, force: true });
  await writeFile(logPath, `${JSON.stringify(importLog, null, 2)}\n`);

  console.log(`\n${done}개 반영 완료. 앱을 새로 고치면 바로 그 육성이 재생됩니다.`);
  if (guessed.length) console.log(`그중 ${guessed.length}개는 순서로 채운 것이라 한 번 들어 보시길 권합니다.`);
  console.log('대본 페이지 갱신:  npm run audit:voice -- --json && npm run sheet:voice');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
