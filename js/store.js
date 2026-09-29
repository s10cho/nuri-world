// 진행 상황 저장 (localStorage)

/**
 * @typedef {object} State
 * @property {boolean} sound
 * @property {boolean} introSeen
 * @property {Record<string, number[]>} stars  왕국별 스테이지 별점(-1=미도전)
 * @property {boolean} festivalSeen
 * @property {string[]} residents  구출한 주민 id
 * @property {Record<string, number>} bestArena  글자 놀이 모드별 최고 점수
 * @property {string[]} jamo  모은 글자
 * @property {number} minStars  다음 스테이지로 가는 데 필요한 최소 별(1~3, 설정의 난이도)
 */

const KEY = 'nuri-hangul-kingdom-v1';

/** @type {State} */
const DEFAULT = {
  sound: true,
  introSeen: false,
  // 글자 놀이(모두 클리어 후 열리는 점수 게임) — 모드별 최고 점수
  bestArena: {},
  // 왕국별 스테이지 별점: stars['meadow'][0] = 스테이지1 별 개수(0~3), -1 = 미도전
  stars: {
    meadow:  [-1, -1, -1, -1, -1],
    lake:    [-1, -1, -1, -1, -1],
    tower:   [-1, -1, -1, -1, -1],
    village: [-1, -1, -1, -1, -1],
    castle:  [-1],
  },
  festivalSeen: false,
  // 구출한 주민 id 목록 (도감)
  residents: [],
  // 모은 글자 (도감)
  jamo: [],
  // 난이도 — 다음 스테이지·왕국으로 가려면 이 개수 이상의 별이 필요하다.
  // 스테이지를 끝까지 하면 별은 최소 1개라, 1이면 예전처럼 '끝내기만 하면 통과'다.
  minStars: 1,
};

/** @param {unknown} n @returns {number} 1~3 으로 맞춘 최소 별 */
function clampMinStars(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(3, Math.max(1, v)) : 1;
}

// 깊은 복사 — structuredClone은 iOS/iPadOS 15.4 미만에서 미지원이라 흰 화면을 유발.
// 상태가 순수 JSON(숫자/문자열/배열/객체)이므로 JSON 복사로 충분.
/**
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** @returns {State} */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return clone(DEFAULT);
    const data = JSON.parse(raw);
    // 기본값과 병합 (버전업 대비)
    const merged = { ...clone(DEFAULT), ...data };
    merged.stars = { ...clone(DEFAULT.stars), ...(data.stars || {}) };
    merged.minStars = clampMinStars(merged.minStars);
    return /** @type {State} */ (merged);
  } catch {
    return clone(DEFAULT);
  }
}

let state = load();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 시크릿 모드 등 */ }
}

export const store = {
  /** @returns {State} */
  get() { return state; },

  /** @param {boolean} on */
  setSound(on) { state.sound = on; save(); },

  /**
   * 모드별 최고 점수.
   * @param {string} mode
   * @returns {number}
   */
  bestArena(mode) { return state.bestArena?.[mode] || 0; },

  /** 어느 모드든 통틀어 가장 높은 점수 (지도에 표시) @returns {number} */
  bestArenaAny() { return Math.max(0, ...Object.values(state.bestArena || {})); },

  /**
   * 최고 점수 갱신 — 새 기록일 때만 저장한다.
   * @param {string} mode @param {number} score
   * @returns {boolean} 새 기록이면 true
   */
  setBestArena(mode, score) {
    if (!state.bestArena) state.bestArena = {};
    if (score <= (state.bestArena[mode] || 0)) return false;
    state.bestArena[mode] = score;
    save();
    return true;
  },

  /** 다음 단계로 가는 데 필요한 최소 별 @returns {number} */
  minStars() { return clampMinStars(state.minStars); },

  /** @param {number} n 1~3 */
  setMinStars(n) { state.minStars = clampMinStars(n); save(); },

  /**
   * 이 스테이지를 통과했는가 — 최고 기록이 최소 별 이상.
   * (다시 해서 별이 적게 나와도 최고 기록은 유지되므로 이미 넘은 단계는 막히지 않는다)
   * @param {string} kingdom @param {number} stageIdx @returns {boolean}
   */
  stagePassed(kingdom, stageIdx) {
    return (state.stars[kingdom]?.[stageIdx] ?? -1) >= this.minStars();
  },

  markIntroSeen() { state.introSeen = true; save(); },
  markFestivalSeen() { state.festivalSeen = true; save(); },

  // 별점은 최고 기록 유지
  /** @param {string} kingdom @param {number} stageIdx @param {number} stars */
  setStars(kingdom, stageIdx, stars) {
    const cur = state.stars[kingdom]?.[stageIdx] ?? -1;
    if (stars > cur) {
      state.stars[kingdom][stageIdx] = stars;
      save();
    }
  },

  /** @param {string} id @returns {boolean} 새로 구출했으면 true */
  addResident(id) {
    if (!state.residents.includes(id)) {
      state.residents.push(id);
      save();
      return true; // 새로 구출
    }
    return false;
  },

  /** @param {string} ch @returns {boolean} */
  addJamo(ch) {
    if (!state.jamo.includes(ch)) {
      state.jamo.push(ch);
      save();
      return true;
    }
    return false;
  },

  // 왕국 클리어 여부 (모든 스테이지가 최소 별 이상)
  /** @param {string} kingdom @returns {boolean} */
  kingdomCleared(kingdom) {
    return state.stars[kingdom].every((_, i) => this.stagePassed(kingdom, i));
  },

  // 왕국 잠금 해제 여부: 이전 왕국 클리어 시 열림
  /** @param {string} kingdom @returns {boolean} */
  kingdomUnlocked(kingdom) {
    const order = ['meadow', 'lake', 'tower', 'village', 'castle'];
    const i = order.indexOf(kingdom);
    if (i <= 0) return true;
    return this.kingdomCleared(order[i - 1]);
  },

  // 스테이지 잠금: 이전 스테이지를 최소 별 이상으로 통과하면 열림
  /** @param {string} kingdom @param {number} stageIdx @returns {boolean} */
  stageUnlocked(kingdom, stageIdx) {
    if (stageIdx === 0) return true;
    return this.stagePassed(kingdom, stageIdx - 1);
  },

  totalStars() {
    return Object.values(state.stars).flat().reduce((a, b) => a + Math.max(0, b), 0);
  },

  reset() {
    state = clone(DEFAULT);
    save();
  },
};
