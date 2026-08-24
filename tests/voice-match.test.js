import { describe, expect, it } from 'vitest';

import {
  alignSequential,
  bestMatch,
  containment,
  durationFit,
  fillOrderedGaps,
  idFromFileName,
  normalize,
  similarity,
} from '../tools/match-recorded-voice.mjs';

const LINES = [
  { id: 'ui/welcome', text: '누리의 한글 왕국에 온 것을 환영해요!' },
  { id: 'praise/correct-01', text: '딩동댕! 잘 찾았어요!' },
  { id: 'praise/correct-03', text: '맞아요! 멋져요!' },
  { id: 'jamo/미음', text: '미음' },
  { id: 'dex/jamo/미음', text: '미음! 모자의 모.' },
  { id: 'words/모자', text: '모자' },
];

describe('normalize', () => {
  it('구두점·공백·이모지를 털어 낸다', () => {
    expect(normalize('와! 글자들이 모두 돌아왔어요! 🎉')).toBe('와글자들이모두돌아왔어요');
  });
});

describe('similarity', () => {
  it('같은 문장은 1', () => {
    expect(similarity('딩동댕! 잘 찾았어요!', '딩동댕 잘 찾았어요')).toBe(1);
  });

  it('음성 인식이 구두점을 다르게 붙여도 높게 나온다', () => {
    expect(similarity('미음 모자의 모', '미음! 모자의 모.')).toBeGreaterThan(0.9);
  });

  it('다른 문장은 낮게 나온다', () => {
    expect(similarity('맞아요 멋져요', '누리의 한글 왕국에 온 것을 환영해요')).toBeLessThan(0.3);
  });
});

describe('bestMatch', () => {
  it('인식 결과와 가장 비슷한 대사를 고른다', () => {
    const match = bestMatch('누리의 한글 왕국에 온 것을 환영해요', LINES);
    expect(match.line.id).toBe('ui/welcome');
    expect(match.score).toBeGreaterThan(0.9);
  });

  it('짧은 대사도 구분한다 — 자모 이름 단독 vs 도감 설명', () => {
    expect(bestMatch('미음', LINES).line.id).toBe('jamo/미음');
    expect(bestMatch('미음 모자의 모', LINES).line.id).toBe('dex/jamo/미음');
  });

  it('2등 점수도 함께 돌려줘 애매한 경우를 걸러낼 수 있다', () => {
    const match = bestMatch('맞아요 멋져요', LINES);
    expect(match.line.id).toBe('praise/correct-03');
    expect(match.runnerUp).toBeLessThan(match.score);
  });
});

describe('idFromFileName', () => {
  it('대본에 표시된 파일 이름에서 id를 뽑는다', () => {
    expect(idFromFileName('ui:welcome.mp3.m4a')).toBe('ui/welcome');
    expect(idFromFileName('dex:jamo:ko-21cff49381.m4a')).toBe('dex/jamo/ko-21cff49381');
  });

  it('의미 없는 다운로드 이름은 대사 id와 맞지 않는다(→ 음성 인식으로 넘어간다)', () => {
    expect(idFromFileName('녹음 12.m4a')).toBe('녹음 12');
    expect(idFromFileName('recording (3).wav')).toBe('recording (3)');
  });
});

describe('containment · durationFit', () => {
  it('인식기가 앞부분을 흘려도 대사 안에 들어 있으면 높게 본다', () => {
    expect(containment('가방에 가', '기역! 가방의 가.')).toBeGreaterThan(0.7);
  });

  it('길이가 크게 어긋나면 점수를 깎는다 — 짧은 낱말이 긴 문장을 가로채지 못하게', () => {
    expect(durationFit(2500, '가방')).toBeLessThan(0.6);
    expect(durationFit(2500, '기역! 가방의 가.')).toBeGreaterThan(0.7);
  });

  it('길이를 모르면 점수에 영향을 주지 않는다', () => {
    expect(durationFit(0, '가방')).toBe(1);
  });
});

describe('alignSequential', () => {
  it('대본 순서대로 녹음한 파일들을 차례로 붙인다', () => {
    const scores = [
      [0.9, 0.4, 0.3],
      [0.3, 0.8, 0.4],
      [0.2, 0.3, 0.85],
    ];
    expect(alignSequential(scores)).toEqual([0, 1, 2]);
  });

  it('건너뛴 대사가 있어도 순서를 유지한다', () => {
    const scores = [
      [0.9, 0.3, 0.3],
      [0.3, 0.3, 0.9],
    ];
    expect(alignSequential(scores)).toEqual([0, 2]);
  });

  it('점수가 너무 낮은 파일은 배치하지 않는다', () => {
    expect(alignSequential([[0.1, 0.1]])).toEqual([-1]);
  });

  it('1등과 2등이 붙으면(소리로 못 가리면) 배치하지 않는다 — 틀리느니 보류', () => {
    const scores = [
      [0.7, 0.68],
      [0.68, 0.7],
    ];
    expect(alignSequential(scores)).toEqual([-1, -1]);
  });

  it('순서를 벗어난 파일 하나 때문에 전체가 밀리지 않는다', () => {
    // 두 번째 파일이 뒤쪽 대사(3번)인데 세 번째 파일은 다시 앞쪽(2번) — 어긋난 쪽만 버린다
    const scores = [
      [0.9, 0.2, 0.2, 0.2],
      [0.2, 0.2, 0.2, 0.9],
      [0.2, 0.9, 0.2, 0.2],
      [0.2, 0.2, 0.9, 0.2],
    ];
    const aligned = alignSequential(scores);
    expect(aligned[0]).toBe(0);
    expect(aligned[2]).toBe(1);
    expect(aligned[3]).toBe(2);
    expect(aligned[1]).toBe(-1); // 순서를 어긴 파일만 보류
  });
});

describe('fillOrderedGaps', () => {
  it('확정된 두 파일 사이에 파일 수와 대사 수가 같으면 자리로 채운다', () => {
    expect(fillOrderedGaps([0, -1, 2])).toEqual([0, 1, 2]);
    expect(fillOrderedGaps([3, -1, -1, 6])).toEqual([3, 4, 5, 6]);
  });

  it('수가 맞지 않으면 채우지 않는다 — 잘못 끼워 넣는 것보다 보류가 낫다', () => {
    expect(fillOrderedGaps([0, -1, 5])).toEqual([0, -1, 5]);
    expect(fillOrderedGaps([-1, 2, -1])).toEqual([-1, 2, -1]);
  });
});
