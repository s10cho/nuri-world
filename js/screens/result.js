// 스테이지 결과 — 별과 노력 칭찬
import { register, go } from '../app.js';
import { el, fxConfetti, sleep } from '../ui.js';
import { store } from '../store.js';
import { speak, sfx } from '../audio.js';
import { KINGDOMS, CELEBRATIONS, CHARACTERS } from '../data.js';

// 노력 지향 칭찬 (능력 칭찬보다 학습 동기에 효과적)
/** @type {Record<number, string[]>} */
const PRAISE = {
  3: ['처음부터 끝까지 정말 열심히 했어요! 완벽해요!', '한 번도 틀리지 않았어요! 최고예요!'],
  2: ['포기하지 않고 끝까지 해냈어요! 멋져요!', '열심히 노력하는 모습이 정말 멋졌어요!'],
  1: ['어려웠지만 끝까지 도전했어요! 대단해요!', '조금씩 계속 연습하면 더 잘하게 될 거예요!'],
};

// 다음 프레임의 페인트가 끝날 때까지 기다린다(rAF 두 번 = 한 프레임 그린 뒤).
/** @returns {Promise<void>} */
function afterPaint() {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

/**
 * 응원 장면 — 통과하지 못했을 때는 기뻐하는 축하 그림 대신, 서 있는 누리·포리가
 * "할 수 있어!" 하고 응원한다(축하 그림은 통과했을 때만).
 * @param {string} line 말풍선 문구
 * @returns {HTMLElement}
 */
function encourageScene(line) {
  return el('div', { class: 'encourage-hero enter', role: 'img', 'aria-label': '누리와 포리가 응원해요' },
    el('img', { class: 'nuri', src: CHARACTERS.nuri, alt: '' }),
    el('img', { class: 'pori', src: CHARACTERS.pori, alt: '' }),
    el('div', { class: 'cheer-bubble' }, line),
  );
}

/**
 * 결과 그림이 디코드되고 한 프레임 그려질 때까지 — 꽃가루가 도중에 끊기지 않게(아래 _onShow)
 * @param {HTMLElement} hero @returns {Promise<void>}
 */
function heroPainted(hero) {
  const imgs = hero instanceof HTMLImageElement ? [hero] : [...hero.querySelectorAll('img')];
  return Promise.all(imgs.map(i => Promise.resolve(i.decode?.()).catch(() => {}))).then(afterPaint);
}

// 보스전 실패(에너지 소진) 때의 격려 — 녹음이 있는 문장만 쓴다(없는 문장은 기기 TTS 로 떨어진다)
const FAIL_CHEER = '조금씩 계속 연습하면 더 잘하게 될 거예요!';

/** @param {{ kingdom: KingdomId, stageIdx: number, stars: number, failed?: boolean }} params */
function render({ kingdom, stageIdx, stars, failed = false }) {
  if (failed) return renderFailed({ kingdom, stageIdx });
  const k = KINGDOMS[kingdom];
  const s = /** @type {AppScreen} */ (el('div', { style: { backgroundImage: `url(${k.bg})` } }));

  const starEls = [0, 1, 2].map(() => el('span', { class: 's' }, '⭐'));
  const isLastStage = stageIdx === k.stages.length - 1;
  const kingdomJustCleared = store.kingdomCleared(kingdom);
  const isBoss = k.type === 'boss';

  const praise = PRAISE[stars][Math.floor(Math.random() * PRAISE[stars].length)];
  // 누리·포리가 함께 기뻐하는 축하 일러스트 (매번 다르게 랜덤)
  const celebration = CELEBRATIONS[Math.floor(Math.random() * CELEBRATIONS.length)];

  // 난이도(설정의 '다음 단계 조건') — 이 스테이지 최고 기록이 최소 별에 못 미치면 앞으로 못 간다.
  // 왕국 화면·지도의 잠금도 같은 store.stagePassed 를 쓰므로 돌아가서 우회할 수 없다.
  const need = store.minStars();
  const passed = store.stagePassed(kingdom, stageIdx);

  const nextBtn = !passed
    ? el('button', { class: 'btn-big next-locked', disabled: 'true' }, `🔒 ${'⭐'.repeat(need)} 모으면 열려요`)
    : isBoss
      ? el('button', { class: 'btn-big', onclick: () => { sfx('fanfare'); go('festival'); } }, '🎉 왕국 축제로!')
      : isLastStage && kingdomJustCleared
        ? el('button', { class: 'btn-big', onclick: () => { sfx('tap'); go('map'); } }, '🗺️ 다음 왕국으로!')
        : el('button', {
            class: 'btn-big',
            onclick: () => { sfx('tap'); go('stage', { kingdom, stageIdx: Math.min(stageIdx + 1, k.stages.length - 1) }); },
          }, '▶ 다음 스테이지');
  // 못 넘었으면 '다시 하기'가 주 버튼이 된다
  const retryBtn = el('button', {
    class: passed ? 'btn-big secondary' : 'btn-big retry-main',
    onclick: () => { sfx('tap'); go('stage', { kingdom, stageIdx }); },
  }, '🔄 다시 하기');

  // 축하 일러스트는 1024px PNG 라 디코드·GPU 업로드 비용이 크다. 이 작업이 꽃가루 낙하
  // 도중에 끼어들면 합성 프레임이 한 번 밀려, 꽃가루가 내려오다 툭 멈췄다 이어지는 것처럼
  // 보였다. 미리 디코드하고 한 번 그려 둔 뒤에 꽃가루를 뿌린다(아래 _onShow).
  const hero = passed
    ? el('img', { class: 'celebrate-hero enter', src: celebration, alt: '누리와 포리가 축하해요' })
    : encourageScene('할 수 있어! 💪');

  s.append(
    el('div', { class: 'scrim' }),
    el('div', { class: 'center-col result-col' },
      hero,
      el('div', { class: 'panel result-panel' },
        el('div', { class: 'sign' }, `${k.stages[stageIdx].title} 완료!`),
        el('div', { class: 'result-stars' }, starEls),
        el('div', { style: { fontSize: 'clamp(1.15rem, 2.8vmin, 1.6rem)', lineHeight: '1.5' } }, praise),
        passed ? null : el('div', { class: 'need-stars' }, `별 ${need}개를 모으면 다음으로 갈 수 있어요. 다시 도전해 볼까요?`),
        el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' } },
          retryBtn,
          nextBtn,
        ),
      ),
    ),
  );

  // 이미지 디코드 + 두 프레임(첫 페인트까지) 대기. 어느 쪽이든 300ms 안에는 넘어가
  // 연출이 늦어지지 않게 상한을 둔다.
  const heroReady = Promise.race([heroPainted(hero), sleep(300)]);

  s._onShow = async signal => {
    sfx('fanfare');
    await heroReady;
    if (signal.aborted) return;
    fxConfetti(stars * 18);
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

/**
 * 보스전 실패 — 누리·포리 에너지가 바닥났다. 별은 기록하지 않았다(stage.js).
 * 실패를 탓하지 않고 다시 도전을 권한다: 축하 연출 없이 '다시 하기'를 주 버튼으로.
 * @param {{ kingdom: KingdomId, stageIdx: number }} params
 */
function renderFailed({ kingdom, stageIdx }) {
  const k = KINGDOMS[kingdom];
  const s = /** @type {AppScreen} */ (el('div', { style: { backgroundImage: `url(${k.bg})` } }));
  s.append(
    el('div', { class: 'scrim' }),
    el('div', { class: 'center-col result-col' },
      encourageScene('다시 해 보자! 💖'),
      el('div', { class: 'panel result-panel' },
        el('div', { class: 'sign' }, '에너지가 다 떨어졌어요'),
        el('div', { style: { fontSize: 'clamp(1.15rem, 2.8vmin, 1.6rem)', lineHeight: '1.5' } }, FAIL_CHEER),
        el('div', { class: 'need-stars' }, '💖 에너지를 채워서 다시 도전해 볼까요?'),
        el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' } },
          el('button', { class: 'btn-big secondary', onclick: () => { sfx('tap'); go('map'); } }, '🗺️ 지도로'),
          el('button', { class: 'btn-big retry-main', onclick: () => { sfx('tap'); go('stage', { kingdom, stageIdx }); } }, '🔄 다시 하기'),
        ),
      ),
    ),
  );
  s._onShow = async signal => {
    sfx('flip');
    await sleep(400, signal);
    if (signal.aborted) return;
    await speak(FAIL_CHEER, { signal });
  };
  return s;
}

register('result', render);
