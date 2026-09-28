// 기념 네컷 — 축제에서 만드는 "우리 아이가 해냈다" 기념 카드.
//
// 인생네컷처럼 네 칸에 여정을 담아 한 장으로 만든다. 기본은 아이가 실제로 모은 것
// (별·자모·구출한 친구)으로 채우고, "사진 찍기"를 누르면 전면 카메라로 네 번 찍어
// 각 칸을 사진으로 바꾸고 여정 기록은 스티커처럼 얹는다.
//
// 카메라 사진은 이 모달 안의 캔버스에서만 합성한다 — localStorage 에도 남기지 않고
// 기기 밖으로도 보내지 않는다. 만 5세 이하 대상 앱이고 "데이터 수집 없음"으로 신고돼
// 있어서, 이 약속이 깨지면 스토어 개인정보 답안(store/README.md)도 바꿔야 한다.
// 모달을 닫으면 카메라도 곧바로 끈다.
//
// 저장: 웹은 곧바로 내려받고, 앱은 기기 사진첩(갤러리)에 바로 넣는다.
// iOS 는 '사진 추가' 권한만, Android 는 권한 없이 앱 앨범에 쓴다(사진첩을 읽지 않는다).
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
/** Android 갤러리에 보일 앨범 이름 */
const GALLERY_ALBUM = '누리의 한글 왕국';

// 네 칸 배치 — 카드와 카메라 미리보기가 같은 비율을 써야 찍은 그대로 담긴다
const PAD = 46;
const GAP = 22;
const CELL_W = (W - PAD * 2 - GAP) / 2;
const CELL_H = 330;
const CELL_TOP = 200;
/** 촬영 해상도 — 칸의 두 배로 찍어 고해상도 화면에서도 또렷하게 */
const PHOTO_W = Math.round(CELL_W * 2);
const PHOTO_H = CELL_H * 2;
export const SHOTS = 4;
const COUNTDOWN = 3;

/**
 * 원본을 대상 비율에 꽉 채우도록 가운데를 잘라낼 영역(object-fit: cover 와 같은 계산)
 * @param {number} srcW @param {number} srcH @param {number} dstW @param {number} dstH
 * @returns {{ sx: number, sy: number, sw: number, sh: number }}
 */
export function coverCrop(srcW, srcH, dstW, dstH) {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const sw = dstW / scale;
  const sh = dstH / scale;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

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
 * 사진 칸 — 둥근 칸 모양으로 잘라 꽉 채운다
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {HTMLCanvasElement} photo
 */
function photoCell(ctx, x, y, w, h, photo) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 26);
  ctx.clip();
  const { sx, sy, sw, sh } = coverCrop(photo.width, photo.height, w, h);
  ctx.drawImage(photo, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 26);
  ctx.lineWidth = 6;
  ctx.strokeStyle = CREAM;
  ctx.stroke();
}

/**
 * 사진 위 이름표 — 크림색 알약 위에 글씨
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text @param {number} cx @param {number} cy
 */
function badge(ctx, text, cx, cy) {
  ctx.font = '700 30px Jua, sans-serif';
  const w = ctx.measureText(text).width + 40;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - 26, w, 52, 26);
  ctx.fillStyle = 'rgba(255, 246, 227, 0.92)';
  ctx.fill();
  centerText(ctx, text, cx, cy + 1, '700 30px Jua, sans-serif');
}

/**
 * 여정 네컷 — 사진 없이 아이가 모은 것으로 채운 기본 카드
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[][]} pos
 * @param {{ hero: HTMLImageElement|null, maxStars: number, jamoCount: number, sylCount: number,
 *   friends: { e: string }[] }} info
 */
