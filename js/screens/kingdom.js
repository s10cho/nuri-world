// 왕국 화면 — 스테이지 선택
import { register, go } from '../app.js';
import { el, topbar, iconBtn, starsText } from '../ui.js';
import { store } from '../store.js';
import { speak, sfx } from '../audio.js';
import { KINGDOMS, CHARACTERS } from '../data.js';
import { openSettings } from './settings.js';

function render({ kingdom }) {
  const k = KINGDOMS[kingdom];
  const s = el('div', { style: { backgroundImage: `url(${k.bg})` } });

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
      class: 'char floaty', src: CHARACTERS.pori, alt: '포리',
      style: { left: '2%', height: 'clamp(110px, 22vmin, 250px)' },
    }),
  );

  s._onShow = () => speak(k.intro);
  return s;
}

register('kingdom', render);
