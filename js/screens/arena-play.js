// 글자 놀이 실행 화면 — 종류(mode)에 따라 다른 놀이를 돌린다.
//
// 공통 엔진이 시간·점수·콤보·결과를 맡고, 놀이마다 라운드 진행 방식만 다르다.
// 시간은 인터벌 횟수가 아니라 '실제 시계'로 잰다 — 배경 탭·절전에서 타이머가 느려지면
// 60초 놀이가 몇 배로 길어진다(실제로 겪었다).
//
// 떨어지는 글자는 CSS 애니메이션 대신 Web Animations API 를 쓴다.
// prefers-reduced-motion 전역 규칙이 CSS 애니메이션 시간을 0.01ms 로 만들어 버려
// 글자가 나타나자마자 사라지기 때문이다.
import { register, go } from '../app.js';
import { el, topbar, iconBtn, cardColor, fxBurstAt, fxConfetti, sleep } from '../ui.js';
import { store } from '../store.js';
import { speak, sfx, stopSpeech } from '../audio.js';
import {
  TIME_LIMIT, PENALTY, FALL_PENALTY, roundScore, buildPool, pickRound,
  spawnLetter, buildFindBoard, findMode,
} from '../arena-rules.js';

/** 글자 하나가 위에서 아래까지 내려오는 시간(ms) — 유아가 쫓아갈 수 있게 느리게 */
const FALL_MS = 5200;
/** 새 글자가 나오는 간격(ms) */
const SPAWN_MS = 780;

/** @param {{ mode?: string }} params */
function render({ mode = 'listen' }) {
  const info = findMode(mode);
  const pool = buildPool(store.get());

  const s = /** @type {AppScreen} */ (el('div', {
    style: { backgroundImage: 'url(assets/images/backgrounds/festival_ending.jpg)' },
  }));

  const scoreEl = el('span', { class: 'arena-score' }, '0');
  const comboEl = el('span', { class: 'arena-combo' }, '');
  const timeFill = el('div', { class: 'fill' });
  const area = el('div', { class: 'game-area' });

  s.append(
    el('div', { class: 'scrim' }),
    topbar({
      left: [iconBtn('🏠', '놀이 고르기', () => { sfx('tap'); go('arena'); })],
      right: [],
    }),
    el('div', { class: 'arena-hud' },
      el('div', { class: 'arena-time' }, timeFill),
      el('div', { class: 'arena-stat' }, el('span', {}, '⭐ '), scoreEl, comboEl),
    ),
    area,
  );

  s._onShow = async signal => {
    if (pool.length < 3) {
      area.append(el('div', { class: 'panel story-text festival-line' },
        '아직 모은 글자가 적어요. 도감을 채우고 다시 와 주세요!'));
      return;
    }

    let score = 0;
    let combo = 0;
    let over = false;
    const startedAt = Date.now();
    let penalty = 0;
    const remaining = () => TIME_LIMIT - (Date.now() - startedAt) / 1000 - penalty;

    const hud = () => {
      scoreEl.textContent = String(score);
      comboEl.textContent = combo >= 2 ? ` 🔥${combo}` : '';
    };

    /** 정답 처리 @param {HTMLElement} [node] 반짝임을 터뜨릴 자리 */
    const correct = node => {
      score += roundScore(combo);
      combo += 1;
      sfx('correct');
      if (node) fxBurstAt(node, ['⭐', '✨', '💛']);
      hud();
    };
    /**
     * 오답 처리 — 점수를 깎지 않고 시간을 줄인다(마이너스 점수는 아이를 위축시킨다)
     * @param {HTMLElement|undefined} node @param {number} sec
     */
    const wrong = (node, sec) => {
      combo = 0;
      penalty += sec;
      sfx('wrong');
      if (node) {
        node.classList.add('wrong');
        setTimeout(() => node.classList.remove('wrong'), 400);
      }
      hud();
    };

    const tick = setInterval(() => {
      if (signal.aborted) return;
      const left = remaining();
      timeFill.style.width = `${Math.max(0, (left / TIME_LIMIT) * 100)}%`;
      if (left <= 0 && !over) finish();
    }, 100);
    signal.addEventListener('abort', () => clearInterval(tick), { once: true });

    const ctx = { area, signal, pool, correct, wrong, isOver: () => over };
    if (mode === 'fall') runFall(ctx);
    else if (mode === 'find') runFind(ctx);
    else runListen(ctx);

    async function finish() {
      over = true;
      clearInterval(tick);
      stopSpeech();
      area.replaceChildren();
      const best = store.setBestArena(mode, score);
      sfx(best ? 'fanfare' : 'chime');
      if (best) fxConfetti(60);

      area.append(
        el('div', { class: 'panel arena-result' },
          el('div', {}, `${info.icon} ${info.name}`),
          el('div', { class: 'arena-result-score' }, `⭐ ${score}점`),
          el('div', {}, best ? '새 최고 점수예요! 🎉' : `최고 점수 ${store.bestArena(mode)}점`),
          el('div', { class: 'arena-result-actions' },
            el('button', { class: 'btn-big secondary', onclick: () => { sfx('tap'); go('arena'); } }, '🎮 다른 놀이'),
            el('button', { class: 'btn-big', onclick: () => { sfx('tap'); go('arena-play', { mode }); } }, '🔁 다시 하기'),
          ),
        ),
      );
      await sleep(300, signal);
      if (!signal.aborted) speak(best ? '정말 잘했어요!' : '포기하지 않고 끝까지 했어요!', { signal });
    }
  };

  return s;
}

