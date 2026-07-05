// 최종 보스전 — 배운 글자로 지우개 몬스터 물리치기
import { el, cardColor, shuffle, sample, fxBurstAt, fxConfetti, sleep } from '../ui.js';
import { speak, sfx, hasKoreanTTS } from '../audio.js';
import { JAMO, ALL_CONSONANTS, ALL_VOWELS, TOWER_STAGES, VILLAGE_STAGES, CHARACTERS } from '../data.js';
import { objectParticle } from '../hangul.js';

const HP_MAX = 8;

// 오답 시 부드러운 격려 (유아 대상이라 조롱 대신 응원)
const RETRY = ['괜찮아요! 다시 한번 들어 볼까요?', '거의 다 왔어요! 한 번 더 들어 봐요!', '천천히 다시 골라 볼까요?'];

/**
 * 보스전 문제 — type으로 판별하는 유니온
 * @typedef {{ type: 'jamo', target: string, pool: string[] }
 *   | { type: 'syllable', target: TowerTarget }
 *   | { type: 'word', target: Word }} BossQuestion
 */

// 문제 생성: 배운 내용 전체에서 골고루
/** @returns {BossQuestion[]} */
function makeQuestions() {
  /** @type {BossQuestion[]} */
  const qs = [];
  // 자모 듣기 문제 4개 (자음 2, 모음 2)
  sample(ALL_CONSONANTS, 2).forEach(ch => qs.push({ type: 'jamo', target: ch, pool: ALL_CONSONANTS }));
  sample(ALL_VOWELS, 2).forEach(ch => qs.push({ type: 'jamo', target: ch, pool: ALL_VOWELS }));
  // 음절 찾기 문제 2개 (탑에서 배운 글자)
  sample(TOWER_STAGES.flatMap(s => s.targets), 2).forEach(t => qs.push({ type: 'syllable', target: t }));
  // 단어 완성 문제 2개
  sample(VILLAGE_STAGES.flatMap(s => s.words), 2).forEach(w => qs.push({ type: 'word', target: w }));
  return shuffle(qs);
}

/**
 * @param {GameContext} ctx
 * @param {any} [_opts]
 * @returns {Promise<GameResult>}
 */
