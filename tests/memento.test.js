// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { coverCrop } from '../js/screens/memento.js';

describe('coverCrop — 카메라 화면을 네컷 칸 비율로 가운데 자르기', () => {
  it('가로로 긴 화면은 좌우를 잘라 높이를 다 쓴다', () => {
    const r = coverCrop(1280, 720, 393, 330);
    expect(r.sh).toBeCloseTo(720);
    expect(r.sy).toBeCloseTo(0);
    expect(r.sw / r.sh).toBeCloseTo(393 / 330);
    expect(r.sx).toBeCloseTo((1280 - r.sw) / 2);
  });

  it('세로로 긴 화면은 위아래를 잘라 너비를 다 쓴다', () => {
    const r = coverCrop(720, 1280, 393, 330);
    expect(r.sw).toBeCloseTo(720);
    expect(r.sx).toBeCloseTo(0);
    expect(r.sw / r.sh).toBeCloseTo(393 / 330);
    expect(r.sy).toBeCloseTo((1280 - r.sh) / 2);
  });

  it('비율이 같으면 자르지 않는다', () => {
    expect(coverCrop(786, 660, 393, 330)).toEqual({ sx: 0, sy: 0, sw: 786, sh: 660 });
  });

  it('잘라낸 영역은 원본을 벗어나지 않는다', () => {
    for (const [w, h] of [[640, 480], [1920, 1080], [480, 640], [1000, 1000]]) {
      const r = coverCrop(w, h, 393, 330);
      expect(r.sx).toBeGreaterThanOrEqual(0);
      expect(r.sy).toBeGreaterThanOrEqual(0);
      expect(r.sx + r.sw).toBeLessThanOrEqual(w + 1e-9);
      expect(r.sy + r.sh).toBeLessThanOrEqual(h + 1e-9);
    }
  });
});
