// 이름 완성 — 사라진 글자를 찾아 주민 구출 (이름 없는 마을)
import { el, cardColor, shuffle, sample, fxBurstAt, fxConfetti, sleep } from '../ui.js';
import { speak, sfx } from '../audio.js';
import { store } from '../store.js';
import { VILLAGE_STAGES } from '../data.js';

// 오답 보기 후보: 모든 마을 단어의 음절 모음
const SYLLABLE_POOL = [...new Set(
  VILLAGE_STAGES.flatMap(st => st.words.flatMap(w => [...w.w])),
)];

/**
 * @param {GameContext} ctx
 * @param {{ words: Word[] }} opts
 * @returns {Promise<GameResult>}
 */
export function runWord({ area, signal }, { words }) {
  return new Promise(resolve => {
    signal.addEventListener('abort', () => resolve({ mistakes }), { once: true });
    let idx = 0;
    let mistakes = 0;
    let seq = 0; // 문항 순번 — 지연 프롬프트가 다음 문항으로 넘어간 뒤 재생되는 것 방지

    function ask() {
      const mySeq = ++seq;
      const { w, e } = words[idx];
      const chars = [...w];
      const blankIdx = Math.floor(Math.random() * chars.length);
      const answer = chars[blankIdx];

      const prompt = () => speak(`${w}! 사라진 글자를 찾아 ${w} 이름을 완성해 주세요!`, { signal });

      const tiles = chars.map((ch, i) =>
        el('div', { class: `word-tile ${i === blankIdx ? 'blank' : ''}` }, i === blankIdx ? '?' : ch),
      );

      const wrongChoices = sample(SYLLABLE_POOL.filter(s => s !== answer && !chars.includes(s)), 2);
      const options = shuffle([answer, ...wrongChoices]);
      let solved = false;

      const choiceCards = options.map((ch, i) =>
        el('button', {
          class: `letter-card ${cardColor(i + idx)}`,
          dataset: { ch },
          onclick: async (/** @type {Event} */ ev) => {
            if (solved || signal.aborted) return;
            const btn = /** @type {HTMLElement} */ (ev.currentTarget);
            if (ch === answer) {
              solved = true;
              sfx('correct');
              btn.classList.add('correct');
              choiceCards.forEach(c => { if (c !== btn) c.classList.add('dim'); });
              const blank = tiles[blankIdx];
              blank.textContent = answer;
              blank.classList.add('filled');
              fxBurstAt(blank, ['⭐', '✨', '💛']);
              const isNew = store.addResident(w);
              sfx('chime');
              await speak(`${w}! ${isNew ? `${w}를 구했어요! 정말 잘했어요!` : '이름을 완성했어요!'}`, { signal });
              if (signal.aborted) return;
              idx += 1;
              if (idx >= words.length) {
                fxConfetti(40);
                await speak('마을 친구들이 모두 웃을 수 있게 됐어요!', { signal });
                if (signal.aborted) return;
                resolve({ mistakes });
              } else ask();
            } else {
              mistakes += 1;
              sfx('wrong');
              btn.classList.add('wrong');
              setTimeout(() => btn.classList.remove('wrong'), 500);
              speak('음, 다른 글자 같아요. 소리를 다시 들어 볼까요?', { signal });
            }
          },
        }, ch),
      );

      area.replaceChildren(
        el('div', { class: 'prompt-bar' },
          el('button', { class: 'btn-speaker pulse', onclick: () => { sfx('tap'); prompt(); } }, '🔊'),
          el('span', {}, `이름을 완성해 친구를 구해요! (${idx + 1} / ${words.length})`),
        ),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: 'clamp(18px, 4vmin, 44px)', flexWrap: 'wrap', justifyContent: 'center' } },
          el('span', { class: 'word-emoji' }, e),
          el('div', { class: 'word-display' }, tiles),
        ),
        el('div', { class: 'choices' }, choiceCards),
        el('div', { class: 'round-dots' },
          words.map((_, i) => el('span', { class: 'dot' + (i < idx ? ' done' : i === idx ? ' now' : '') })),
        ),
      );

      sleep(400, signal).then(() => { if (!signal.aborted && mySeq === seq) prompt(); });
    }

    ask();
  });
}