function drawJourneyCells(ctx, pos, { hero, maxStars, jamoCount, sylCount, friends }) {
  const cw = CELL_W;
  const ch = CELL_H;
  const tint = ['#ffe9b8', '#d8ecff', '#e2f7d8', '#ffdfe8'];
  pos.forEach(([x, y], i) => cell(ctx, x, y, cw, ch, tint[i]));

  // 1컷 — 함께 기뻐하는 누리와 포리
  if (hero) {
    const [x, y] = pos[0];
    const scale = Math.min((cw - 30) / hero.width, (ch - 80) / hero.height);
    const dw = hero.width * scale;
    const dh = hero.height * scale;
    ctx.drawImage(hero, x + (cw - dw) / 2, y + 24, dw, dh);
  }
  centerText(ctx, '함께 해냈어요', pos[0][0] + cw / 2, pos[0][1] + ch - 34, '700 34px Jua, sans-serif');

  // 2컷 — 모은 별
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
  friends.slice(0, 15).forEach((f, i) => {
    const cx = pos[3][0] + cw / 2 + ((i % cols) - (cols - 1) / 2) * 68;
    const cy = pos[3][1] + 66 + Math.floor(i / cols) * 72;
    centerText(ctx, f.e, cx, cy, '52px sans-serif');
  });
  centerText(ctx, `구출한 친구 ${friends.length}명`, pos[3][0] + cw / 2, pos[3][1] + ch - 34, '700 34px Jua, sans-serif');
}

/**
 * 기념 카드를 그린다.
 * @param {HTMLCanvasElement[] | null} [photos] 카메라로 찍은 네 장 — 있으면 칸을 사진으로 채운다
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function drawMemento(photos = null) {
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
  const cw = CELL_W;
  const ch = CELL_H;
  const pos = [
    [PAD, CELL_TOP], [PAD + cw + GAP, CELL_TOP],
    [PAD, CELL_TOP + ch + GAP], [PAD + cw + GAP, CELL_TOP + ch + GAP],
  ];
  const maxStars = Object.values(s.stars).flat().length * 3;
  const hero = await loadImage(CELEBRATIONS[0]);

  if (photos && photos.length >= SHOTS) {
    // 사진 네컷 — 사진 위에 여정 기록을 스티커처럼 얹는다
    pos.forEach(([x, y], i) => photoCell(ctx, x, y, cw, ch, photos[i]));
    if (hero) {
      const [x, y] = pos[0];
      const scale = 130 / Math.max(hero.width, hero.height);
      ctx.drawImage(hero, x + cw - hero.width * scale - 10, y + 10, hero.width * scale, hero.height * scale);
    }
    friends.slice(0, 4).forEach((f, i) => {
      centerText(ctx, f.e, pos[3][0] + cw - 40 - i * 50, pos[3][1] + 42, '42px sans-serif');
    });
    const labels = [
      '함께 해냈어요',
      `⭐ 별 ${store.totalStars()} / ${maxStars}`,
      `✨ 자모 ${jamoCount} · 🧩 글자 ${sylCount}`,
      `구출한 친구 ${friends.length}명`,
    ];
    pos.forEach(([x, y], i) => badge(ctx, labels[i], x + cw / 2, y + ch - 40));
  } else {
    drawJourneyCells(ctx, pos, { hero, maxStars, jamoCount, sylCount, friends });
  }

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
 * 저장 — 웹은 내려받기, 앱은 기기 사진첩(갤러리)에 곧바로 저장한다
 * @param {HTMLCanvasElement} canvas @param {HTMLElement} statusEl
 */
