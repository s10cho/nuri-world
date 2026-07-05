import { describe, it, expect } from 'vitest';
import {
  CHOSEONG,
  JUNGSEONG,
  compose,
  decompose,
  demoSyllable,
  objectParticle,
  subjectParticle,
} from '../js/hangul.js';

describe('compose', () => {
  it('초성+중성을 받침 없는 음절로 조합', () => {
    expect(compose('ㄱ', 'ㅏ')).toBe('가');
    expect(compose('ㅎ', 'ㅏ')).toBe('하');
    expect(compose('ㅇ', 'ㅗ')).toBe('오');
    expect(compose('ㅆ', 'ㅣ')).toBe('씨');
  });

  it('잘못된 자모는 null', () => {
    expect(compose('ㅏ', 'ㅏ')).toBeNull(); // 초성 자리에 모음
    expect(compose('ㄱ', 'ㄴ')).toBeNull(); // 중성 자리에 자음
    expect(compose('x', 'ㅏ')).toBeNull();
  });

  it('모든 초성×중성 조합이 받침 없는 유효 음절', () => {
    for (const cho of CHOSEONG) {
      for (const jung of JUNGSEONG) {
        const s = compose(cho, jung);
        expect(s).not.toBeNull();
        expect(decompose(/** @type {string} */ (s))?.jong).toBe('');
      }
    }
  });
});

describe('decompose', () => {
  it('음절을 초/중/종성으로 분해', () => {
    expect(decompose('가')).toEqual({ cho: 'ㄱ', jung: 'ㅏ', jong: '' });
    expect(decompose('강')).toEqual({ cho: 'ㄱ', jung: 'ㅏ', jong: 'ㅇ' });
    expect(decompose('닭')).toEqual({ cho: 'ㄷ', jung: 'ㅏ', jong: 'ㄺ' });
  });

  it('한글 음절이 아니면 null', () => {
    expect(decompose('ㄱ')).toBeNull(); // 낱자 자모
    expect(decompose('A')).toBeNull();
    expect(decompose('!')).toBeNull();
  });

  it('compose↔decompose 왕복 불변식', () => {
    for (const cho of CHOSEONG) {
      for (const jung of JUNGSEONG) {
        const s = /** @type {string} */ (compose(cho, jung));
        expect(decompose(s)).toEqual({ cho, jung, jong: '' });
      }
    }
  });
});

describe('objectParticle (을/를)', () => {
  it('받침 있으면 을, 없으면 를', () => {
    expect(objectParticle('사자')).toBe('를'); // 자 = 받침 없음
    expect(objectParticle('수박')).toBe('을'); // 박 = 받침 ㄱ
    expect(objectParticle('나비')).toBe('를');
    expect(objectParticle('꽃')).toBe('을');
  });

  it('자모 이름은 낱말 끝소리로 판정 (전부 받침 → 을)', () => {
    // 기역, 니은, 디귿 … 모두 받침으로 끝나므로 '을'
    expect(objectParticle('기역')).toBe('을');
    expect(objectParticle('니은')).toBe('을');
    expect(objectParticle('시옷')).toBe('을');
  });

  it('한글 음절이 아니면 안전하게 를', () => {
    expect(objectParticle('ㄱ')).toBe('를');
  });
});

describe('subjectParticle (이/가)', () => {
  it('받침 있으면 이, 없으면 가', () => {
    expect(subjectParticle('나비')).toBe('가');
    expect(subjectParticle('수박')).toBe('이');
    expect(subjectParticle('기역')).toBe('이');
  });
});

describe('demoSyllable', () => {
  it('자음은 ㅏ와 결합', () => {
    expect(demoSyllable('ㄱ')).toBe('가');
    expect(demoSyllable('ㅎ')).toBe('하');
    expect(demoSyllable('ㅆ')).toBe('싸');
  });

  it('모음은 ㅇ과 결합', () => {
    expect(demoSyllable('ㅏ')).toBe('아');
    expect(demoSyllable('ㅗ')).toBe('오');
    expect(demoSyllable('ㅢ')).toBe('의');
  });
});
