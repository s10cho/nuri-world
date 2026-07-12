// 로딩 화면 — 최초 실행 시 녹음 음성·이미지를 모두 미리 받아 두고, 완료되면
// '시작하기' 탭으로 진입한다. 이 탭이 오디오 잠금 해제 제스처가 되어, 새로고침 후에도
// 타이틀 환영 음성이 확실히 재생된다(브라우저 자동재생 정책상 제스처 없이는 소리가 안 남).
import { register, go } from '../app.js';
import { el } from '../ui.js';
import { unlockAudio, preloadVoiceAssets } from '../audio.js';
import { CHARACTERS, CELEBRATIONS, BATTLE_HERO } from '../data.js';

// 미리 받아 둘 이미지 — 배경 + 캐릭터 + 축하/배틀 일러스트(첫 화면 전환 시 깜빡임 방지)
function imageList() {
  const backgrounds = [
    'title_screen', 'world_map', 'memory_meadow', 'echo_lake', 'letter_tower',
    'nameless_village', 'monster_castle', 'story_intro_dark_kingdom', 'festival_ending',
  ].map(n => `assets/images/backgrounds/${n}.jpg`);
  return [
    ...backgrounds,
    ...Object.values(CHARACTERS),
    ...CELEBRATIONS,
    BATTLE_HERO,
  ];
}

// 이미지 프리로드 — 각 이미지는 load/error 어느 쪽이든 완료로 처리(무한 대기 방지).
/** @param {(fraction: number) => void} onProgress */
function preloadImages(onProgress) {
  const list = imageList();
  const total = list.length;
  let done = 0;
  return Promise.all(list.map(src => /** @type {Promise<void>} */ (new Promise(resolve => {
    const img = new Image();
    const finish = () => { done += 1; onProgress(done / total); resolve(); };
    img.onload = finish;
    img.onerror = finish;
    img.src = src;
  }))));
}

function render() {
  const s = /** @type {AppScreen} */ (el('div', {
    style: { backgroundImage: 'url(assets/images/backgrounds/title_screen.jpg)' },
  }));

  const fill = el('div', { class: 'load-fill' });
  const pct = el('div', { class: 'load-pct' }, '0%');
  const msg = el('div', { class: 'load-msg' }, '모험을 준비하고 있어요...');

  // 완료 후 나타나는 시작 버튼 (준비 전에는 숨김)
  const startBtn = el('button', {
    class: 'btn-big load-start',
    onclick: () => {
      // 이 클릭이 오디오 잠금 해제 제스처 — 직후 타이틀 환영 음성이 재생된다.
      unlockAudio();
      go('title');
    },
  }, '🚀 시작하기');

  s.append(
    el('div', { class: 'scrim' }),
    el('div', { class: 'center-col' },
      el('img', { class: 'load-hero', src: CELEBRATIONS[0], alt: '누리와 포리' }),
      msg,
      el('div', { class: 'load-bar' }, fill),
      pct,
      startBtn,
    ),
  );

  s._onShow = async signal => {
    let audioFrac = 0;
    let imgFrac = 0;
    const paint = () => {
      // 음성이 용량 대부분이라 가중치를 크게(0.8), 이미지는 0.2
      const p = Math.min(1, 0.8 * audioFrac + 0.2 * imgFrac);
      fill.style.width = `${Math.round(p * 100)}%`;
      pct.textContent = `${Math.round(p * 100)}%`;
    };

    // 준비 완료(또는 안전 타임아웃) 시 시작 버튼 노출
    let shown = false;
    const ready = () => {
      if (shown || signal.aborted) return;
      shown = true;
      fill.style.width = '100%';
      pct.textContent = '100%';
      msg.textContent = '준비 완료! 모험을 시작해요!';
      s.classList.add('load-done');
    };
    // 네트워크가 아주 느려도 아이가 갇히지 않도록 25초 안전 타임아웃
    const safety = setTimeout(ready, 25000);

    await Promise.all([
      preloadVoiceAssets(f => { audioFrac = f; paint(); }),
      preloadImages(f => { imgFrac = f; paint(); }),
    ]);

    clearTimeout(safety);
    ready();
  };

  return s;
}

register('loading', render);
