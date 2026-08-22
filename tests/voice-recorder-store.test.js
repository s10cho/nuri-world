import { describe, expect, it } from 'vitest';

import { applyToManifest, extForMime, isRiskyExt, RECORDING_EXTS, voiceKey } from '../tools/voice-recorder-store.mjs';

describe('extForMime', () => {
  it('Safari의 audio/mp4는 그대로 m4a로 저장한다', () => {
    expect(extForMime('audio/mp4')).toBe('.m4a');
    expect(extForMime('audio/mp4;codecs=mp4a.40.2')).toBe('.m4a');
  });

  it('Chrome의 webm/opus는 webm으로 받는다(서버에서 m4a로 변환 시도)', () => {
    expect(extForMime('audio/webm;codecs=opus')).toBe('.webm');
  });

  it('알 수 없는 MIME은 webm으로 떨어뜨린다', () => {
    expect(extForMime('')).toBe('.webm');
    expect(extForMime(undefined)).toBe('.webm');
  });

  it('iOS에서 못 읽는 컨테이너만 위험으로 표시한다', () => {
    expect(isRiskyExt('.webm')).toBe(true);
    expect(isRiskyExt('.ogg')).toBe(true);
    expect(isRiskyExt('.m4a')).toBe(false);
  });
});

describe('RECORDING_EXTS', () => {
  it('TTS 생성본(.mp3)은 녹음 확장자 목록에 없어 삭제 대상이 되지 않는다', () => {
    expect(RECORDING_EXTS).not.toContain('.mp3');
    expect(RECORDING_EXTS).toContain('.mp3.m4a'); // 초기 수동 반입본
  });
});

describe('applyToManifest', () => {
  const base = {
    format: 'mp3',
    count: 1,
    recorded: 0,
    assets: { '안녕': { id: 'ui/hi', src: 'assets/audio/ko/ui/hi.mp3', bytes: 10 } },
  };

  it('녹음본이 같은 대사 키의 TTS 항목을 대체한다', () => {
    const next = applyToManifest(base, '안녕', { id: 'ui/hi', src: 'assets/audio/ko/ui/hi.m4a', bytes: 99 }, 1);
    expect(next.assets['안녕'].src).toBe('assets/audio/ko/ui/hi.m4a');
    expect(next.count).toBe(1);
    expect(next.recorded).toBe(1);
    expect(base.assets['안녕'].src).toBe('assets/audio/ko/ui/hi.mp3'); // 원본 불변
  });

  it('asset이 null이면 키를 지우고 개수를 다시 센다', () => {
    const next = applyToManifest(base, '안녕', null, 0);
    expect(next.assets['안녕']).toBeUndefined();
    expect(next.count).toBe(0);
  });

  it('manifest 키는 js/audio.js와 같은 방식으로 정규화한다', () => {
    expect(voiceKey('  안녕   하세요 ')).toBe('안녕 하세요');
  });
});
