// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
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

describe('난이도 — 다음 단계 조건(최소 별)', () => {
  it('기본값은 별 1개 — 끝내기만 하면 통과', () => {
    expect(store.minStars()).toBe(1);
    store.setStars('meadow', 0, 1);
    expect(store.stagePassed('meadow', 0)).toBe(true);
    expect(store.stageUnlocked('meadow', 1)).toBe(true);
  });

  it('최소 별 3개면 별 2개로는 다음 스테이지가 열리지 않는다', () => {
    store.setMinStars(3);
    store.setStars('meadow', 0, 2);
    expect(store.stagePassed('meadow', 0)).toBe(false);
    expect(store.stageUnlocked('meadow', 1)).toBe(false);
    store.setStars('meadow', 0, 3);
    expect(store.stageUnlocked('meadow', 1)).toBe(true);
  });

  it('최고 기록 기준 — 이미 넘은 단계는 다시 해서 별이 적어도 막히지 않는다', () => {
    store.setMinStars(2);
    store.setStars('meadow', 0, 3);
    store.setStars('meadow', 0, 1); // 낮은 점수는 기록되지 않는다
    expect(store.stagePassed('meadow', 0)).toBe(true);
  });

  it('왕국 클리어·다음 왕국 열림도 최소 별을 따른다', () => {
    store.setMinStars(2);
    for (let i = 0; i < 4; i++) store.setStars('meadow', i, 2);
    store.setStars('meadow', 4, 1); // 마지막 스테이지가 1개라 아직 클리어가 아니다
    expect(store.kingdomCleared('meadow')).toBe(false);
    expect(store.kingdomUnlocked('lake')).toBe(false);
    store.setStars('meadow', 4, 2);
    expect(store.kingdomCleared('meadow')).toBe(true);
    expect(store.kingdomUnlocked('lake')).toBe(true);
  });

  it('설정값은 1~3 으로 맞추고, 저장 후 다시 읽어도 유지된다', () => {
    store.setMinStars(5);
    expect(store.minStars()).toBe(3);
    store.setMinStars(0);
    expect(store.minStars()).toBe(1);
    store.setMinStars(2);
    expect(JSON.parse(localStorage.getItem('nuri-hangul-kingdom-v1')).minStars).toBe(2);
  });

  it('초기화하면 기본값(1)으로 돌아간다', () => {
    store.setMinStars(3);
    store.reset();
    expect(store.minStars()).toBe(1);
  });
});

describe('통과 기록 — 난이도를 올려도 이미 넘은 단계는 잠기지 않는다', () => {
  it('별 1개로 넘은 왕국은 난이도를 3으로 올려도 클리어·다음 왕국 열림이 유지된다', () => {
    for (let i = 0; i < 5; i++) store.setStars('meadow', i, 1);
    store.setMinStars(3);
    expect(store.stagePassed('meadow', 0)).toBe(true);
    expect(store.stageUnlocked('meadow', 4)).toBe(true);
    expect(store.kingdomCleared('meadow')).toBe(true);
    expect(store.kingdomUnlocked('lake')).toBe(true);
  });

  it('올린 뒤에 새로 한 단계는 새 기준을 따른다', () => {
    store.setMinStars(2);
    store.setStars('lake', 0, 1);
    expect(store.stagePassed('lake', 0)).toBe(false);
    expect(store.stageUnlocked('lake', 1)).toBe(false);
    store.setStars('lake', 0, 2);
    expect(store.stagePassed('lake', 0)).toBe(true);
  });

  it('난이도를 내리면 그 기준으로 곧바로 열린다', () => {
    store.setMinStars(3);
    store.setStars('lake', 0, 2);
    expect(store.stagePassed('lake', 0)).toBe(false);
    store.setMinStars(2);
    expect(store.stagePassed('lake', 0)).toBe(true);
  });

  it('통과 기록이 없던 예전 저장 데이터는 별 1개 이상을 통과로 옮긴다', async () => {
    localStorage.setItem('nuri-hangul-kingdom-v1', JSON.stringify({
      minStars: 2,
      stars: { meadow: [1, 3, -1, -1, -1] },
    }));
    vi.resetModules();
    const { store: fresh } = await import('../js/store.js');
    expect(fresh.get().passed.meadow).toEqual([true, true, false, false, false]);
    expect(fresh.stageUnlocked('meadow', 2)).toBe(true);
    expect(fresh.stageUnlocked('meadow', 3)).toBe(false);
  });

  it('초기화하면 통과 기록도 지워진다', () => {
    store.setStars('meadow', 0, 3);
    store.reset();
    expect(store.stagePassed('meadow', 0)).toBe(false);
  });
});