// ---- 1) 소리 듣고 찾기 -------------------------------------------------------
/** @param {any} ctx */
function runListen({ area, signal, pool, correct, wrong, isOver }) {
  ask();
  function ask() {
    if (isOver() || signal.aborted) return;
    const { target, options } = pickRound(pool);
    let answered = false;

    const cards = options.map((opt, i) =>
      el('button', {
        class: `letter-card ${cardColor(i)}`,
        onclick: (/** @type {Event} */ e) => {
          if (answered || isOver() || signal.aborted) return;
          const card = /** @type {HTMLElement} */ (e.currentTarget);
          if (opt.ch === target.ch) {
            answered = true;
            card.classList.add('correct');
            correct(card);
            stopSpeech();
            setTimeout(ask, 260);
          } else {
            wrong(card, PENALTY);
          }
        },
      }, opt.ch),
    );

    area.replaceChildren(
      el('div', { class: 'prompt-bar' },
        el('button', {
          class: 'btn-speaker pulse',
          onclick: () => { sfx('tap'); speak(target.line, { signal }); },
        }, '🔊'),
        el('span', {}, '들리는 글자를 찾아 주세요'),
      ),
      el('div', { class: 'choices' }, cards),
    );
    speak(target.line, { signal });
  }
}

// ---- 2) 떨어지는 글자 --------------------------------------------------------
/** @param {any} ctx */
function runFall({ area, signal, pool, correct, wrong, isOver }) {
  let target = pool[Math.floor(Math.random() * pool.length)];
  const banner = el('div', { class: 'fall-target' }, '');
  const field = el('div', { class: 'fall-field' });

  /** @param {{ ch: string, line: string }} next @param {boolean} [speakIt] */
  const setTarget = (next, speakIt = true) => {
    target = next;
    banner.replaceChildren(
      el('span', { class: 'fall-target-label' }, '잡아요'),
      el('span', { class: 'fall-target-ch' }, target.ch),
    );
    if (speakIt) speak(target.line, { signal });
  };

  area.replaceChildren(
    el('div', { class: 'prompt-bar fall-bar' },
      el('button', { class: 'btn-speaker pulse', onclick: () => { sfx('tap'); speak(target.line, { signal }); } }, '🔊'),
      banner,
    ),
    field,
  );
  setTarget(target);

  const spawn = setInterval(() => {
    if (isOver() || signal.aborted) return;
    const item = spawnLetter(pool, target, Math.random());
    const drop = el('button', {
      class: `letter-card fall-letter ${cardColor(Math.floor(Math.random() * 5))}`,
      style: { left: `${6 + Math.random() * 78}%` },
      onclick: (/** @type {Event} */ e) => {
        if (isOver() || signal.aborted) return;
        const node = /** @type {HTMLElement} */ (e.currentTarget);
        if (item.ch === target.ch) {
          node.classList.add('correct');
          correct(node);
          anim.cancel();
          node.remove();
          setTarget(pool[Math.floor(Math.random() * pool.length)]);
        } else {
          wrong(node, FALL_PENALTY);
        }
      },
    }, item.ch);
    field.append(drop);

    // CSS 애니메이션 대신 WAAPI — reduced-motion 전역 규칙에 지워지지 않는다
    const anim = drop.animate(
      [{ transform: 'translateY(-14vh)' }, { transform: 'translateY(96vh)' }],
      { duration: FALL_MS, easing: 'linear' },
    );
    anim.onfinish = () => drop.remove();
  }, SPAWN_MS);

  signal.addEventListener('abort', () => clearInterval(spawn), { once: true });
}

// ---- 3) 같은 글자 모으기 -----------------------------------------------------
/** @param {any} ctx */
function runFind({ area, signal, pool, correct, wrong, isOver }) {
  board();
  function board() {
    if (isOver() || signal.aborted) return;
    const { target, cells } = buildFindBoard(pool);
    let left = cells.filter(c => c.ch === target.ch).length;

    const nodes = cells.map((c, i) =>
      el('button', {
        class: `letter-card find-cell ${cardColor(i)}`,
        onclick: (/** @type {Event} */ e) => {
          if (isOver() || signal.aborted) return;
          const node = /** @type {HTMLElement} */ (e.currentTarget);
          if (node.classList.contains('found')) return;
          if (c.ch === target.ch) {
            node.classList.add('found', 'correct');
            correct(node);
            left -= 1;
            if (left <= 0) setTimeout(board, 320);
          } else {
            wrong(node, PENALTY);
          }
        },
      }, c.ch),
    );

    area.replaceChildren(
      el('div', { class: 'prompt-bar' },
        el('button', { class: 'btn-speaker pulse', onclick: () => { sfx('tap'); speak(target.line, { signal }); } }, '🔊'),
        el('span', {}, '같은 글자를 모두 찾아요'),
        el('span', { class: 'find-target' }, target.ch),
      ),
      el('div', { class: 'find-board' }, nodes),
    );
  }
}

register('arena-play', render);
