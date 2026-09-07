// 기념 네컷 — 축제에서 만드는 "우리 아이가 해냈다" 기념 카드.
//
// 인생네컷처럼 네 칸에 여정을 담아 한 장으로 만든다. 카메라는 쓰지 않는다 —
// 이 앱은 만 5세 이하 대상이고 "데이터 수집 없음"으로 신고돼 있어, 촬영 기능은
// 권한과 심사 부담을 함께 들여온다. 대신 아이가 실제로 모은 것으로 채운다.
//
// 저장: 웹은 곧바로 내려받고, 앱은 공유 시트로 넘겨 사용자가 사진에 저장한다
// (둘 다 추가 권한이 필요 없다).
import { el, modal, sleep } from '../ui.js';
import { NATIVE } from '../platform.js';
import { store } from '../store.js';
import { sfx } from '../audio.js';
import {
  ALL_CONSONANTS, ALL_VOWELS, TOWER_STAGES, VILLAGE_STAGES, CELEBRATIONS,
} from '../data.js';

const ALL_JAMO = [...ALL_CONSONANTS, ...ALL_VOWELS];
const SYLLABLES = TOWER_STAGES.flatMap(st => st.targets);
const RESIDENTS = VILLAGE_STAGES.flatMap(st => st.words);

const W = 900;
const H = 1020;
const CREAM = '#fff6e3';
const WOOD = '#b9762f';
const INK = '#4a3423';

/** @param {string} src @returns {Promise<HTMLImageElement|null>} */
function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // 그림이 없어도 카드는 만들어져야 한다
    img.src = src;
  });
}

/**
 * 가운데 정렬 텍스트
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text @param {number} x @param {number} y
 * @param {string} font @param {string} [color]
 */
function centerText(ctx, text, x, y, font, color = INK) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/**
 * 둥근 사각형 칸
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h @param {string} fill
 */
function cell(ctx, x, y, w, h, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 26);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(185, 118, 47, 0.55)';
  ctx.stroke();
}

/**
 * 기념 카드를 그린다.
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function drawMemento() {
  // 자체 호스팅 글꼴이 준비되기 전에 그리면 기본 글꼴로 찍힌다
  try { await document.fonts.ready; } catch { /* 지원 안 하면 그냥 진행 */ }

  const s = store.get();
  const collected = new Set(s.jamo);
  const rescued = new Set(s.residents);
  const jamoCount = ALL_JAMO.filter(ch => collected.has(ch)).length;
  const sylCount = SYLLABLES.filter(t => collected.has(t.s)).length;
  const friends = RESIDENTS.filter(r => rescued.has(r.w));

  const canvas = /** @type {HTMLCanvasElement} */ (el('canvas'));
  canvas.width = W;
  canvas.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

  // 바탕 — 크림색 종이에 나무 테두리
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, CREAM);
  bg.addColorStop(1, '#fdeecd');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 18;
  ctx.strokeStyle = WOOD;
  ctx.strokeRect(9, 9, W - 18, H - 18);

  // 머리말
  centerText(ctx, '누리의 한글 왕국', W / 2, 92, '700 58px Jua, sans-serif', WOOD);
  centerText(ctx, '왕국을 되찾았어요!', W / 2, 152, '700 40px Jua, sans-serif');

  // 네 칸
  const pad = 46;
  const gap = 22;
  const cw = (W - pad * 2 - gap) / 2;
  const ch = 330;
  const top = 200;
  const pos = [
    [pad, top], [pad + cw + gap, top],
    [pad, top + ch + gap], [pad + cw + gap, top + ch + gap],
  ];
  const tint = ['#ffe9b8', '#d8ecff', '#e2f7d8', '#ffdfe8'];
  pos.forEach(([x, y], i) => cell(ctx, x, y, cw, ch, tint[i]));

  // 1컷 — 함께 기뻐하는 누리와 포리
  const hero = await loadImage(CELEBRATIONS[0]);
  if (hero) {
    const [x, y] = pos[0];
    const scale = Math.min((cw - 30) / hero.width, (ch - 80) / hero.height);
    const dw = hero.width * scale;
    const dh = hero.height * scale;
    ctx.drawImage(hero, x + (cw - dw) / 2, y + 24, dw, dh);
  }
  centerText(ctx, '함께 해냈어요', pos[0][0] + cw / 2, pos[0][1] + ch - 34, '700 34px Jua, sans-serif');

  // 2컷 — 모은 별
  const maxStars = Object.values(s.stars).flat().length * 3;
  centerText(ctx, '⭐', pos[1][0] + cw / 2, pos[1][1] + 108, '110px sans-serif');
  centerText(ctx, `${store.totalStars()} / ${maxStars}`, pos[1][0] + cw / 2, pos[1][1] + 210, '700 62px Jua, sans-serif');
  centerText(ctx, '모은 별', pos[1][0] + cw / 2, pos[1][1] + ch - 34, '700 34px Jua, sans-serif');

  // 3컷 — 자모와 만든 글자
  centerText(ctx, `✨ ${jamoCount} / ${ALL_JAMO.length}`, pos[2][0] + cw / 2, pos[2][1] + 104, '700 50px Jua, sans-serif');
  centerText(ctx, '모은 자모', pos[2][0] + cw / 2, pos[2][1] + 150, '600 28px Jua, sans-serif');
  centerText(ctx, `🧩 ${sylCount} / ${SYLLABLES.length}`, pos[2][0] + cw / 2, pos[2][1] + 218, '700 50px Jua, sans-serif');
  centerText(ctx, '만든 글자', pos[2][0] + cw / 2, pos[2][1] + ch - 34, '700 34px Jua, sans-serif');

  // 4컷 — 구출한 친구들
  const cols = 5;
  const shown = friends.slice(0, 15);
  shown.forEach((f, i) => {
    const cx = pos[3][0] + cw / 2 + ((i % cols) - (cols - 1) / 2) * 68;
    const cy = pos[3][1] + 66 + Math.floor(i / cols) * 72;
    centerText(ctx, f.e, cx, cy, '52px sans-serif');
  });
  centerText(ctx, `구출한 친구 ${friends.length}명`, pos[3][0] + cw / 2, pos[3][1] + ch - 34, '700 34px Jua, sans-serif');

  // 꼬리말 — 마무리 문구와 날짜
  centerText(ctx, '한글 왕국을 되찾은 날 🎉', W / 2, H - 96, '700 36px Jua, sans-serif', WOOD);
  const d = new Date();
  const stamp = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  centerText(ctx, stamp, W / 2, H - 46, '600 30px Jua, sans-serif', 'rgba(74, 52, 35, 0.65)');

  return canvas;
}

