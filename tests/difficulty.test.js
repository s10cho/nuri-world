import { describe, it, expect } from 'vitest';
import { starsFor, heroEnergy } from '../js/difficulty.js';

describe('별 규칙', () => {
  it('실수 0~1 → 3개, 2~4 → 2개, 5 이상 → 1개', () => {
    expect([0, 1, 2, 4, 5, 20].map(starsFor)).toEqual([3, 3, 2, 2, 1, 1]);
  });
});

describe('보스전 에너지 — 난이도(최소 별)에 따라', () => {
  it('별 3개 → 2, 별 2개 → 5, 별 1개 → 넉넉히 8', () => {
    expect(heroEnergy(3)).toBe(2);
    expect(heroEnergy(2)).toBe(5);
    expect(heroEnergy(1)).toBe(8);
  });

  it('에너지가 바닥나는 실수 횟수에서 목표 별을 더는 받을 수 없다(별 규칙과 어긋나지 않음)', () => {
    for (const need of [2, 3]) {
      const e = heroEnergy(need);
      expect(starsFor(e - 1)).toBeGreaterThanOrEqual(need); // 하트 하나 남았을 땐 아직 가능
      expect(starsFor(e)).toBeLessThan(need); // 0이 되는 순간 불가능
    }
  });

  it('어려울수록 에너지가 적다', () => {
    expect(heroEnergy(1)).toBeGreaterThan(heroEnergy(2));
    expect(heroEnergy(2)).toBeGreaterThan(heroEnergy(3));
  });
});
