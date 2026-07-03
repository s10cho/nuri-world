// DOM 헬퍼 + 공통 UI 컴포넌트 + 이펙트

// el('div', { class: 'panel', onclick: fn }, child1, 'text', ...)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else {
      node.setAttribute(k, v);
    }
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// n개 무작위 추출
export function sample(arr, n) {
  return shuffle(arr).slice(0, n);
}

// 별점 문자열 (채워진 별 / 빈 별)
export function starsText(n, max = 3) {
  if (n < 0) return '☆'.repeat(max);
  return '⭐'.repeat(n) + '☆'.repeat(max - n);
}

// 글자 카드 색상 순환 클래스
export function cardColor(i) {
  return `c${(i % 6) + 1}`;
}

// ---- 상단 바 --------------------------------------------------------------
export function topbar({ left = [], right = [] } = {}) {
  return el('div', { class: 'topbar' },
    el('div', { class: 'side' }, left),
    el('div', { class: 'side' }, right),
  );
}

export function iconBtn(icon, label, onclick) {
  return el('button', { class: 'btn-round', onclick, 'aria-label': label },
    el('span', { class: 'ico' }, icon),
    label ? el('span', {}, label) : null,
  );
}

// ---- 모달 ------------------------------------------------------------------
export function modal(children, { onClose } = {}) {
  const wrap = el('div', { class: 'modal-wrap' },
    el('div', { class: 'panel modal' }, children),
  );
  const close = () => {
    wrap.remove();
    onClose?.();
  };
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  document.body.append(wrap);
  return close;
}

// ---- 이펙트 -----------------------------------------------------------------
function fxLayer() {
  let layer = document.querySelector('.fx-layer');
  if (!layer) {
    layer = el('div', { class: 'fx-layer' });
    document.body.append(layer);
  }
  return layer;
}

// 특정 지점에서 이모지 파티클 팡!
export function fxBurst(x, y, emojis = ['✨', '⭐', '💛'], count = 10) {
  const layer = fxLayer();
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const dist = 70 + Math.random() * 110;
    const p = el('span', {
      class: 'fx-particle',
      style: {
        left: `${x}px`, top: `${y}px`,
        '--dx': `${Math.cos(angle) * dist}px`,
        '--dy': `${Math.sin(angle) * dist - 60}px`,
        '--rot': `${Math.random() * 360 - 180}deg`,
        '--dur': `${0.8 + Math.random() * 0.7}s`,
      },
    }, emojis[i % emojis.length]);
    layer.append(p);
    setTimeout(() => p.remove(), 1600);
  }
}

// 요소 중심에서 팡!
export function fxBurstAt(elem, emojis, count) {
  const r = elem.getBoundingClientRect();
  fxBurst(r.left + r.width / 2, r.top + r.height / 2, emojis, count);
}

// 화면 전체 색종이
export function fxConfetti(count = 60) {
  const layer = fxLayer();
  const colors = ['#f2708a', '#59b8f2', '#ffb03a', '#6abf4b', '#9b6dd6', '#38c9b0', '#ffd95e'];
  for (let i = 0; i < count; i++) {
    const p = el('span', {
      class: 'fx-confetti',
      style: {
        left: `${Math.random() * 100}vw`,
        background: colors[i % colors.length],
        '--rot': `${360 + Math.random() * 720}deg`,
        '--dur': `${2 + Math.random() * 2.2}s`,
        animationDelay: `${Math.random() * 0.8}s`,
      },
    });
    layer.append(p);
    setTimeout(() => p.remove(), 5200);
  }
}

// ---- 전체화면 ---------------------------------------------------------------
export function toggleFullscreen() {
  const doc = document;
  if (!doc.fullscreenElement && doc.documentElement.requestFullscreen) {
    doc.documentElement.requestFullscreen().catch(() => {});
    return true;
  }
  if (doc.fullscreenElement && doc.exitFullscreen) {
    doc.exitFullscreen().catch(() => {});
  }
  return false;
}

export function fullscreenSupported() {
  return !!document.documentElement.requestFullscreen;
}