/** @param {HTMLCanvasElement} canvas @returns {Promise<Blob|null>} */
function toBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png'));
}

/**
 * 저장 — 웹은 내려받기, 앱은 공유 시트(사용자가 사진에 저장)
 * @param {HTMLCanvasElement} canvas @param {HTMLElement} statusEl
 */
async function saveCard(canvas, statusEl) {
  const blob = await toBlob(canvas);
  if (!blob) { statusEl.textContent = '이미지를 만들지 못했어요.'; return; }
  const name = `누리의한글왕국-기념네컷-${new Date().toISOString().slice(0, 10)}.png`;

  if (!NATIVE) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    statusEl.textContent = '내려받았어요!';
    return;
  }

  // 네이티브: 파일로 쓴 뒤 공유 시트로 넘긴다. 갤러리 쓰기 권한이 필요 없다.
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const base64 = await /** @type {Promise<string>} */ (new Promise(res => {
      const r = new FileReader();
      r.onloadend = () => res(String(r.result).split(',')[1]);
      r.readAsDataURL(blob);
    }));
    const written = await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache });
    await Share.share({ title: '누리의 한글 왕국 기념 네컷', files: [written.uri] });
    statusEl.textContent = '';
  } catch {
    statusEl.textContent = '저장을 지원하지 않는 기기예요.';
  }
}

/** 기념 네컷 모달 열기 */
export async function openMemento() {
  const status = el('div', { class: 'memento-status' }, '기념 네컷을 만드는 중…');
  const holder = el('div', { class: 'memento-holder' });
  const saveBtn = /** @type {HTMLButtonElement} */ (el('button', { class: 'btn-big', disabled: 'true' }, '💾 저장하기'));

  const close = modal([
    el('h2', {}, '📸 기념 네컷'),
    holder,
    status,
    el('div', { class: 'memento-actions' },
      el('button', { class: 'btn-big secondary', onclick: () => { sfx('tap'); close(); } }, '닫기'),
      saveBtn,
    ),
  ], { className: 'memento-modal' });

  // 그리는 동안 한 박자 — 모달이 먼저 뜨고 나서 캔버스가 채워진다
  await sleep(50);
  const canvas = await drawMemento();
  canvas.className = 'memento-canvas';
  holder.append(canvas);
  status.textContent = '';
  saveBtn.disabled = false;
  saveBtn.onclick = () => { sfx('chime'); saveCard(canvas, status); };
}