async function saveCard(canvas, statusEl) {
  const blob = await toBlob(canvas);
  if (!blob) { statusEl.textContent = '이미지를 만들지 못했어요.'; return; }
  const base = `누리의한글왕국-기념네컷-${new Date().toISOString().slice(0, 10)}`;
  const name = `${base}.png`;

  if (!NATIVE) {
    // 브라우저는 사진첩에 직접 쓸 수 없다 — 내려받기가 최선이다
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    statusEl.textContent = '내려받았어요!';
    return;
  }

  // 네이티브: 캐시에 파일로 쓴 뒤 그 파일을 사진첩에 넣는다.
  // iOS 는 '추가 전용' 권한만 요청해 사진첩을 읽지 않는다. Android 는 앱 전용 미디어 폴더의
  // 앨범에 저장하고 미디어 스캔을 걸어 갤러리에 나타나게 한다(저장소 권한 불필요).
  statusEl.textContent = '사진첩에 저장하는 중…';
  /** @type {string | null} */
  let fileUri = null;
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const base64 = await /** @type {Promise<string>} */ (new Promise(res => {
      const r = new FileReader();
      r.onloadend = () => res(String(r.result).split(',')[1]);
      r.readAsDataURL(blob);
    }));
    // 캐시 파일명은 ASCII 로 — iOS 플러그인이 경로를 URL(string:)로 읽어 한글이 있으면 실패할 수 있다
    const cacheName = `nuri-memento-${Date.now()}.png`;
    fileUri = (await Filesystem.writeFile({ path: cacheName, data: base64, directory: Directory.Cache })).uri;

    const { Media } = await import('@capacitor-community/media');
    /** @type {{ path: string, albumIdentifier?: string, fileName?: string }} */
    const opts = { path: fileUri };
    if (/** @type {any} */ (window).Capacitor?.getPlatform?.() === 'android') {
      const { path } = await Media.getAlbumsPath();
      const album = `${path}/${GALLERY_ALBUM}`;
      await Media.createAlbum({ name: GALLERY_ALBUM }).catch(() => { /* 이미 있으면 그대로 쓴다 */ });
      opts.albumIdentifier = album;
      opts.fileName = `${base}-${Date.now()}`;
    }
    await Media.savePhoto(opts);
    statusEl.textContent = '사진첩에 저장했어요! 📸';
  } catch (err) {
    if (/** @type {any} */ (err)?.code === 'accessDenied') {
      statusEl.textContent = '사진 저장이 허용되지 않았어요. 기기 설정에서 사진 접근을 허용해 주세요.';
      return;
    }
    // 그 밖의 실패는 공유 시트로 넘겨 사용자가 직접 저장할 수 있게 한다
    try {
      if (!fileUri) throw err;
      const { Share } = await import('@capacitor/share');
      await Share.share({ title: '누리의 한글 왕국 기념 네컷', files: [fileUri] });
      statusEl.textContent = '';
    } catch {
      statusEl.textContent = '저장을 지원하지 않는 기기예요.';
    }
  }
}

// ---- 카메라 ----------------------------------------------------------------

/**
 * 전면 카메라를 켠다. 실패하면 아이·보호자가 읽을 안내 문구를 던진다.
 * @returns {Promise<MediaStream>}
 */
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('이 기기에서는 카메라를 쓸 수 없어요.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
  } catch (err) {
    const name = /** @type {any} */ (err)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('카메라를 쓸 수 없어요. 기기 설정에서 카메라를 허용해 주세요.', { cause: err });
    }
    throw new Error('카메라를 찾지 못했어요.', { cause: err });
  }
}

/** @param {MediaStream | null} stream */
function stopCamera(stream) {
  stream?.getTracks().forEach(t => t.stop());
}

/**
 * 지금 화면을 한 장 찍는다 — 미리보기처럼 좌우를 뒤집어(거울) 칸 비율로 잘라 담는다
 * @param {HTMLVideoElement} video
 * @returns {HTMLCanvasElement}
 */
function capture(video) {
  const shot = /** @type {HTMLCanvasElement} */ (el('canvas'));
  shot.width = PHOTO_W;
  shot.height = PHOTO_H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (shot.getContext('2d'));
  const { sx, sy, sw, sh } = coverCrop(video.videoWidth, video.videoHeight, PHOTO_W, PHOTO_H);
  ctx.translate(PHOTO_W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, PHOTO_W, PHOTO_H);
  return shot;
}

