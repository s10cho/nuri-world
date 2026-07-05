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
