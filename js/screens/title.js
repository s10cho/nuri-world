// 타이틀 화면
import { register, go } from '../app.js';
import { el, topbar, iconBtn, toggleFullscreen, fullscreenSupported } from '../ui.js';
import { store } from '../store.js';
import { speak, sfx } from '../audio.js';
import { CHARACTERS } from '../data.js';
import { openSettings } from './settings.js';

function render() {
  const s = /** @type {AppScreen} */ (el('div', {
    style: { backgroundImage: 'url(assets/images/backgrounds/title_screen.jpg)' },
  }));

  const soundBtn = iconBtn(store.get().sound ? '🔊' : '🔇', '소리', () => {
    store.setSound(!store.get().sound);
    const ico = soundBtn.querySelector('.ico');
    if (ico) ico.textContent = store.get().sound ? '🔊' : '🔇';
    sfx('tap');
  });

  const rightBtns = [iconBtn('⚙️', '설정', () => { sfx('tap'); openSettings(); })];
  if (fullscreenSupported()) {
    rightBtns.unshift(iconBtn('⛶', '전체화면', () => { sfx('tap'); toggleFullscreen(); }));
  }

  s.append(
    el('div', { class: 'scrim' }),
    topbar({ left: [soundBtn], right: rightBtns }),
    el('div', { class: 'center-col' },
      el('h1', { class: 'title-logo' },
        '누리의',
        el('span', { class: 'row2' },
          el('span', { class: 'k1' }, '한'), el('span', { class: 'k2' }, '글'), ' ',
          el('span', { class: 'k3' }, '왕'), el('span', { class: 'k4' }, '국'),
        ),
      ),
      el('div', { class: 'ribbon' }, '⭐ 글자를 되찾아 왕국을 구해요! ⭐'),
      el('button', {
        class: 'btn-big',
        onclick: async (/** @type {Event} */ e) => {
          sfx('fanfare');
          /** @type {HTMLButtonElement} */ (e.currentTarget).disabled = true;
          if (!store.get().introSeen) {
            go('story');
          } else {
            go('map');
          }
        },
      }, '🚀 모험 시작'),
      el('div', { style: { display: 'flex', gap: '14px' } },
        el('button', { class: 'btn-big secondary', onclick: () => { sfx('tap'); go('dex'); } }, '📖 도감'),
        store.get().introSeen
          ? el('button', { class: 'btn-big secondary', onclick: () => { sfx('tap'); go('story'); } }, '📜 이야기 다시 보기')
          : null,
      ),
    ),
    el('img', { class: 'char floaty', src: CHARACTERS.nuri, alt: '누리', style: { left: '4%', height: 'clamp(160px, 34vmin, 380px)' } }),
    el('img', { class: 'char floaty', src: CHARACTERS.pori, alt: '포리', style: { right: '4%', height: 'clamp(120px, 26vmin, 300px)', animationDelay: '0.6s' } }),
  );

  // 부팅 직후엔 사용자 제스처가 없어 TTS가 막히므로, 첫 제스처(app.js unlock)에서
  // 다시 재생되도록 _welcomeOnUnlock에도 등록해 둔다.
  /** @type {AbortSignal | undefined} */
  let signal;
  const welcome = () => speak('누리의 한글 왕국에 온 것을 환영해요!', { rate: 0.95, signal });
  s._onShow = sig => { signal = sig; welcome(); };
  s._welcomeOnUnlock = () => { if (!signal?.aborted) welcome(); };
  return s;
}

register('title', render);