/** 기념 네컷 모달 열기 */
export async function openMemento() {
  const status = el('div', { class: 'memento-status' }, '기념 네컷을 만드는 중…');
  const holder = el('div', { class: 'memento-holder' });
  const actions = el('div', { class: 'memento-actions' });

  /** @type {MediaStream | null} */
  let stream = null;
  let closed = false;
  /** 촬영 세션 번호 — 취소·닫기로 올라가면 진행 중인 카운트다운이 멈춘다 */
  let session = 0;

  const close = modal([
    el('h2', {}, '📸 기념 네컷'),
    holder,
    status,
    actions,
  ], {
    className: 'memento-modal',
    onClose: () => { closed = true; session++; stopCamera(stream); stream = null; },
  });

  /** @param {string} label @param {() => void} onclick @param {boolean} [secondary] */
  const button = (label, onclick, secondary = false) => /** @type {HTMLButtonElement} */ (
    el('button', { class: secondary ? 'btn-big secondary' : 'btn-big', onclick }, label)
  );

  /** 카드 보기 — 사진이 있으면 사진 네컷, 없으면 여정 네컷 */
  const showCard = async (/** @type {HTMLCanvasElement[] | null} */ photos = null) => {
    stopCamera(stream);
    stream = null;
    status.textContent = '기념 네컷을 만드는 중…';
    const saveBtn = button('💾 저장하기', () => {});
    saveBtn.disabled = true;
    // 좁은 화면에선 사진 버튼이 윗줄 전체를 쓴다 — 세 개가 한 줄이면 모달 밖으로 넘친다(style.css)
    const photoBtn = button(photos ? '📷 다시 찍기' : '📷 사진 찍기', () => { sfx('tap'); showCamera(); }, true);
    photoBtn.classList.add('memento-photo-btn');
    actions.replaceChildren(
      photoBtn,
      button('닫기', () => { sfx('tap'); close(); }, true),
      saveBtn,
    );
    // 그리는 동안 한 박자 — 모달이 먼저 뜨고 나서 캔버스가 채워진다
    await sleep(50);
    const canvas = await drawMemento(photos);
    if (closed) return;
    canvas.className = 'memento-canvas';
    holder.replaceChildren(canvas);
    status.textContent = '';
    saveBtn.disabled = false;
    saveBtn.onclick = () => { sfx('chime'); saveCard(canvas, status); };
  };

  /** 카메라 보기 — 미리보기와 찍기 버튼 */
  const showCamera = async () => {
    const my = ++session;
    const video = /** @type {HTMLVideoElement} */ (el('video', { class: 'memento-video', playsinline: '', autoplay: '' }));
    video.muted = true;
    video.playsInline = true;
    const count = el('div', { class: 'memento-count' });
    const flash = el('div', { class: 'memento-flash' });
    const thumbs = Array.from({ length: SHOTS }, () => el('div', { class: 'memento-thumb' }));
    const startBtn = button('📸 찍기 시작', () => {});
    startBtn.disabled = true;

    holder.replaceChildren(el('div', { class: 'memento-camera' },
      el('div', { class: 'memento-view' }, video, count, flash),
      el('div', { class: 'memento-thumbs' }, thumbs),
    ));
    actions.replaceChildren(
      button('취소', () => { sfx('tap'); session++; showCard(); }, true),
      startBtn,
    );
    status.textContent = '카메라를 켜는 중…';

    try {
      stream = await startCamera();
    } catch (err) {
      if (my !== session) return;
      holder.replaceChildren();
      status.textContent = /** @type {Error} */ (err).message;
      actions.replaceChildren(button('돌아가기', () => { sfx('tap'); showCard(); }, true));
      return;
    }
    // 켜는 사이에 닫았거나 취소했으면 바로 끈다
    if (my !== session) { stopCamera(stream); stream = null; return; }
    video.srcObject = stream;
    try { await video.play(); } catch { /* autoplay 속성으로 재생된다 */ }
    status.textContent = `${SHOTS}번 찍어요. 준비되면 눌러 주세요!`;
    startBtn.disabled = false;

    startBtn.onclick = async () => {
      sfx('tap');
      startBtn.disabled = true;
      /** @type {HTMLCanvasElement[]} */
      const photos = [];
      for (let i = 0; i < SHOTS; i++) {
        status.textContent = `${i + 1}번째 사진`;
        for (let n = COUNTDOWN; n > 0; n--) {
          count.textContent = String(n);
          count.classList.remove('tick');
          void count.offsetWidth; // 숫자마다 튀는 애니메이션을 다시 건다
          count.classList.add('tick');
          sfx('tap');
          await sleep(800);
          if (my !== session) return;
        }
        count.textContent = '';
        const shot = capture(video);
        photos.push(shot);
        sfx('shutter');
        flash.classList.remove('on');
        void flash.offsetWidth;
        flash.classList.add('on');
        shot.className = 'memento-thumb-img';
        thumbs[i].replaceChildren(shot);
        await sleep(700);
        if (my !== session) return;
      }
      sfx('chime');
      showCard(photos);
    };
  };

  showCard();
}
