// 스테이지 결과 — 별과 노력 칭찬
import { register, go } from '../app.js';
import { el, fxConfetti, sleep } from '../ui.js';
import { store } from '../store.js';
import { speak, sfx } from '../audio.js';
import { KINGDOMS, CHARACTERS } from '../data.js';

// 노력 지향 칭찬 (능력 칭찬보다 학습 동기에 효과적)
const PRAISE = {
  3: ['처음부터 끝까지 정말 열심히 했어요! 완벽해요!', '한 번도 틀리지 않았어요! 최고예요!'],
  2: ['포기하지 않고 끝까지 해냈어요! 멋져요!', '열심히 노력하는 모습이 정말 멋졌어요!'],
  1: ['어려웠지만 끝까지 도전했어요! 대단해요!', '조금씩 계속 연습하면 더 잘하게 될 거예요!'],
};

function render({ kingdom, stageIdx, stars }) {
  const k = KINGDOMS[kingdom];
  const s = el('div', { style: { backgroundImage: `url(${k.bg})` } });

  const starEls = [0, 1, 2].map(() => el('span', { class: 's' }, '⭐'));
  const isLastStage = stageIdx === k.stages.length - 1;
  const kingdomJustCleared = store.kingdomCleared(kingdom);
  const isBoss = k.type === 'boss';

  const praise = PRAISE[stars][Math.floor(Math.random() * PRAISE[stars].length)];

  const nextBtn = isBoss
    ? el('button', { class: 'btn-big', onclick: () => { sfx('fanfare'); go('festival'); } }, '🎉 왕국 축제로!')
    : isLastStage && kingdomJustCleared
      ? el('button', { class: 'btn-big', onclick: () => { sfx('tap'); go('map'); } }, '🗺️ 다음 왕국으로!')
      : el('button', {
          class: 'btn-big',
          onclick: () => { sfx('tap'); go('stage', { kingdom, stageIdx: Math.min(stageIdx + 1, k.stages.length - 1) }); },
        }, '▶ 다음 스테이지');

  s.append(
    el('div', { class: 'scrim' }),
    el('div', { class: 'center-col' },
      el('div', { class: 'panel', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px', textAlign: 'center', maxWidth: 'min(92vw, 640px)' } },
        el('div', { class: 'sign' }, `${k.stages[stageIdx].title} 완료!`),
        el('div', { class: 'result-stars' }, starEls),
        el('div', { style: { fontSize: 'clamp(1.15rem, 2.8vmin, 1.6rem)', lineHeight: '1.5' } }, praise),
        el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' } },
          el('button', { class: 'btn-big secondary', onclick: () => { sfx('tap'); go('stage', { kingdom, stageIdx }); } }, '🔄 다시 하기'),
          nextBtn,
        ),
      ),
    ),
    el('img', { class: 'char enter', src: CHARACTERS.nuri, alt: '누리', style: { left: '3%', height: 'clamp(140px, 30vmin, 330px)' } }),
    el('img', { class: 'char enter', src: CHARACTERS.pori, alt: '포리', style: { right: '3%', height: 'clamp(110px, 24vmin, 260px)' } }),
  );

  s._onShow = async signal => {
    fxConfetti(stars * 18);
    sfx('fanfare');
    for (let i = 0; i < stars; i++) {
      await sleep(450, signal);
      if (signal.aborted) return; // '다음 스테이지' 등으로 이미 이탈했으면 연출 중단
      starEls[i].classList.add('on');
      sfx('star');
    }
    if (signal.aborted) return;
    await speak(praise, { signal });
  };

  return s;
}

register('result', render);
