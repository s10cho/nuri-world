// 글자 별 모으기의 순수 로직 — 점수 계산과 출제
import { describe, it, expect } from 'vitest';
import {
  roundScore, buildPool, pickRound, TIME_LIMIT, PENALTY,
  MODES, findMode, spawnLetter, buildFindBoard, FIND_CELLS, FIND_TARGETS,
} from '../js/arena-rules.js';

describe('roundScore', () => {
  it('첫 정답은 기본 점수', () => {
    expect(roundScore(0)).toBe(10);
  });

  it('콤보가 쌓이면 점수가 커진다', () => {
    expect(roundScore(1)).toBe(15);
    expect(roundScore(3)).toBe(25);
  });

  it('콤보 보너스에는 상한이 있다 — 한 번 실수해도 만회할 수 있어야 한다', () => {
    expect(roundScore(5)).toBe(35);
    expect(roundScore(50)).toBe(35);
  });
});

describe('buildPool', () => {
  it('모은 글자만 출제 대상이 된다', () => {
    const pool = buildPool({ jamo: ['ㄱ', 'ㄴ'] });
    expect(pool.map(p => p.ch).sort()).toEqual(['ㄱ', 'ㄴ']);
  });

  it('아무것도 못 모았으면 비어 있다', () => {
    expect(buildPool({ jamo: [] })).toEqual([]);
  });

  it('출제 대사가 반드시 있다 — 없으면 소리 없는 문제가 된다', () => {
    const pool = buildPool({ jamo: ['ㄱ', 'ㅏ', '가'] });
    expect(pool.length).toBe(3);
    for (const item of pool) expect(item.line.length).toBeGreaterThan(0);
  });

  it('자모와 만든 글자를 함께 담는다', () => {
    const pool = buildPool({ jamo: ['ㄱ', '가'] });
    expect(pool.map(p => p.ch).sort()).toEqual(['가', 'ㄱ'].sort());
  });
});

describe('pickRound', () => {
  const pool = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ'].map(ch => ({ ch, line: ch }));

  it('보기 안에 정답이 들어 있다', () => {
    for (let i = 0; i < 30; i++) {
      const { target, options } = pickRound(pool);
      expect(options.map(o => o.ch)).toContain(target.ch);
    }
  });

  it('보기끼리 겹치지 않는다', () => {
    for (let i = 0; i < 30; i++) {
      const { options } = pickRound(pool);
      expect(new Set(options.map(o => o.ch)).size).toBe(options.length);
    }
  });

  it('풀이 보기 수보다 적으면 있는 만큼만 낸다', () => {
    const tiny = [{ ch: 'ㄱ', line: 'ㄱ' }, { ch: 'ㄴ', line: 'ㄴ' }];
    const { options } = pickRound(tiny);
    expect(options.length).toBe(2);
  });
});

describe('규칙 상수', () => {
  it('제한 시간과 감점이 합리적인 범위다', () => {
    expect(TIME_LIMIT).toBeGreaterThanOrEqual(30);
    expect(PENALTY).toBeGreaterThan(0);
    expect(PENALTY).toBeLessThan(TIME_LIMIT / 5);
  });
});

describe('놀이 종류', () => {
  it('종류마다 id 가 겹치지 않는다', () => {
    expect(new Set(MODES.map(m => m.id)).size).toBe(MODES.length);
  });

  it('소리 없이 즐길 수 있는 놀이가 최소 하나는 있다 — 조용한 곳·TTS 없는 기기 대비', () => {
    expect(MODES.some(m => !m.needsSound)).toBe(true);
  });

  it('모르는 id 는 첫 놀이로 떨어진다', () => {
    expect(findMode('없는거').id).toBe(MODES[0].id);
    expect(findMode('fall').id).toBe('fall');
  });
});

describe('spawnLetter (떨어지는 글자)', () => {
  const pool = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ'].map(ch => ({ ch, line: ch }));
  const target = pool[0];

  it('낮은 roll 에서는 목표 글자가 나온다 — 잡을 기회가 꾸준해야 한다', () => {
    expect(spawnLetter(pool, target, 0).ch).toBe('ㄱ');
    expect(spawnLetter(pool, target, 0.41).ch).toBe('ㄱ');
  });

  it('높은 roll 에서는 목표가 아닌 글자가 나온다', () => {
    for (const roll of [0.5, 0.7, 0.99]) {
      expect(spawnLetter(pool, target, roll).ch).not.toBe('ㄱ');
    }
  });

  it('풀에 목표뿐이면 목표를 낸다 (깨지지 않는다)', () => {
    expect(spawnLetter([target], target, 0.99).ch).toBe('ㄱ');
  });

  it('언제나 풀 안의 글자만 낸다', () => {
    for (let i = 0; i < 200; i++) {
      const got = spawnLetter(pool, target, i / 200);
      expect(pool.map(p => p.ch)).toContain(got.ch);
    }
  });
});

describe('buildFindBoard (같은 글자 모으기)', () => {
  const pool = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ'].map(ch => ({ ch, line: ch }));

  it('판에 정답이 여러 개 숨어 있다', () => {
    const { target, cells } = buildFindBoard(pool);
    expect(cells.filter(c => c.ch === target.ch).length).toBe(FIND_TARGETS);
  });

  it('칸 수를 지킨다', () => {
    expect(buildFindBoard(pool).cells.length).toBe(FIND_CELLS);
  });

  it('풀이 작아도 판이 깨지지 않는다', () => {
    const tiny = [{ ch: 'ㄱ', line: 'ㄱ' }, { ch: 'ㄴ', line: 'ㄴ' }];
    const { target, cells } = buildFindBoard(tiny);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.filter(c => c.ch === target.ch).length).toBeGreaterThanOrEqual(1);
  });

  it('정답이 하나도 없는 판은 만들지 않는다', () => {
    for (let i = 0; i < 30; i++) {
      const { target, cells } = buildFindBoard(pool);
      expect(cells.some(c => c.ch === target.ch)).toBe(true);
    }
  });
});
