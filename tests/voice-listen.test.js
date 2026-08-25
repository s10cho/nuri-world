import { describe, expect, it } from 'vitest';

import { LISTEN, classify, fold, scoreLine } from '../tools/listen-voice-lines.mjs';

/** 받아쓴 말이 어느 대사에 가장 가까운지 (도구가 교차 검사에 쓰는 것과 같은 방식) */
function bestOther(heard, own, texts) {
  let best = null;
  for (const text of texts) {
    if (text === own) continue;
    const score = scoreLine(heard, text, { lenient: false });
    if (!best || score > best.score) best = { text, score };
  }
  return best;
}

const TEXTS = [
  '얘! 얘기의 얘 소리예요.', '얘기', '얘들아',
  '다! 다리의 다.', '다리', '다',
  '피읖! 포도의 포.', '포도',
  '웨! 스웨터의 웨 소리예요.', '스웨터',
  '오', '우',
];

describe('fold', () => {
  it('한국어에서 합쳐진 소리를 하나로 본다', () => {
    expect(fold('외')).toBe(fold('웨'));
    expect(fold('에')).toBe(fold('애'));
    expect(fold('예')).toBe(fold('얘'));
  });

  it('소유격 의는 에로 소리 나는 것을 인정한다', () => {
    expect(fold('포도의 포')).toBe(fold('포도에 포'));
  });

  it('자모 의 한 글자는 그대로 둔다 — 에·애와 뒤바뀐 것을 잡아야 한다', () => {
    expect(fold('의')).not.toBe(fold('에'));
  });
});

describe('scoreLine', () => {
  it('구두점만 다른 짧은 대사를 맞다고 본다', () => {
    expect(scoreLine('코.', '코')).toBeGreaterThan(0.9);
  });

  it('인식기가 자모 이름을 뭉개도 나머지가 맞으면 살린다', () => {
    expect(scoreLine('피읍 포도에 포', '피읖! 포도의 포.')).toBeGreaterThan(LISTEN.minScore);
    expect(scoreLine('다, 다리기에 다', '다! 다리의 다.')).toBeGreaterThan(LISTEN.minScore);
  });

  it('lenient 를 끄면 짧은 대사에 후한 점수를 주지 않는다', () => {
    // 이 보정을 켠 채로 교차 비교를 하면 "다리"가 "다! 다리의 다."를 이겨 버린다
    expect(scoreLine('다, 다리기에 다', '다리', { lenient: false })).toBeLessThan(0.6);
    expect(scoreLine('다, 다리기에 다', '다리')).toBeGreaterThan(0.9);
  });

  it('아예 다른 말은 낮게 준다', () => {
    expect(scoreLine('얘기', '얘! 얘기의 얘 소리예요.')).toBeLessThan(LISTEN.minScore);
  });
});

describe('classify', () => {
  const judge = (heard, text) =>
    classify({ heard, text, decoded: true }, bestOther(heard, text, TEXTS));

  it('대사와 맞으면 ok', () => {
    expect(judge('얘! 얘기의 얘 소리예요.', '얘! 얘기의 얘 소리예요.').verdict).toBe('ok');
    expect(judge('피읍 포도에 포', '피읖! 포도의 포.').verdict).toBe('ok');
  });

  it('낱말 녹음이 문장 자리에 들어가 있으면 뒤바뀜으로 잡는다', () => {
    // 실제로 있었던 사고: jamo-intro/얘 자리에 낱말 "얘기" 녹음이 들어가 있었다
    const got = judge('얘기', '얘! 얘기의 얘 소리예요.');
    expect(got.verdict).toBe('swapped');
  });

  it('멀쩡한 도감 문장을 뒤바뀜으로 잡지 않는다', () => {
    expect(judge('다, 다리기에 다', '다! 다리의 다.').verdict).toBe('ok');
    expect(judge('왜 스웨터에 왜 소리예요', '웨! 스웨터의 웨 소리예요.').verdict).toBe('ok');
  });

  it('한 글자짜리는 뒤바뀜으로 단정하지 않고 보류한다', () => {
    // 이 화자의 '오'를 인식기가 늘 "우"로 받아쓴다 — 뒤바뀌었든 아니든 결과가 같다
    expect(judge('우', '오').verdict).toBe('short');
  });

  it('짧은 대사를 흘려 들은 것은 의심이 아니라 보류', () => {
    expect(judge('골에', '고래').verdict).toBe('short');
  });

  it('글자를 하나도 못 알아들으면 판정 불가', () => {
    expect(judge('- - - - - -', '키읔! 명중이에요!').verdict).toBe('unclear');
  });

  it('오디오를 못 읽으면 fail', () => {
    expect(classify({ heard: '', text: '유', decoded: false }, null).verdict).toBe('fail');
  });
});
