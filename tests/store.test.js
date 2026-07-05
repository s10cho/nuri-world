// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../js/store.js';

beforeEach(() => {
  localStorage.clear();
  store.reset();
});

describe('별점 기록', () => {
  it('setStars는 최고 기록만 유지', () => {
    store.setStars('meadow', 0, 2);
    expect(store.get().stars.meadow[0]).toBe(2);
    store.setStars('meadow', 0, 1); // 더 낮은 점수는 무시
    expect(store.get().stars.meadow[0]).toBe(2);
    store.setStars('meadow', 0, 3); // 더 높은 점수는 갱신
    expect(store.get().stars.meadow[0]).toBe(3);
  });

  it('totalStars는 음수(-1)를 0으로 취급해 합산', () => {
    expect(store.totalStars()).toBe(0);
    store.setStars('meadow', 0, 3);
    store.setStars('meadow', 1, 2);
    expect(store.totalStars()).toBe(5);
  });
});

describe('잠금 해제 규칙', () => {
  it('첫 왕국은 항상 열림, 다음 왕국은 이전 왕국 클리어 시 열림', () => {
    expect(store.kingdomUnlocked('meadow')).toBe(true);
    expect(store.kingdomUnlocked('lake')).toBe(false);

    // meadow 전 스테이지 별 1개 이상 → 클리어
    for (let i = 0; i < 5; i++) store.setStars('meadow', i, 1);
    expect(store.kingdomCleared('meadow')).toBe(true);
    expect(store.kingdomUnlocked('lake')).toBe(true);
    expect(store.kingdomUnlocked('tower')).toBe(false);
  });

  it('스테이지는 이전 스테이지 클리어 시 열림', () => {
    expect(store.stageUnlocked('meadow', 0)).toBe(true);
    expect(store.stageUnlocked('meadow', 1)).toBe(false);
    store.setStars('meadow', 0, 1);
    expect(store.stageUnlocked('meadow', 1)).toBe(true);
    expect(store.stageUnlocked('meadow', 2)).toBe(false);
  });
});

describe('도감 수집(중복 방지)', () => {
  it('addResident는 새로 추가 시 true, 중복이면 false', () => {
    expect(store.addResident('나비')).toBe(true);
    expect(store.addResident('나비')).toBe(false);
    expect(store.get().residents).toEqual(['나비']);
  });

  it('addJamo도 동일하게 중복 방지', () => {
    expect(store.addJamo('ㄱ')).toBe(true);
    expect(store.addJamo('ㄱ')).toBe(false);
    expect(store.get().jamo).toEqual(['ㄱ']);
  });
});

describe('영속성 · 초기화', () => {
  it('저장 후 localStorage에 반영, reset은 기본값 복원', () => {
    store.setSound(false);
    store.setStars('meadow', 0, 3);
    expect(JSON.parse(localStorage.getItem('nuri-hangul-kingdom-v1')).stars.meadow[0]).toBe(3);
    store.reset();
    expect(store.get().sound).toBe(true);
    expect(store.get().stars.meadow[0]).toBe(-1);
    expect(store.get().residents).toEqual([]);
  });
});