export function runBoss({ area, signal }, _opts) {
  return new Promise(resolve => {
    signal.addEventListener('abort', () => resolve({ mistakes }), { once: true });
    const questions = makeQuestions();
    let hp = HP_MAX;
    let qIdx = 0;
    let mistakes = 0;
    let seq = 0; // 문항 순번 — 지연 프롬프트가 다음 문항으로 넘어간 뒤 재생되는 것 방지
    const showModel = !hasKoreanTTS(); // TTS 없으면 목표 글자를 시각적으로 표시

    const boss = el('img', { class: 'boss-char', src: CHARACTERS.eraser, alt: '지우개 몬스터' });
    const hpFill = el('div', { class: 'fill' });
    const qArea = el('div', {
      style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'clamp(12px, 2.6vmin, 24px)', width: '100%' },
    });

    area.replaceChildren(
      el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' } },
        el('div', { class: 'boss-hp' }, hpFill),
        boss,
      ),
      qArea,
    );

    /** @param {HTMLElement} [btn] */
    async function hitBoss(btn) {
      hp -= 1;
      hpFill.style.width = `${(hp / HP_MAX) * 100}%`;
      sfx('hit');
      boss.classList.add('hurt');
      fxBurstAt(boss, ['💥', '⚡', '✨']);
      setTimeout(() => boss.classList.remove('hurt'), 700);
      if (btn) btn.classList.add('correct');
    }

    async function victory() {
      await speak('안 돼! 내가 지다니! 글자들을 돌려줄게!', { signal });
      if (signal.aborted) return;
      boss.classList.add('defeat');
      sfx('fanfare');
      await sleep(1500, signal);
      if (signal.aborted) return;
      fxConfetti(80);
      sfx('chime');
      await speak('와! 지우개 몬스터를 물리쳤어요! 왕국의 글자들이 모두 돌아와요!', { signal });
      if (signal.aborted) return;
      resolve({ mistakes });
    }

    function next() {
      if (hp <= 0) return victory();
      // 문제 소진 시 다시 생성해 계속
      if (qIdx >= questions.length) questions.push(...makeQuestions());
      const q = questions[qIdx];
      qIdx += 1;
      seq += 1;

      if (q.type === 'jamo') return askJamo(q);
      if (q.type === 'syllable') return askSyllable(q);
      return askWord(q);
    }

    /**
     * @param {string[]} options
     * @param {(opt: string) => boolean} isCorrect
     * @param {(opt: string) => string} describe
     * @param {Record<string, any>} [extraStyle]
     */
    function buildChoices(options, isCorrect, describe, extraStyle = {}) {
      let solved = false;
      const cards = options.map((opt, i) =>
        el('button', {
          class: `letter-card ${cardColor(i)}`,
          style: { width: 'clamp(80px, 12vmin, 128px)', height: 'clamp(80px, 12vmin, 128px)', fontSize: 'clamp(2rem, 6vmin, 3.6rem)', ...extraStyle },
          onclick: async (/** @type {Event} */ e) => {
            if (solved || signal.aborted) return;
            const btn = /** @type {HTMLElement} */ (e.currentTarget);
            if (isCorrect(opt)) {
              solved = true;
              sfx('correct');
              cards.forEach(c => { if (c !== btn) c.classList.add('dim'); });
              await hitBoss(btn);
              await speak(describe(opt), { signal });
              await sleep(300, signal);
              if (signal.aborted) return;
              next();
            } else {
              mistakes += 1;
              sfx('wrong');
              btn.classList.add('wrong');
              // 이미 고른 오답은 흐리게 비활성화해 같은 실수 반복·부정 피드백 누적 방지
              setTimeout(() => { btn.classList.remove('wrong'); btn.classList.add('dim'); }, 500);
              speak(RETRY[Math.floor(Math.random() * RETRY.length)], { signal });
            }
          },
        }, opt),
      );
      return cards;
    }

    // 목표 글자를 시각적으로 보여 주는 모델 (TTS 없을 때만)
    /** @param {string} glyph @returns {HTMLElement | null} */
    function modelBadge(glyph) {
      if (!showModel) return null;
      return el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' } },
        el('div', { class: 'ribbon', style: { padding: '4px 16px' } }, '이 글자로 공격!'),
        el('div', { class: 'letter-card c3', style: { pointerEvents: 'none', width: 'clamp(70px, 10vmin, 110px)', height: 'clamp(70px, 10vmin, 110px)', fontSize: 'clamp(2rem, 5.5vmin, 3.2rem)' } }, glyph),
      );
    }

    /** @param {{ type: 'jamo', target: string, pool: string[] }} q */
    function askJamo(q) {
      const mySeq = seq;
      const name = JAMO[q.target].name;
      const prompt = () => speak(`${name}! ${name}${objectParticle(name)} 찾아서 몬스터를 공격해요!`, { signal });
      const options = shuffle([q.target, ...sample(q.pool.filter(c => c !== q.target), 2)]);
      qArea.replaceChildren(.../** @type {HTMLElement[]} */ ([
        el('div', { class: 'prompt-bar' },
          el('button', { class: 'btn-speaker pulse', onclick: () => { sfx('tap'); prompt(); } }, '🔊'),
          el('span', {}, showModel ? '같은 글자로 공격!' : '소리에 맞는 글자로 공격!'),
        ),
        modelBadge(q.target),
        el('div', { class: 'choices' }, buildChoices(options, o => o === q.target, o => `${JAMO[o].name}! 명중이에요!`)),
      ].filter(Boolean)));
      sleep(350, signal).then(() => { if (!signal.aborted && mySeq === seq) prompt(); });
    }

    /** @param {{ type: 'syllable', target: TowerTarget }} q */
    function askSyllable(q) {
      const mySeq = seq;
      const t = q.target; // {s, w, e}
      const prompt = () => speak(`${t.w}의 ${t.s}! ${t.s}${objectParticle(t.s)} 찾아 공격해요!`, { signal });
      // 오답: 다른 음절 (헷갈리는 보기)
      /** @type {Set<string>} */
      const distractors = new Set();
      const all = TOWER_STAGES.flatMap(s => s.targets.map(x => x.s)).filter(s => s !== t.s);
      while (distractors.size < 2) {
        distractors.add(all[Math.floor(Math.random() * all.length)]);
      }
      const options = shuffle([t.s, ...distractors]);
      qArea.replaceChildren(.../** @type {HTMLElement[]} */ ([
        el('div', { class: 'prompt-bar' },
          el('button', { class: 'btn-speaker pulse', onclick: () => { sfx('tap'); prompt(); } }, '🔊'),
          el('span', {}, `${t.e} ${t.w}${showModel ? ` — ${t.s}` : ''}! 글자로 공격!`),
        ),
        modelBadge(t.s),
        el('div', { class: 'choices' }, buildChoices(options, o => o === t.s, o => `${o}! 명중이에요!`)),
      ].filter(Boolean)));
      sleep(350, signal).then(() => { if (!signal.aborted && mySeq === seq) prompt(); });
    }

    /** @param {{ type: 'word', target: Word }} q */
    function askWord(q) {
      const mySeq = seq;
      const { w, e } = q.target;
      const chars = [...w];
      const blankIdx = Math.floor(Math.random() * chars.length);
      const answer = chars[blankIdx];
      const prompt = () => speak(`${w}! ${w}의 사라진 글자를 찾아 공격해요!`, { signal });
      const pool = [...new Set(VILLAGE_STAGES.flatMap(s => s.words.flatMap(x => [...x.w])))]
        .filter(s => s !== answer && !chars.includes(s));
      const options = shuffle([answer, ...sample(pool, 2)]);
      // 빈칸 위치를 큼직한 타일로 표시 (작은 인라인 텍스트 대신)
      const tiles = chars.map((ch, i) =>
        el('div', { class: `word-tile ${i === blankIdx ? 'blank' : ''}` }, i === blankIdx ? '?' : ch),
      );
      qArea.replaceChildren(
        el('div', { class: 'prompt-bar' },
          el('button', { class: 'btn-speaker pulse', onclick: () => { sfx('tap'); prompt(); } }, '🔊'),
          el('span', {}, '사라진 글자를 찾아 공격!'),
        ),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: 'clamp(12px, 3vmin, 30px)', flexWrap: 'wrap', justifyContent: 'center' } },
          el('span', { class: 'word-emoji', style: { fontSize: 'clamp(3rem, 8vmin, 5rem)' } }, e),
          el('div', { class: 'word-display' }, tiles),
        ),
        el('div', { class: 'choices' }, buildChoices(options, o => o === answer, () => `${w}! 명중이에요!`)),
      );
      sleep(350, signal).then(() => { if (!signal.aborted && mySeq === seq) prompt(); });
    }

    speak('지우개 몬스터가 나타났어요! 배운 글자로 힘을 모아 공격해요!', { signal }).then(() => { if (!signal.aborted) next(); });
  });
}
