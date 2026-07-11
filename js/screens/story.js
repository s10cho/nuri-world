// 스토리 인트로 — 그림책처럼 한 장씩 넘기기
import { register, go } from '../app.js';
import { el } from '../ui.js';
import { store } from '../store.js';
import { speak, sfx, stopSpeech } from '../audio.js';
import { STORY_INTRO, CHARACTERS } from '../data.js';

function render() {
  let idx = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let autoTimer = null;
  /** @type {AbortSignal | undefined} */
  let signal; // 화면 수명 신호 (_onShow에서 주입)
  const s = /** @type {AppScreen} */ (el('div', {}));

  const text = el('div', { class: 'panel story-text' });
  // 글을 못 읽는 아이도 알 수 있도록 크게 흔들리는 손 아이콘 + 짧은 안내
  const hint = el('div', { class: 'tap-hint', style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem' } },
    el('span', { style: { fontSize: '2.4rem' } }, '👆'),
    el('span', {}, '눌러서 다음으로'),
  );
  const charLayer = el('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' } });

  const skipBtn = el('button', {
    class: 'btn-round',
    style: { position: 'absolute', top: 'max(12px, env(safe-area-inset-top))', right: 'calc(16px + env(safe-area-inset-right))', zIndex: '6' },
    onclick: (/** @type {Event} */ e) => { e.stopPropagation(); finish(); },
  }, '건너뛰기 ⏩');

  function clearAuto() { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } }

  function finish() {
    clearAuto();
    stopSpeech();
    store.markIntroSeen();
    go('map');
  }

  function advance() {
    if (signal?.aborted) return;
    clearAuto();
    sfx('whoosh');
    idx += 1;
    if (idx >= STORY_INTRO.length) return finish();
    showPanel();
  }

  function showPanel() {
    const p = STORY_INTRO[idx];
    s.style.backgroundImage = `url(${p.bg})`;
    text.textContent = p.text;
    text.animate(
      [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 450, easing: 'ease' },
    );
    charLayer.replaceChildren();
    if (p.char === 'eraser') {
      charLayer.append(el('img', { class: 'char enter', src: CHARACTERS.eraser, alt: '지우개 몬스터', style: { right: '6%' } }));
    } else if (p.char === 'both') {
      charLayer.append(
        el('img', { class: 'char enter char-nuri', src: CHARACTERS.nuri, alt: '누리', style: { left: '6%' } }),
        el('img', { class: 'char enter char-pori', src: CHARACTERS.pori, alt: '포리', style: { left: '26%', height: 'clamp(105px, 22vmin, 260px)' } }),
      );
    }
    speak(p.text.replace(/\n/g, ' '), { signal });
    // 안전장치: 아이가 탭하지 않아도 잠시 뒤 자동으로 다음 장면으로 진행
    clearAuto();
    autoTimer = setTimeout(advance, 9000);
  }

  s.addEventListener('click', advance);

  s.append(
    el('div', { class: 'scrim' }),
    skipBtn,
    charLayer,
    el('div', { class: 'center-col', style: { justifyContent: 'flex-end', paddingBottom: 'max(28px, 6vh)' } }, text, hint),
  );

  s._onShow = sig => {
    signal = sig;
    // 화면 이탈 시 자동진행 타이머 정리
    sig.addEventListener('abort', clearAuto, { once: true });
    showPanel();
  };
  return s;
}

register('story', render);
