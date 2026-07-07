// 한글 자모 조합/분해 유틸리티
// 음절 = 0xAC00 + (초성 인덱스 × 21 + 중성 인덱스) × 28 + 종성 인덱스

export const CHOSEONG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
export const JUNGSEONG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];

/** @typedef {{ cho: string, jung: string, jong: string }} Decomposed */

/**
 * 초성 + 중성 → 받침 없는 음절 (조합 불가 시 null)
 * @param {string} cho 초성
 * @param {string} jung 중성
 * @returns {string | null}
 */
export function compose(cho, jung) {
  const ci = CHOSEONG.indexOf(cho);
  const ji = JUNGSEONG.indexOf(jung);
  if (ci < 0 || ji < 0) return null;
  return String.fromCharCode(0xAC00 + (ci * 21 + ji) * 28);
}

/**
 * 음절 → { cho, jung, jong } (한글 음절이 아니면 null)
 * @param {string} syllable
 * @returns {Decomposed | null}
 */
export function decompose(syllable) {
  const code = syllable.charCodeAt(0) - 0xAC00;
  if (code < 0 || code > 11171) return null;
  const JONGSEONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  return {
    cho: CHOSEONG[Math.floor(code / 588)],
    jung: JUNGSEONG[Math.floor((code % 588) / 28)],
    jong: JONGSEONG[code % 28],
  };
}

/**
 * 자모가 들어간 발음 안내용 음절 (자음은 기본 모음 ㅏ와, 모음은 ㅇ과 결합)
 * @param {string} jamo
 * @returns {string}
 */
export function demoSyllable(jamo) {
  if (CHOSEONG.includes(jamo)) return compose(jamo, 'ㅏ') ?? jamo;
  if (JUNGSEONG.includes(jamo)) return compose('ㅇ', jamo) ?? jamo;
  return jamo;
}

/**
 * 단어/음절의 받침 유무에 따른 목적격 조사 ('을' / '를')
 * @param {string} word
 * @returns {'을' | '를'}
 */
export function objectParticle(word) {
  const last = word[word.length - 1];
  // 낱자 자모(예: 기역, 니은)는 받침 이름이지만 낱말 자체로 끝소리를 판단
  const info = decompose(last);
  if (info) return info.jong ? '을' : '를';
  // 한글 음절이 아니면(자모 기호 등) 안전하게 '를'
  return '를';
}

/**
 * 주격 조사 ('이' / '가')
 * @param {string} word
 * @returns {'이' | '가'}
 */
export function subjectParticle(word) {
  const last = word[word.length - 1];
  const info = decompose(last);
  if (info) return info.jong ? '이' : '가';
  return '가';
}

// 현대 한국어에서 발음이 (거의) 같아 소리만으로 구별하기 어려운 자모 그룹.
// 유아가 듣고 고르기에 불공평하므로 같은 문제의 보기에 함께 내지 않는다.
// (ㄱ/ㅋ/ㄲ 등 자음은 서로 다른 소리 = 학습 대상이므로 묶지 않는다.)
const CONFUSABLE_GROUPS = [
  ['ㅐ', 'ㅔ'],         // [ɛ] ≈ [e]
  ['ㅒ', 'ㅖ'],         // [jɛ] ≈ [je]
  ['ㅚ', 'ㅙ', 'ㅞ'],   // 모두 [we]
];

/**
 * 주어진 자모와 발음이 비슷한 자모 집합(자기 자신 포함).
 * @param {string} jamo
 * @returns {Set<string>}
 */
export function confusableSet(jamo) {
  const group = CONFUSABLE_GROUPS.find(g => g.includes(jamo));
  return new Set(group || [jamo]);
}

/**
 * 정답(target)과 발음이 비슷하지 않은 오답 보기 n개를 pool에서 무작위로 고른다.
 * 정답뿐 아니라 이미 고른 오답과도 발음이 겹치지 않게 해, 한 문제의 보기끼리 서로
 * 헷갈리는 발음이 함께 나오지 않도록 한다.
 * @param {string[]} pool 후보 자모
 * @param {string} target 정답 자모
 * @param {number} n 뽑을 오답 개수
 * @returns {string[]}
 */
export function pickDistractors(pool, target, n) {
  const usedGroups = [confusableSet(target)];
  const candidates = pool.filter(c => c !== target);
  /** @type {string[]} */
  const chosen = [];
  while (candidates.length && chosen.length < n) {
    const i = Math.floor(Math.random() * candidates.length);
    const c = candidates.splice(i, 1)[0];
    if (usedGroups.some(g => g.has(c))) continue; // 이미 쓰인 발음군과 겹치면 건너뜀
    chosen.push(c);
    usedGroups.push(confusableSet(c));
  }
  return chosen;
}
