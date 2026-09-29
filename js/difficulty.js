// 난이도 규칙 — 별 계산과 보스전 에너지를 한곳에 둔다.
//
// 설정의 '다음 단계 조건'(최소 별 1~3개)이 두 가지를 정한다:
//   1) 다음 스테이지로 가는 데 필요한 별 (store.stagePassed)
//   2) 보스전에서 누리·포리의 에너지 — 틀릴 때마다 1씩 줄고 0이 되면 실패한다
// 에너지는 '이만큼 틀리면 목표 별을 더는 받을 수 없다'는 지점에서 바닥나게 맞춘다.
// 그래서 별 규칙(starsFor)을 바꾸면 heroEnergy 도 같이 따라가야 한다(tests/difficulty.test.js).

/**
 * 실수 횟수 → 별. 유아 대상이라 관대하게(노력·완주 보상):
 * 실수 0~1 → 3개, 2~4 → 2개, 그 이상 → 1개.
 * @param {number} mistakes @returns {number}
 */
export function starsFor(mistakes) {
  return mistakes <= 1 ? 3 : mistakes <= 4 ? 2 : 1;
}

/** 별 1개 조건은 원래 실패가 없었다 — 에너지를 넉넉히 준다 */
const EASY_ENERGY = 8;

/**
 * 보스전 누리·포리 에너지(하트 수).
 * 별 N개 조건이면 '별 N개를 받을 수 있는 최대 실수 + 1' — 그 실수를 하는 순간 0이 된다.
 * @param {number} minStars 1~3 @returns {number}
 */
export function heroEnergy(minStars) {
  if (minStars <= 1) return EASY_ENERGY;
  let allowed = 0;
  while (starsFor(allowed + 1) >= minStars) allowed++;
  return allowed + 1;
}
