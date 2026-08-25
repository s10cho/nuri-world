// 왕국 화면 — 스테이지 선택
import { register, go } from '../app.js';
import { el, topbar, iconBtn, starsText, sleep } from '../ui.js';
import { store } from '../store.js';
import { speak, sfx } from '../audio.js';
import { KINGDOMS, CHARACTERS } from '../data.js';
import { openSettings } from './settings.js';

/** @param {{ kingdom: KingdomId }} params */
function render({ kingdom }) {
  const k = KINGDOMS[kingdom];
  const s = /** @type {AppScreen} */ (el('div', { style: { backgroundImage: `url(${k.bg})` } }));

  const pads = k.stages.map((st, i) => {
    const unlocked = store.stageUnlocked(kingdom, i);
    const stars = store.get().stars[kingdom][i];
    return el('button', {
      class: `stage-pad ${unlocked ? '' : 'locked'}`,
      onclick: () => {
        if (!unlocked) {
          sfx('wrong');
          speak('앞의 스테이지를 먼저 깨야 해요!');
          return;
        }
        sfx('tap');
        go('stage', { kingdom, stageIdx: i });
      },
    },
      el('span', { class: 'num' }, unlocked ? String(i + 1) : '🔒'),
      el('span', { class: 't' }, st.title),
      el('span', { class: 'stars' }, starsText(stars)),
    );
  });

  s.append(
    el('div', { class: 'scrim' }),
    topbar({
      left: [iconBtn('🗺️', '지도', () => { sfx('tap'); go('map'); })],
      right: [
        iconBtn('📖', '도감', () => { sfx('tap'); go('dex'); }),
        iconBtn('⚙️', '', () => { sfx('tap'); openSettings(); }),
      ],
    }),
    el('div', { class: 'center-col', style: { justifyContent: 'flex-start', paddingTop: '8px' } },
      el('div', { class: 'sign' }, `${k.order}. ${k.name}`, el('span', { class: 'sub' }, k.subtitle)),
      el('div', { class: 'ribbon' }, k.goal),
      el('div', { class: 'stage-pads', style: { marginTop: 'auto', marginBottom: 'auto' } }, pads),
    ),
    el('img', {
      class: 'char floaty char-pori', src: CHARACTERS.pori, alt: '포리',
      style: { left: '2%' },
    }),
  );

  // 왕국 소개에 이어 목표까지 읽어 준다. 글을 못 읽는 아이도 무엇을 하러 왔는지 알 수 있게.
  // (리본에 적힌 k.goal 이 화면 표시 전용이라 소리로는 전달되지 않았다)
  s._onShow = async (signal) => {
    await speak(k.intro, { signal });
    await sleep(300, signal);
    if (signal?.aborted) return;
    await speak(k.goal, { signal });
  };
  return s;
}

register('kingdom', render);
