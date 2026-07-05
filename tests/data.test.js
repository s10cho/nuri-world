import { describe, it, expect } from 'vitest';
import { decompose } from '../js/hangul.js';
import {
  JAMO,
  ALL_CONSONANTS,
  ALL_VOWELS,
  TOWER_STAGES,
  VILLAGE_STAGES,
  KINGDOMS,
  KINGDOM_ORDER,
} from '../js/data.js';

/** 단어가 전부 받침 없는 음절로만 이루어졌는지 */
function isBatchimFree(word) {
  return [...word].every(ch => {
    const d = decompose(ch);
    return d ? d.jong === '' : true; // 한글 음절만 검사
  });
}

describe('자모 구성', () => {
  it('자음 19 + 모음 21 = 40', () => {
    expect(ALL_CONSONANTS).toHaveLength(19);
    expect(ALL_VOWELS).toHaveLength(21);
    expect(ALL_CONSONANTS.length + ALL_VOWELS.length).toBe(40);
  });

  it('중복 없음', () => {
    expect(new Set(ALL_CONSONANTS).size).toBe(19);
    expect(new Set(ALL_VOWELS).size).toBe(21);
  });

  it('모든 자모가 JAMO 사전에 이름·예시단어·이모지와 함께 존재', () => {
    for (const ch of [...ALL_CONSONANTS, ...ALL_VOWELS]) {
      const info = JAMO[ch];
      expect(info, `JAMO[${ch}] 누락`).toBeDefined();
      expect(info.name).toBeTruthy();
      expect(info.words.length).toBeGreaterThan(0);
      for (const w of info.words) {
        expect(w.w).toBeTruthy();
        expect(w.e, `${ch} 예시 "${w.w}" 이모지 누락`).toBeTruthy();
      }
    }
  });
});

describe('예시 단어 정합성', () => {
  it('자음 첫 예시단어는 그 자음으로 시작', () => {
    for (const cho of ALL_CONSONANTS) {
      const word = JAMO[cho].words[0].w;
      const first = decompose(word[0]);
      expect(first, `${cho}: "${word}" 첫 글자가 한글 음절 아님`).not.toBeNull();
      expect(first?.cho, `${cho}: "${word}"의 첫소리가 ${cho} 아님`).toBe(cho);
    }
  });

  it('모음 첫 예시단어는 그 모음을 포함', () => {
    for (const jung of ALL_VOWELS) {
      const word = JAMO[jung].words[0].w;
      const contains = [...word].some(ch => decompose(ch)?.jung === jung);
      expect(contains, `${jung}: "${word}"에 ${jung} 소리 없음`).toBe(true);
    }
  });
});

describe('글자 조각의 탑(TOWER) 목표 음절', () => {
  it('모든 목표는 받침 없는 유효 음절이고 연결단어가 그 음절로 시작', () => {
    for (const stage of TOWER_STAGES) {
      for (const t of stage.targets) {
        const d = decompose(t.s);
        expect(d, `${t.s} 분해 실패`).not.toBeNull();
        expect(d?.jong, `${t.s}에 받침 있음`).toBe('');
        expect(t.w[0], `"${t.w}"가 목표 ${t.s}로 시작 안 함`).toBe(t.s);
        expect(t.e).toBeTruthy();
      }
    }
  });
});

describe('이름 없는 마을(VILLAGE) 단어', () => {
  it('모든 단어가 받침 없음', () => {
    for (const stage of VILLAGE_STAGES) {
      for (const { w, e } of stage.words) {
        expect(isBatchimFree(w), `"${w}"에 받침 있음`).toBe(true);
        expect(e).toBeTruthy();
      }
    }
  });
});

describe('커리큘럼 커버리지', () => {
  it('KINGDOM_ORDER와 KINGDOMS 키 일치', () => {
    expect([...KINGDOM_ORDER].sort()).toEqual(Object.keys(KINGDOMS).sort());
  });

  it('자음 왕국(meadow) 스테이지가 자음 19개를 빠짐없이 다룸', () => {
    const covered = new Set(KINGDOMS.meadow.stages.flatMap(s => s.jamo ?? []));
    for (const c of ALL_CONSONANTS) expect(covered.has(c), `${c} 미포함`).toBe(true);
  });

  it('모음 왕국(lake) 스테이지가 모음 21개를 빠짐없이 다룸', () => {
    const covered = new Set(KINGDOMS.lake.stages.flatMap(s => s.jamo ?? []));
    for (const v of ALL_VOWELS) expect(covered.has(v), `${v} 미포함`).toBe(true);
  });
});
