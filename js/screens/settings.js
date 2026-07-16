// 설정 모달 — 소리, 전체화면, 진행 초기화, 보호자 안내
import { go } from '../app.js';
import { el, modal, toggleFullscreen, fullscreenSupported } from '../ui.js';
import { store } from '../store.js';
import { sfx, hasTTS } from '../audio.js';

export function openSettings() {
  const soundToggle = el('button', {
    class: `toggle ${store.get().sound ? 'on' : ''}`,
    onclick: () => {
      store.setSound(!store.get().sound);
      soundToggle.classList.toggle('on', store.get().sound);
      sfx('tap');
    },
  }, el('span', { class: 'knob' }));

  const rows = [
    el('div', { class: 'setting-row' }, el('span', {}, '🔊 소리 켜기'), soundToggle),
  ];

  if (fullscreenSupported()) {
    rows.push(el('div', { class: 'setting-row' },
      el('span', {}, '⛶ 전체화면'),
      el('button', { class: 'btn-round', onclick: () => { sfx('tap'); toggleFullscreen(); } }, '전환'),
    ));
  }

  const resetBtn = el('button', {
    class: 'btn-round',
    style: { color: '#c0392b' },
    onclick: () => { sfx('tap'); parentGate(); },
  }, '초기화');

  rows.push(el('div', { class: 'setting-row' }, el('span', {}, '🗑️ 처음부터 다시 하기'), resetBtn));

  // 보호자 안내
  const notice = el('div', {
    style: { fontSize: '0.92rem', lineHeight: '1.55', textAlign: 'left', background: 'rgba(255,255,255,0.5)', borderRadius: '12px', padding: '12px 16px' },
  },
    el('b', {}, '👨‍👩‍👧 보호자님께'),
    el('div', {}, '· 이 앱의 음성은 인공지능(AI) 기술로 생성된 목소리예요. 실제 사람의 음성이 아니에요.'),
    el('div', {}, '· 음성 파일을 재생할 수 없을 때는 기기의 한국어 음성(TTS)으로 읽어 줘요. ' +
      (hasTTS() ? '이 기기는 음성을 지원해요.' : '이 기기는 TTS를 지원하지 않아요.')),
    el('div', {}, '· 아이폰·아이패드에서는 공유 → "홈 화면에 추가"를 하면 전체화면으로 즐길 수 있어요.'),
    el('div', {}, '· 하루 10~15분, 한두 스테이지씩 아이와 함께 이야기하며 진행하는 것을 추천해요.'),
  );

  const close = modal([
    el('h2', {}, '⚙️ 설정'),
    ...rows,
    notice,
    el('button', { class: 'btn-big secondary', onclick: () => close() }, '닫기'),
  ]);
}

// 보호자 확인 게이트 — 두 자리 곱셈을 풀어야 초기화가 진행됨 (아이 우발 조작 방지)
function parentGate() {
  const a = 6 + Math.floor(Math.random() * 6); // 6~11
  const b = 3 + Math.floor(Math.random() * 6); // 3~8
  const answer = a * b;
  let typed = '';

  const display = el('div', {
    style: { fontSize: '2rem', minHeight: '2.4rem', letterSpacing: '4px', color: '#4a3423' },
  }, '');
  const msg = el('div', { style: { minHeight: '1.4rem', color: '#c0392b' } }, '');

  function refresh() { display.textContent = typed || '_'; }

  const pad = el('div', {
    style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', maxWidth: '280px', margin: '0 auto' },
  },
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '0', '✓'].map(k =>
      el('button', {
        class: 'btn-big secondary',
        style: { minHeight: '56px', fontSize: '1.4rem', padding: '8px' },
        onclick: () => {
          sfx('tap');
          if (k === '←') { typed = typed.slice(0, -1); refresh(); return; }
          if (k === '✓') {
            if (parseInt(typed, 10) === answer) {
              store.reset();
              // body에 붙은 모달(게이트+설정)을 모두 정리 후 타이틀로
              document.querySelectorAll('.modal-wrap').forEach(m => m.remove());
              go('title');
            } else {
              msg.textContent = '답이 달라요. 다시 확인해 주세요.';
              typed = ''; refresh();
            }
            return;
          }
          if (typed.length < 3) { typed += k; refresh(); }
        },
      }, k),
    ),
  );
  refresh();

  const closeGate = modal([
    el('h2', {}, '🔒 보호자 확인'),
    el('div', { style: { fontSize: '1rem', lineHeight: '1.5' } },
      '모든 진행(별·도감·구출한 친구)이 지워져요.', el('br', {}),
      '계속하려면 아래 계산의 답을 눌러 주세요.'),
    el('div', { class: 'ribbon', style: { fontSize: '1.5rem', padding: '10px 24px' } }, `${a} × ${b} = ?`),
    display,
    msg,
    pad,
    el('button', { class: 'btn-big secondary', onclick: () => closeGate() }, '취소'),
  ]);
}
