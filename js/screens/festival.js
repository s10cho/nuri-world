// 왕국 축제 — 엔딩
//
// 마지막 화면인데 인물이 가만히 서 있고 색종이도 대사에 맞춰 몇 번만 터져서
// "정적이다"는 피드백을 받았다. 이제 누리·포리가 계속 폴짝이고, 각 단계에서 구출한
// 친구들이 줄지어 들썩이며, 화면을 떠날 때까지 색종이와 반짝임이 이어진다.
import { register, go } from '../app.js';
import { el, fxConfetti, fxBurstAt, sleep } from '../ui.js';
import { store } from '../store.js';
import { openMemento } from './memento.js';
import { speak, sfx } from '../audio.js';
import { FESTIVAL, CELEBRATIONS, VILLAGE_STAGES } from '../data.js';

/** 춤 프레임 — 함께 기뻐하는 일러스트를 번갈아 보여 준다 */
const DANCE_FRAMES = CELEBRATIONS;

/** 축제가 이어지는 동안 색종이를 터뜨리는 간격 */
const CONFETTI_EVERY = 2400;
/** 친구 하나가 반짝이는 간격 */
const SPARKLE_EVERY = 900;

function render() {
  const s = /** @type {AppScreen} */ (el('div', { style: { backgroundImage: `url(${FESTIVAL.bg})` } }));

  const textBox = el('div', { class: 'panel story-text' });
  // 구출한 친구 전부. 예전에는 12명만 보였는데, 다 모은 아이에게는 그만큼이 성과다.
  const residents = VILLAGE_STAGES.flatMap(st => st.words).filter(w => store.get().residents.includes(w.w));

  const friends = residents.map((r, i) =>
    el('span', {
      class: 'festival-friend',
      style: { '--i': String(i) },
      title: r.w,
    }, r.e),
  );

  // 축제에서는 둘이 따로 서 있는 정적 이미지 대신, 함께 기뻐하는 일러스트를 프레임처럼
  // 번갈아 보여 주며 왈츠처럼 흔들어 '춤추는 한 쌍'으로 만든다.
  // (손을 맞잡은 전용 그림이 없어 기존 축하 일러스트를 프레임으로 쓴다)
  const dancers = el('div', { class: 'festival-dancers' },
    DANCE_FRAMES.map((src, i) =>
      el('img', { class: 'dance-frame', src, alt: i === 0 ? '함께 기뻐하는 누리와 포리' : '', style: { '--f': String(i) } }),
    ),
  );

  s.append(
    el('div', { class: 'scrim' }),
    el('div', { class: 'center-col festival-col' },
      el('div', { class: 'festival-parade' }, friends),
      textBox,
      el('div', { class: 'festival-actions' },
        el('button', { class: 'btn-big secondary', onclick: () => { sfx('tap'); go('dex'); } }, '📖 도감 보기'),
        el('button', { class: 'btn-big secondary', onclick: () => { sfx('tap'); openMemento(); } }, '📸 기념 네컷'),
        el('button', { class: 'btn-big', onclick: () => { sfx('tap'); go('map'); } }, '🗺️ 지도로'),
      ),
    ),
    dancers,
  );

  s._onShow = async signal => {
    store.markFestivalSeen();
    sfx('fanfare');

    // 대사가 끝나도 축제는 계속된다 — 화면을 떠날 때까지 색종이와 반짝임을 이어 간다.
    const party = (async () => {
      while (!signal.aborted) {
        fxConfetti(28);
        await sleep(CONFETTI_EVERY, signal);
      }
    })();
    const sparkle = (async () => {
      while (!signal.aborted) {
        const f = friends[Math.floor(Math.random() * friends.length)];
        if (f?.isConnected) fxBurstAt(f, ['✨', '⭐', '💛', '🎉'], 6);
        await sleep(SPARKLE_EVERY, signal);
      }
    })();

    for (const line of FESTIVAL.lines) {
      if (signal.aborted) break; // 화면을 떠났으면 내레이션 중단
      textBox.textContent = line;
      textBox.animate(
        [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 400, easing: 'ease' },
      );
      await speak(line, { signal });
      await sleep(700, signal);
    }
    if (!signal.aborted) sfx('chime');
    await Promise.all([party, sparkle]); // abort 되면 둘 다 곧바로 끝난다
  };

  return s;
}

register('festival', render);
