import { describe, expect, it } from 'vitest';

import { bestMatch, idFromFileName, normalize, similarity } from '../tools/match-recorded-voice.mjs';

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
