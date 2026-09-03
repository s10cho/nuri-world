// 설정 모달 — 소리, 전체화면(웹 전용), 진행 초기화, 보호자 안내
import { go } from '../app.js';
import { el, modal, toggleFullscreen, fullscreenSupported } from '../ui.js';
import { NATIVE } from '../platform.js';
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

  // 전체화면 토글은 브라우저에서만 뜻이 있다. 앱은 이미 몰입형 전체화면(MainActivity)이라
  // 웹뷰의 Fullscreen API 를 불러도 바뀌는 게 없어, 눌러도 아무 일 없는 버튼만 남는다.
  if (!NATIVE && fullscreenSupported()) {
    rows.push(el('div', { class: 'setting-row' },
      el('span', {}, '⛶ 전체화면'),
      el('button', { class: 'btn-round', onclick: () => { sfx('tap'); toggleFullscreen(); } }, '전환'),
    ));
  }

  rows.push(el('div', { class: 'setting-row' },
    el('span', {}, '🗑️ 처음부터 다시 하기'),
    el('button', {
      class: 'btn-round',
      style: { color: '#c0392b' },
      onclick: () => { sfx('tap'); parentGate(); },
    }, '초기화'),
  ));

  // 보호자 안내 — 앱과 웹에서 사실이 다른 항목은 환경에 맞는 것만 보여 준다.
  const notice = el('div', { class: 'guardian-note' },
    el('b', {}, '👨‍👩‍👧 보호자님께'),
    el('div', {}, '· 이 앱이 말하는 문장은 모두 사람이 직접 녹음한 목소리예요.'),
    el('div', {}, '· 광고와 결제가 없고, 인터넷 없이도 처음부터 끝까지 즐길 수 있어요. ' +
      '진행 기록은 기기 안에만 저장돼요.'),
    ...(hasTTS() ? [] : [el('div', {}, '· 녹음이 없는 일부 문장은 기기의 한국어 음성으로 읽어 주는데, ' +
      '이 기기에는 한국어 음성이 없어요. 그런 문장은 글자로만 보여요.')]),
    ...(NATIVE ? [] : [el('div', {}, '· 아이폰·아이패드에서는 공유 → "홈 화면에 추가"를 하면 ' +
      '앱처럼 전체화면으로 즐길 수 있어요.')]),
    el('div', {}, '· 하루 10~15분, 한두 스테이지씩 아이와 함께 이야기하며 진행하는 것을 추천해요.'),
  );

  const close = modal([
    el('h2', {}, '⚙️ 설정'),
    ...rows,
    notice,
    el('button', { class: 'btn-big secondary', onclick: () => close() }, '닫기'),
  ]);
}

// 보호자 확인 게이트 — 두 자리 곱셈을 풀어야 초기화가 진행된다 (아이 우발 조작 방지).
// 숫자판에는 숫자와 지우기만 두고, 확인·취소는 아래에 나란히 둔다.
// (예전에는 숫자판 안에 '✓' 가 섞여 있어 계산기의 √ 처럼 보였다.)
function parentGate() {
  const a = 6 + Math.floor(Math.random() * 6); // 6~11
  const b = 3 + Math.floor(Math.random() * 6); // 3~8
  const answer = a * b;
  let typed = '';

  // 입력값은 따로 줄을 두지 않고 식 안에 채워 넣는다 — 세로가 줄고, 무엇을 답하는지도 또렷하다.
  const quiz = el('div', { class: 'ribbon gate-quiz' }, '');
  const msg = el('div', { class: 'gate-msg' }, '');

  function refresh() {
    quiz.textContent = `${a} × ${b} = ${typed || '?'}`;
    okBtn.disabled = typed.length === 0;
  }

  function confirm() {
    if (parseInt(typed, 10) === answer) {
      store.reset();
      // body에 붙은 모달(게이트+설정)을 모두 정리 후 타이틀로
      document.querySelectorAll('.modal-wrap').forEach(m => m.remove());
      go('title');
      return;
    }
    msg.textContent = '답이 달라요. 다시 확인해 주세요.';
    typed = '';
    refresh();
  }

  const okBtn = /** @type {HTMLButtonElement} */ (el('button', {
    class: 'btn-big',
    onclick: () => { sfx('tap'); confirm(); },
  }, '확인'));

  const pad = el('div', { class: 'gate-pad' },
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '←'].map(k =>
      k === ''
        ? el('span') // 0을 가운데 두기 위한 빈 칸
        : el('button', {
          class: 'btn-big secondary gate-key',
          onclick: () => {
            sfx('tap');
            if (k === '←') { typed = typed.slice(0, -1); refresh(); return; }
            if (typed.length < 3) { typed += k; refresh(); }
          },
        }, k),
    ),
  );

  const closeGate = modal([
    el('h2', {}, '🔒 보호자 확인'),
    el('div', { class: 'gate-warn' },
      '모든 진행(별·도감·구출한 친구)이 지워져요.', el('br', {}),
      '계속하려면 아래 계산의 답을 눌러 주세요.'),
    quiz,
    msg,
    pad,
    el('div', { class: 'gate-actions' },
      el('button', { class: 'btn-big secondary', onclick: () => { sfx('tap'); closeGate(); } }, '취소'),
      okBtn,
    ),
  ], { className: 'gate-modal' });

  refresh();
}
