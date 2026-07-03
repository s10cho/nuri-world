// 진행 상황 저장 (localStorage)
const KEY = 'nuri-hangul-kingdom-v1';

const DEFAULT = {
  sound: true,
  introSeen: false,
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
};

// 깊은 복사 — structuredClone은 iOS/iPadOS 15.4 미만에서 미지원이라 흰 화면을 유발.
// 상태가 순수 JSON(숫자/문자열/배열/객체)이므로 JSON 복사로 충분.
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return clone(DEFAULT);
    const data = JSON.parse(raw);
    // 기본값과 병합 (버전업 대비)
    const merged = { ...clone(DEFAULT), ...data };
    merged.stars = { ...clone(DEFAULT.stars), ...(data.stars || {}) };
    return merged;
  } catch {
    return clone(DEFAULT);
  }
}

let state = load();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 시크릿 모드 등 */ }
}

export const store = {
  get() { return state; },

  setSound(on) { state.sound = on; save(); },

  markIntroSeen() { state.introSeen = true; save(); },
  markFestivalSeen() { state.festivalSeen = true; save(); },

  // 별점은 최고 기록 유지
  setStars(kingdom, stageIdx, stars) {
    const cur = state.stars[kingdom]?.[stageIdx] ?? -1;
    if (stars > cur) {
      state.stars[kingdom][stageIdx] = stars;
      save();
    }
  },

  addResident(id) {
    if (!state.residents.includes(id)) {
      state.residents.push(id);
      save();
      return true; // 새로 구출
    }
    return false;
  },

  addJamo(ch) {
    if (!state.jamo.includes(ch)) {
      state.jamo.push(ch);
      save();
      return true;
    }
    return false;
  },

  // 왕국 클리어 여부 (모든 스테이지 별 1개 이상)
  kingdomCleared(kingdom) {
    return state.stars[kingdom].every(s => s >= 1);
  },

  // 왕국 잠금 해제 여부: 이전 왕국 클리어 시 열림
  kingdomUnlocked(kingdom) {
    const order = ['meadow', 'lake', 'tower', 'village', 'castle'];
    const i = order.indexOf(kingdom);
    if (i <= 0) return true;
    return this.kingdomCleared(order[i - 1]);
  },

  // 스테이지 잠금: 이전 스테이지 클리어 시 열림
  stageUnlocked(kingdom, stageIdx) {
    if (stageIdx === 0) return true;
    return (state.stars[kingdom][stageIdx - 1] ?? -1) >= 1;
  },

  totalStars() {
    return Object.values(state.stars).flat().reduce((a, b) => a + Math.max(0, b), 0);
  },

  reset() {
    state = clone(DEFAULT);
    save();
  },
};
