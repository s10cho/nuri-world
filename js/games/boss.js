// 최종 보스전 — 배운 글자로 지우개 몬스터 물리치기
import { el, cardColor, shuffle, sample, fxBurstAt, fxConfetti, sleep } from '../ui.js';
import { speak, sfx, canSpeak, hasVoiceAsset } from '../audio.js';
import { JAMO, ALL_CONSONANTS, ALL_VOWELS, TOWER_STAGES, VILLAGE_STAGES, CHARACTERS, BATTLE_HERO } from '../data.js';
import { objectParticle, pickDistractors } from '../hangul.js';
import { store } from '../store.js';
import { heroEnergy } from '../difficulty.js';

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
    // 누리·포리 에너지 — 틀릴 때마다 1씩 줄고 0이면 실패. 양은 설정의 난이도(최소 별)로 정한다.
    const ENERGY_MAX = heroEnergy(store.minStars());
    let energy = ENERGY_MAX;
    let over = false; // 승리·실패로 끝났으면 더 이상 카드 입력을 받지 않는다

    // 보스전은 게이지·보스를 상단에 고정하고 아래 문제 영역만 바뀌도록 상단 정렬한다.
    // (문제 유형에 따라 2줄·3줄로 높이가 달라도 위쪽이 흔들리지 않게)
    area.classList.add('boss-stage');

    const boss = el('img', { class: 'boss-char', src: CHARACTERS.eraser, alt: '지우개 몬스터' });
    // 누리·포리 배틀 히어로 — 왼쪽 아래에서 마법으로 몬스터를 공격(정답 명중 시 돌진 연출)
    const heroes = el('img', { class: 'battle-hero', src: BATTLE_HERO, alt: '누리와 포리' });
    const hearts = Array.from({ length: ENERGY_MAX }, () => el('span', { class: 'heart' }, '💖'));
    // 하트가 많으면(쉬움 8개) 4개씩 두 줄로 고르게 — 한 줄이면 좁은 폰에서 7+1로 어색하게 감긴다
    const energyBar = el('div', {
      class: `hero-energy ${ENERGY_MAX > 5 ? 'many' : ''}`, role: 'img', 'aria-label': `에너지 ${energy}`,
    }, hearts);
    const heroBox = el('div', { class: 'battle-hero-box' }, energyBar, heroes);
    const hpFill = el('div', { class: 'fill' });
    // 문제 영역: 보스 아래 남는 공간을 flex로 모두 차지하고 내용을 세로 중앙 정렬한다.
    // → 보스·게이지는 위에 고정, 문제는 항상 같은 중앙 밴드에 놓여 2줄·3줄이어도 덜 흔들린다.
    const qArea = el('div', {
      style: { flex: '0.5 0.5 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'clamp(12px, 2.6vmin, 24px)', width: '100%' },
    });

    area.replaceChildren(
      heroBox,
      el('div', { class: 'boss-top', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' } },
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
      // 누리·포리 돌진 공격 연출 + 마법 파티클
      heroes.classList.add('attacking');
      fxBurstAt(heroes, ['✨', '⭐', '💫']);
      fxBurstAt(boss, ['💥', '⚡', '✨']);
      setTimeout(() => boss.classList.remove('hurt'), 700);
      setTimeout(() => heroes.classList.remove('attacking'), 600);
      if (btn) btn.classList.add('correct');
    }

    // 틀렸다 — 하트 하나를 잃고, 다 잃으면 실패로 끝낸다. 끝났으면 true.
    function loseEnergy() {
      energy -= 1;
      const lost = hearts[energy];
      if (lost) lost.classList.add('lost');
      energyBar.setAttribute('aria-label', `에너지 ${energy}`);
      heroes.classList.remove('hurt');
      void heroes.offsetWidth; // 연속으로 틀려도 휘청임을 다시 건다
      heroes.classList.add('hurt');
      setTimeout(() => heroes.classList.remove('hurt'), 600);
      if (energy > 0) return false;
      over = true;
      defeat();
      return true;
    }

    async function defeat() {
      seq += 1; // 예약된 문제 안내 음성이 뒤늦게 나오지 않게
      qArea.querySelectorAll('button').forEach(b => { /** @type {HTMLButtonElement} */ (b).disabled = true; });
      qArea.prepend(el('div', { class: 'ribbon energy-out' }, '💔 에너지가 다 떨어졌어요'));
      await sleep(500, signal);
      if (signal.aborted) return;
      sfx('laugh');
      boss.classList.add('taunt');
      heroes.classList.add('fainted');
      await sleep(1800, signal);
      if (signal.aborted) return;
      resolve({ mistakes, failed: true });
    }

    async function victory() {
      over = true;
      await speak('안 돼요! 내가 지다니! 글자들을 모두 돌려줄게요!', { signal });
      if (signal.aborted) return;
      boss.classList.add('defeat');
      heroes.classList.add('cheering');
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
          dataset: { ch: opt },
          style: { ...extraStyle },
          onclick: async (/** @type {Event} */ e) => {
            if (solved || over || signal.aborted) return;
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
              if (loseEnergy()) return; // 에너지가 바닥나 실패 — 격려 대신 실패 연출
              speak(RETRY[Math.floor(Math.random() * RETRY.length)], { signal });
            }
          },
        }, opt),
      );
      return cards;
    }

    // 목표 글자를 시각적으로 보여 주는 모델 — 그 문항을 소리로 들려줄 방법이 아예 없을 때만.
    // 문항마다 판단이 다르다: 자모 이름은 녹음이 있고 음절 안내 문장은 없을 수 있다.
    /** @param {string} glyph @param {boolean} showModel @returns {HTMLElement | null} */
    function modelBadge(glyph, showModel) {
      if (!showModel) return null;
      return el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' } },
        el('div', { class: 'ribbon', style: { padding: '4px 16px' } }, '이 글자로 공격!'),
        el('div', { class: 'letter-card compact c3', dataset: { ch: glyph }, style: { pointerEvents: 'none' } }, glyph),
      );
    }

    /** @param {{ type: 'jamo', target: string, pool: string[] }} q */
    function askJamo(q) {
      const mySeq = seq;
      const name = JAMO[q.target].name;
      // 자모 이름 단독 녹음이 있으면 그걸 재생(TTS 무음 기기 대비). 녹음이 없는 자모는 TTS로 읽어 준다.
      const nameRecorded = hasVoiceAsset(name);
      const prompt = () => nameRecorded
        ? speak(name, { signal })
        : speak(`${name}! ${name}${objectParticle(name)} 찾아서 몬스터를 공격해요!`, { signal });
      const showModel = !canSpeak(name);
      const options = shuffle([q.target, ...pickDistractors(q.pool, q.target, 2)]);
      qArea.replaceChildren(.../** @type {HTMLElement[]} */ ([
        el('div', { class: 'prompt-bar' },
          el('button', { class: 'btn-speaker pulse', onclick: () => { sfx('tap'); prompt(); } }, '🔊'),
          el('span', {}, showModel ? '같은 글자로 공격!' : '소리에 맞는 글자로 공격!'),
        ),
        modelBadge(q.target, showModel),
        el('div', { class: 'choices' }, buildChoices(options, o => o === q.target, o => `${JAMO[o].name}! 명중이에요!`)),
      ].filter(Boolean)));
      sleep(350, signal).then(() => { if (!signal.aborted && mySeq === seq) prompt(); });
    }

    /** @param {{ type: 'syllable', target: TowerTarget }} q */
    function askSyllable(q) {
      const mySeq = seq;
      const t = q.target; // {s, w, e}
      const promptLine = `${t.w}의 ${t.s}! ${t.s}${objectParticle(t.s)} 찾아 공격해요!`;
      const prompt = () => speak(promptLine, { signal });
      const showModel = !canSpeak(promptLine);
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
        modelBadge(t.s, showModel),
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
