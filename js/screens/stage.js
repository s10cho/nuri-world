// 스테이지 실행 엔진 — 왕국 유형별 활동(배우기 → 게임들)을 순서대로 진행
import { register, go } from '../app.js';
import { el, topbar, iconBtn } from '../ui.js';
import { store } from '../store.js';
import { sfx } from '../audio.js';
import { KINGDOMS } from '../data.js';

import { runLearn } from '../games/learn.js';
import { runListen } from '../games/listen.js';
import { runMatch } from '../games/match.js';
import { runBuild } from '../games/build.js';
import { runWord } from '../games/word.js';
import { runBoss } from '../games/boss.js';

/** @typedef {(ctx: GameContext) => Promise<GameResult>} Activity */

// 왕국 유형별 활동 시퀀스 구성. k.type으로 왕국을 좁히면 k.stages도 대응 형태로
// 좁혀져 stage 필드(jamo/targets/words)에 안전하게 접근할 수 있다(판별 유니온).
/**
 * @param {Kingdom} k
 * @param {number} stageIdx
 * @returns {Activity[]}
 */
function buildActivities(k, stageIdx) {
  if (k.type === 'jamo') {
    const stage = k.stages[stageIdx];
    const pool = [...new Set([...stage.jamo, ...(stage.review || [])])];
    /** @type {Activity[]} */
    const acts = [
      ctx => runLearn(ctx, { jamoList: stage.jamo }),
      ctx => runListen(ctx, { pool, focus: stage.jamo, rounds: Math.min(4, Math.max(3, stage.jamo.length)) }),
    ];
    // 짝 맞추기는 글자 2개 이상일 때만
    const pairs = (stage.review && stage.review.length >= 4 ? stage.review : stage.jamo);
    if (pairs.length >= 2) acts.push(ctx => runMatch(ctx, { jamoList: pairs }));
    return acts;
  }
  if (k.type === 'tower') {
    const stage = k.stages[stageIdx];
    return [ctx => runBuild(ctx, { targets: stage.targets })];
  }
  if (k.type === 'village') {
    const stage = k.stages[stageIdx];
    return [ctx => runWord(ctx, { words: stage.words })];
  }
  // boss (남은 유일한 유형)
  return [ctx => runBoss(ctx, {})];
}

/** @param {{ kingdom: KingdomId, stageIdx: number }} params */
function render({ kingdom, stageIdx }) {
  const k = KINGDOMS[kingdom];
  const stage = k.stages[stageIdx];
  const s = /** @type {AppScreen} */ (el('div', { style: { backgroundImage: `url(${k.bg})` } }));

  const activities = buildActivities(k, stageIdx);

  const dots = el('div', { class: 'round-dots' },
    activities.map((_, i) => el('span', { class: 'dot' + (i === 0 ? ' now' : '') })),
  );

  const area = el('div', { class: 'game-area' });

  s.append(
    el('div', { class: 'scrim' }),
    topbar({
      left: [iconBtn('◀', '나가기', () => { sfx('tap'); go(kingdom === 'castle' ? 'map' : 'kingdom', { kingdom }); })],
      right: [el('div', { class: 'ribbon', style: { alignSelf: 'center' } }, `${stage.title}`)],
    }),
    el('div', { style: { display: 'flex', justifyContent: 'center', position: 'relative', zIndex: '2', paddingTop: '4px' } }, dots),
    area,
  );

  s._onShow = async signal => {
    let mistakes = 0;
    for (let i = 0; i < activities.length; i++) {
      dots.querySelectorAll('.dot').forEach((d, j) => {
        d.classList.toggle('now', j === i);
        d.classList.toggle('done', j < i);
      });
      area.replaceChildren();
      // 화면을 이탈했으면(signal abort) 진행 중단
      if (signal.aborted) return;
      const result = await activities[i]({ area, kingdom, stage, signal });
      if (signal.aborted) return;
      mistakes += result?.mistakes || 0;
    }

    // 이탈 후 게임 Promise가 뒤늦게 resolve된 경우 별점 기록·화면 이동을 하지 않음
    if (signal.aborted) return;

    // 별점: 유아 대상이라 관대하게(노력·완주 보상) — 실수 0~1 → 3개, 2~4 → 2개, 그 이상 → 1개.
    // 짝 맞추기 등 기억 게임의 뒤집기 실수까지 포함되므로 문턱을 넉넉히 둔다.
    const stars = mistakes <= 1 ? 3 : mistakes <= 4 ? 2 : 1;
    store.setStars(kingdom, stageIdx, stars);

    go('result', { kingdom, stageIdx, stars });
  };

  return s;
}

register('stage', render);
