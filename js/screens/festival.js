// 왕국 축제 — 엔딩
import { register, go } from '../app.js';
import { el, fxConfetti, sleep } from '../ui.js';
import { store } from '../store.js';
import { speak, sfx } from '../audio.js';
import { FESTIVAL, CHARACTERS, VILLAGE_STAGES } from '../data.js';

function render() {
  const s = el('div', { style: { backgroundImage: `url(${FESTIVAL.bg})` } });

  const textBox = el('div', { class: 'panel story-text' });
  const residents = VILLAGE_STAGES.flatMap(st => st.words).filter(w => store.get().residents.includes(w.w));

  s.append(
    el('div', { class: 'scrim' }),
    el('div', { class: 'center-col', style: { justifyContent: 'flex-end', paddingBottom: 'max(24px, 5vh)' } },
      // 구출한 주민들 퍼레이드
      el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '90vw' } },
        residents.slice(0, 12).map((r, i) =>
          el('span', {
            class: 'word-emoji',
            style: { fontSize: 'clamp(2.2rem, 6vmin, 4rem)', animation: `charFloat 2.2s ease-in-out ${i * 0.15}s infinite` },
          }, r.e),
        ),
      ),
      textBox,
      el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' } },
        el('button', { class: 'btn-big secondary', onclick: () => { sfx('tap'); go('dex'); } }, '📖 도감 보기'),
        el('button', { class: 'btn-big', onclick: () => { sfx('tap'); go('map'); } }, '🗺️ 지도로'),
      ),
    ),
    el('img', { class: 'char enter', src: CHARACTERS.nuri, alt: '누리', style: { left: '4%', height: 'clamp(150px, 32vmin, 360px)' } }),
    el('img', { class: 'char enter', src: CHARACTERS.pori, alt: '포리', style: { right: '4%', height: 'clamp(120px, 26vmin, 290px)' } }),
  );

  s._onShow = async () => {
    store.markFestivalSeen();
    sfx('fanfare');
    for (const line of FESTIVAL.lines) {
      if (s._dead) return; // 화면을 떠났으면 내레이션·색종이 중단
      fxConfetti(50);
      textBox.textContent = line;
      textBox.animate(
        [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 400, easing: 'ease' },
      );
      await speak(line);
      await sleep(700);
    }
    if (s._dead) return;
    sfx('chime');
  };

  return s;
}

register('festival', render);
