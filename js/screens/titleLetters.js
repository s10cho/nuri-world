// 타이틀 화면에 떠다니는 한글 자모 레이어
// 글자 목록은 public/assets/data/title_letters.csv 에서 읽어온다(코드 수정 없이 편집 가능).
import { el } from '../ui.js';

const CSV_URL = 'assets/data/title_letters.csv';

// 아주 작은 CSV 파서 — '#'로 시작하는 주석줄과 빈 줄은 건너뛴다.
// 값에 쉼표/따옴표가 없는 단순 CSV 전용(이 데이터에 맞춘 최소 구현).
/**
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
function parseCSV(text) {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',').map(c => c.trim());
    /** @type {Record<string, string>} */
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

// size(vmin 기준 숫자) → 반응형 font-size clamp 문자열
// 하한(px)을 넉넉히 둬서 vmin이 작은 모바일에서도 글자가 충분히 크게 보이도록 한다.
/** @param {number} size */
function fontSizeFor(size) {
  const min = Math.round(size * 4.2);
  const max = Math.round(size * 9);
  return `clamp(${min}px, ${size}vmin, ${max}px)`;
}

// CSV의 anim 값 → 허용된 움직임 클래스(오타/미지정 시 drift로 폴백)
const ANIMS = new Set(['drift', 'sway', 'orbit', 'bob', 'wobble']);
/** @param {string} anim */
function animClass(anim) {
  const key = (anim || '').trim();
  return `jamo--${ANIMS.has(key) ? key : 'drift'}`;
}

/**
 * 하나의 떠다니는 자모 엘리먼트를 만든다.
 * @param {Record<string, string>} row
 * @returns {HTMLElement}
 */
function makeLetter(row) {
  const node = el('span', {
    class: `jamo ${animClass(row.anim)}`,
    'aria-hidden': 'true',
    style: {
      left: `${row.left}%`,
      top: `${row.top}%`,
      color: row.color || '#fff',
      fontSize: fontSizeFor(Number(row.size) || 6),
      animationDuration: `${Number(row.dur) || 6}s`,
      animationDelay: `${Number(row.delay) || 0}s`,
    },
  }, row.char);
  // CSS 커스텀 프로퍼티는 Object.assign(style)로 설정되지 않으므로 직접 지정
  node.style.setProperty('--rot', `${Number(row.rot) || 0}deg`);
  if (row.name) node.setAttribute('aria-label', row.name);
  return node;
}

/**
 * 자모 레이어를 만들어 반환하고, CSV를 비동기로 읽어 채운다.
 * CSV 로드 실패 시 조용히 비워둔다(화면은 정상 동작).
 * @returns {HTMLElement} .jamo-layer 컨테이너
 */
export function floatingLetters() {
  const layer = el('div', { class: 'jamo-layer', 'aria-hidden': 'true' });
  fetch(CSV_URL)
    .then(res => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then(text => {
      if (!layer.isConnected) return; // 이미 화면을 벗어났으면 무시
      for (const row of parseCSV(text)) {
        if (row.char) layer.append(makeLetter(row));
      }
    })
    .catch(err => console.warn('[title] 자모 CSV 로드 실패:', err));
  return layer;
}
