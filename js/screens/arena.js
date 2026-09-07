// 글자 놀이 — 모든 왕국을 구한 뒤 열리는 놀이터(선택 화면).
//
// 아이가 종류를 골라 들어간다. 실제 놀이는 arena-play.js 가 맡는다.
import { register, go } from '../app.js';
import { el, topbar, iconBtn } from '../ui.js';
import { store } from '../store.js';
import { sfx } from '../audio.js';
import { MODES, buildPool, CHOICES } from '../arena-rules.js';

function render() {
  const s = /** @type {AppScreen} */ (el('div', {
    style: { backgroundImage: 'url(assets/images/backgrounds/festival_ending.jpg)' },
  }));

  const pool = buildPool(store.get());
  const ready = pool.length >= CHOICES;

  const cards = MODES.map(m =>
    el('button', {
      class: `arena-pick ${ready ? '' : 'locked'}`,
      onclick: () => { sfx('tap'); if (ready) go('arena-play', { mode: m.id }); },
    },
      el('span', { class: 'arena-pick-ico' }, m.icon),
      el('span', { class: 'arena-pick-name' }, m.name),
      el('span', { class: 'arena-pick-desc' }, m.desc),
      el('span', { class: 'arena-pick-best' },
        store.bestArena(m.id) ? `⭐ 최고 ${store.bestArena(m.id)}점` : '아직 기록이 없어요'),
    ),
  );

  s.append(
    el('div', { class: 'scrim' }),
    topbar({
      left: [iconBtn('🏠', '지도', () => { sfx('tap'); go('map'); })],
      right: [iconBtn('📖', '도감', () => { sfx('tap'); go('dex'); })],
    }),
    el('div', { class: 'center-col arena-hub' },
      el('div', { class: 'sign' }, '⭐ 글자 놀이',
        el('span', { class: 'sub' }, `모은 글자 ${pool.length}개로 놀아요`)),
      ready
        ? el('div', { class: 'arena-picks' }, cards)
        : el('div', { class: 'panel story-text festival-line' },
          '아직 모은 글자가 적어요. 도감을 채우고 다시 와 주세요!'),
    ),
  );

  return s;
}

register('arena', render);
