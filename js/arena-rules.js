// 글자 별 모으기의 규칙 — 화면과 분리한 순수 로직(테스트 대상).
//
// 출제 대사는 "이미 녹음이 있는 문장"만 쓴다. 앱에 TTS 음성 파일이 없어서 새 문장을 만들면
// 한국어 TTS 가 없는 기기에서 무음이 되고, 듣고 고르는 게임이 성립하지 않는다.
// 자모는 jamoDemoLine, 만든 글자는 음절 단독 녹음을 쓴다(둘 다 전량 있는 것을 확인했다).
import { shuffle } from './ui.js';
import { ALL_CONSONANTS, ALL_VOWELS, TOWER_STAGES, jamoDemoLine } from './data.js';

/** 제한 시간(초) */
export const TIME_LIMIT = 60;
/** 오답이면 깎이는 시간(초) */
export const PENALTY = 3;
/** 한 문제의 보기 수 */
export const CHOICES = 3;

/**
 * 연속 정답(콤보)에 따른 점수. 콤보가 쌓일수록 커지되 상한을 둔다 —
 * 아이가 한 번 실수해도 만회할 수 있어야 한다.
 * @param {number} combo 이번 정답 직전까지의 연속 정답 수
 * @returns {number}
 */
export function roundScore(combo) {
  return 10 + Math.min(combo, 5) * 5;
}

/**
 * 모은 글자로 출제 풀을 만든다.
 * @param {{ jamo: string[] }} progress
 * @returns {{ ch: string, line: string }[]}
 */
export function buildPool(progress) {
  const owned = new Set(progress.jamo);
  const jamo = [...ALL_CONSONANTS, ...ALL_VOWELS]
    .filter(ch => owned.has(ch))
    .map(ch => ({ ch, line: jamoDemoLine(ch) }));
  const syllables = TOWER_STAGES.flatMap(st => st.targets)
    .filter(t => owned.has(t.s))
    .map(t => ({ ch: t.s, line: t.s }));
  return [...jamo, ...syllables];
}

/**
 * 한 문제를 뽑는다 — 정답 하나와 서로 다른 오답들.
 * @param {{ ch: string, line: string }[]} pool
 * @param {number} [count] 보기 수
 * @returns {{ target: { ch: string, line: string }, options: { ch: string, line: string }[] }}
 */
export function pickRound(pool, count = CHOICES) {
  const shuffled = shuffle(pool);
  const target = shuffled[0];
  const options = shuffled.slice(0, Math.min(count, pool.length));
  return { target, options: shuffle(options) };
}

/**
 * 놀이 종류. 아이가 고를 수 있게 선택 화면에 이 순서로 나온다.
 * 소리가 필요한 것과 필요 없는 것을 섞어 뒀다 — 조용한 곳이나 한국어 음성이 없는 기기에서도
 * 최소 한 가지는 온전히 즐길 수 있어야 한다.
 * @type {{ id: string, icon: string, name: string, desc: string, needsSound: boolean }[]}
 */
export const MODES = [
  { id: 'listen', icon: '🔊', name: '소리 듣고 찾기',   desc: '들리는 글자를 골라요',     needsSound: true },
  { id: 'fall',   icon: '🌈', name: '떨어지는 글자',     desc: '내려오는 글자를 잡아요',   needsSound: false },
  { id: 'find',   icon: '👀', name: '같은 글자 모으기',  desc: '같은 글자를 모두 찾아요',  needsSound: false },
];

/** @param {string} id */
export function findMode(id) {
  return MODES.find(m => m.id === id) || MODES[0];
}

/** 떨어지는 글자: 오답을 탭했을 때 깎이는 시간(초) */
export const FALL_PENALTY = 2;
/** 같은 글자 모으기: 판 하나의 칸 수 */
export const FIND_CELLS = 8;
/** 같은 글자 모으기: 판 하나에 숨은 정답 개수 */
export const FIND_TARGETS = 3;

/**
 * 떨어뜨릴 글자 하나를 고른다. 목표 글자가 적당히 자주 나와야 아이가 성취감을 느낀다.
 * @param {{ ch: string, line: string }[]} pool
 * @param {{ ch: string, line: string }} target
 * @param {number} roll 0 이상 1 미만
 * @returns {{ ch: string, line: string }}
 */
export function spawnLetter(pool, target, roll) {
  if (roll < 0.42) return target;
  const others = pool.filter(p => p.ch !== target.ch);
  if (!others.length) return target;
  return others[Math.floor((roll - 0.42) / 0.58 * others.length) % others.length];
}

/**
 * 같은 글자 모으기 한 판 — 정답이 여러 개 섞인 칸들을 만든다.
 * @param {{ ch: string, line: string }[]} pool
 * @param {number} [cells]
 * @param {number} [targets]
 * @returns {{ target: { ch: string, line: string }, cells: { ch: string, line: string }[] }}
 */
export function buildFindBoard(pool, cells = FIND_CELLS, targets = FIND_TARGETS) {
  const shuffled = shuffle(pool);
  const target = shuffled[0];
  const others = shuffled.slice(1);
  // 정답 수는 칸 수와 남은 글자 수를 넘지 않게 — 풀이 작아도 판이 깨지지 않아야 한다
  const hits = Math.max(1, Math.min(targets, cells - 1, pool.length));
  const fillers = others.slice(0, Math.max(0, Math.min(cells - hits, others.length)));
  const board = [...Array(hits).fill(target), ...fillers];
  return { target, cells: shuffle(board) };
}
