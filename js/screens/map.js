// 월드맵 — 왕국 선택
import { register, go } from '../app.js';
import { el, topbar, iconBtn } from '../ui.js';
import { store } from '../store.js';
import { speak, sfx } from '../audio.js';
import { KINGDOMS, KINGDOM_ORDER, MAP_SPOTS } from '../data.js';
import { openSettings } from './settings.js';

/** @param {string} k */
function kingdomStars(k) {
  return store.get().stars[k].reduce((a, b) => a + Math.max(0, b), 0);
}

function render() {
  const s = /** @type {AppScreen} */ (el('div', {
    style: { backgroundImage: 'url(assets/images/backgrounds/world_map.jpg)' },
  }));

  // 다음에 도전할 왕국 (처음으로 클리어 안 된 왕국)
  const nextKingdom = KINGDOM_ORDER.find(k => !store.kingdomCleared(k));

  const spots = KINGDOM_ORDER.map(kid => {
    const k = KINGDOMS[kid];
    const spot = MAP_SPOTS[kid];
    const unlocked = store.kingdomUnlocked(kid);
    const total = k.stages.length * 3;

    const node = el('button', {
      class: `map-spot ${unlocked ? '' : 'locked'} ${kid === nextKingdom && unlocked ? 'next' : ''}`,
      style: { left: `${spot.x}%`, top: `${spot.y}%` },
      onclick: () => {
        if (!unlocked) {
          sfx('wrong');
          speak('아직 잠겨 있어요. 이전 왕국을 먼저 구해 주세요!');
          return;
        }
        sfx('tap');
        go('kingdom', { kingdom: kid });
      },
    },
      el('span', { class: 'label' },
        `${k.order}. ${k.name}`,
        el('span', { class: 'sub' }, k.subtitle),
      ),
      unlocked
        ? el('span', { class: 'stars' }, `⭐ ${kingdomStars(kid)}/${total}`)
        : el('span', { class: 'lock-ico' }, '🔒'),
    );
    return node;
  });

  // 왕국 축제 (모든 왕국 클리어 시)
  const allCleared = KINGDOM_ORDER.every(k => store.kingdomCleared(k));
  const fest = el('button', {
    class: `map-spot ${allCleared ? 'next' : 'locked'}`,
    style: { left: `${MAP_SPOTS.festival.x}%`, top: `${MAP_SPOTS.festival.y}%` },
    onclick: () => {
      if (!allCleared) {
        sfx('wrong');
        speak('몬스터를 물리치면 축제가 열려요!');
        return;
      }
      sfx('fanfare');
      go('festival');
    },
  },
    el('span', { class: 'label' }, '🎉 왕국 축제', el('span', { class: 'sub' }, '엔딩 파티')),
    allCleared ? null : el('span', { class: 'lock-ico' }, '🔒'),
  );

  s.append(
    topbar({
      left: [iconBtn('🏠', '홈', () => { sfx('tap'); go('title'); })],
      right: [
        iconBtn('📖', '도감', () => { sfx('tap'); go('dex'); }),
        iconBtn('⚙️', '', () => { sfx('tap'); openSettings(); }),
      ],
    }),
    el('div', {
      style: {
        position: 'absolute', left: '50%', top: 'max(10px, env(safe-area-inset-top))',
        transform: 'translateX(-50%)', zIndex: '5', textAlign: 'center',
      },
    },
      el('div', { class: 'sign' }, '누리의 한글 왕국 지도', el('span', { class: 'sub' }, '글자를 되찾아 왕국을 구해요!')),
    ),
    ...spots,
    fest,
  );

  s._onShow = () => {
    if (nextKingdom) {
      const k = KINGDOMS[nextKingdom];
      speak(`${k.name}에서 모험을 계속해요!`);
    } else {
      speak('와, 모든 왕국을 구했어요! 축제에 가 볼까요?');
    }
  };
  return s;
}

register('map', render);
