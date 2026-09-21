// DOM 헬퍼 + 공통 UI 컴포넌트 + 이펙트

// el('div', { class: 'panel', onclick: fn }, child1, 'text', ...)
/**
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        // CSS 커스텀 속성(--x)은 style 객체에 대입해도 조용히 무시된다 — setProperty 로 넣어야 한다.
        // 이걸 몰라서 색종이 회전·낙하시간(--rot/--dur), 친구들 파도타기(--i),
        // 춤 프레임 딜레이(--f)가 전부 기본값으로 굳어 있었다(= 다 똑같이 움직였다).
        if (prop.startsWith('--')) node.style.setProperty(prop, String(val));
        else /** @type {any} */ (node.style)[prop] = val;
      }
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

// 지연. signal이 주어지고 도중에 abort되면 즉시 resolve하고 타이머를 정리한다.
// (호출부는 이어서 signal.aborted를 확인해 조기 반환) — 화면 이탈 시 타이머 누수 방지.
/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export const sleep = (ms, signal) =>
  new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(id);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// n개 무작위 추출
/**
 * @template T
 * @param {T[]} arr
 * @param {number} n
 * @returns {T[]}
 */
export function sample(arr, n) {
  return shuffle(arr).slice(0, n);
}

// 별점 문자열 (채워진 별 / 빈 별)
/** @param {number} n @param {number} [max] */
export function starsText(n, max = 3) {
  if (n < 0) return '☆'.repeat(max);
  return '⭐'.repeat(n) + '☆'.repeat(max - n);
}

// 글자 카드 색상 순환 클래스
/** @param {number} i */
export function cardColor(i) {
  return `c${(i % 6) + 1}`;
}

// ---- 상단 바 --------------------------------------------------------------
/** @param {{ left?: any[], right?: any[] }} [opts] */
export function topbar({ left = [], right = [] } = {}) {
  return el('div', { class: 'topbar' },
    el('div', { class: 'side' }, left),
    el('div', { class: 'side' }, right),
  );
}

/** @param {string} icon @param {string} label @param {EventListener} [onclick] */
export function iconBtn(icon, label, onclick) {
  return el('button', { class: 'btn-round', onclick, 'aria-label': label },
    el('span', { class: 'ico' }, icon),
    label ? el('span', {}, label) : null,
  );
}

// ---- 모달 ------------------------------------------------------------------
/** @param {any} children @param {{ onClose?: () => void, className?: string }} [opts] */
export function modal(children, { onClose, className = '' } = {}) {
  const wrap = el('div', { class: 'modal-wrap' },
    el('div', { class: `panel modal ${className}`.trim() }, children),
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
/** @param {number} x @param {number} y @param {string[]} [emojis] @param {number} [count] */
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
/** @param {Element} elem @param {string[]} [emojis] @param {number} [count] */
export function fxBurstAt(elem, emojis, count) {
  const r = elem.getBoundingClientRect();
  fxBurst(r.left + r.width / 2, r.top + r.height / 2, emojis, count);
}

// 화면 전체 색종이.
// 조각을 하나씩 append 하고 조각마다 타이머를 걸면, 낙하가 한창일 때 수십 번의 DOM 변경과
// 타이머 콜백이 흩어져 메인 스레드를 잘게 쪼갠다. 조각은 fragment 로 한 번에 넣고,
// 정리도 감싸는 상자 하나만 지운다(타이머 1개). 낙하 자체는 CSS 합성 레이어가 맡는다.
/** @param {number} [count] */
export function fxConfetti(count = 60) {
  const layer = fxLayer();
  const colors = ['#f2708a', '#59b8f2', '#ffb03a', '#6abf4b', '#9b6dd6', '#38c9b0', '#ffd95e'];
  const box = el('div');
  const frag = document.createDocumentFragment();
  let last = 0; // 가장 늦게 끝나는 조각의 종료 시각(초) — 정리 타이머 기준
  for (let i = 0; i < count; i++) {
    const dur = 2 + Math.random() * 2.2;
    const delay = Math.random() * 0.8;
    if (dur + delay > last) last = dur + delay;
    frag.append(el('span', {
      class: 'fx-confetti',
      style: {
        left: `${Math.random() * 100}vw`,
        background: colors[i % colors.length],
        '--rot': `${360 + Math.random() * 720}deg`,
        '--dur': `${dur}s`,
        animationDelay: `${delay}s`,
      },
    }));
  }
  box.append(frag);
  layer.append(box);
  setTimeout(() => box.remove(), (last + 0.3) * 1000);
}

// ---- 전체화면 ---------------------------------------------------------------
export function toggleFullscreen() {
  const doc = document;
  if (!doc.fullscreenElement && doc.documentElement.requestFullscreen) {
    doc.documentElement.requestFullscreen()
      .then(() => {
        // 가능하면 가로로 잠금 — Android 등 지원 브라우저에서 동작, iOS는 조용히 무시
        try { screen.orientation?.lock?.('landscape')?.catch(() => {}); } catch { /* 미지원 */ }
      })
      .catch(() => {});
    return true;
  }
  if (doc.fullscreenElement && doc.exitFullscreen) {
    try { screen.orientation?.unlock?.(); } catch { /* noop */ }
    doc.exitFullscreen().catch(() => {});
  }
  return false;
}

export function fullscreenSupported() {
  return !!document.documentElement.requestFullscreen;
}
