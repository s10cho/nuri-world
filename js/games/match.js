// 글자 짝 맞추기 — 카드 뒤집기 기억 게임
import { el, shuffle, sample, fxBurstAt } from '../ui.js';
import { speak, sfx } from '../audio.js';
import { JAMO } from '../data.js';

/**
 * @param {GameContext} ctx
 * @param {{ jamoList: string[] }} opts
 * @returns {Promise<GameResult>}
 */
export function runMatch({ area, signal }, { jamoList }) {
  return new Promise(resolve => {
    // 유아 대상이라 최대 3쌍(6장)으로 부담을 낮춤
    const chosen = sample(jamoList, Math.min(3, jamoList.length));
    const deck = shuffle([...chosen, ...chosen]);
    const cols = deck.length <= 6 ? 3 : 4;

    /** @type {HTMLElement | null} */
    let openCard = null;
    let lock = true; // 시작 미리보기 동안 잠금
    let matched = 0;
    let mistakes = 0;

    // 화면 이탈(signal abort) 시 게임 종료
    signal.addEventListener('abort', () => resolve({ mistakes }), { once: true });

    const cards = deck.map(ch => {
      const card = el('button', { class: 'mem-card' },
        el('div', { class: 'inner' },
          el('div', { class: 'face back' }, '⭐'),
          el('div', { class: 'face front' }, ch),
        ),
      );
      card.dataset.ch = ch;
      card.addEventListener('click', async () => {
        if (lock || card.classList.contains('open')) return;
        sfx('flip');
        card.classList.add('open');

        if (!openCard) {
          openCard = card;
          return;
        }
        // 두 번째 카드
        lock = true;
        const first = openCard;
        openCard = null;
        if (first.dataset.ch === ch) {
          matched += 1;
          setTimeout(() => {
            if (signal.aborted) return;
            sfx('correct');
            first.classList.add('matched');
            card.classList.add('matched');
            fxBurstAt(card, ['✨', '💚']);
            speak(`${JAMO[ch].name}! 짝을 찾았어요!`);
            lock = false;
            if (matched === chosen.length) {
              setTimeout(() => resolve({ mistakes }), 900);
            }
          }, 350);
        } else {
          mistakes += 1;
          sfx('wrong');
          setTimeout(() => {
            if (signal.aborted) return;
            first.classList.remove('open');
            card.classList.remove('open');
            lock = false;
          }, 900);
        }
      });
      return card;
    });

    area.replaceChildren(
      el('div', { class: 'prompt-bar' },
        el('button', { class: 'btn-speaker', onclick: () => speak('카드를 뒤집어서 같은 글자 짝을 찾아 보세요!') }, '🔊'),
        el('span', {}, '같은 글자 짝을 찾아 보세요!'),
      ),
      el('div', { class: 'memory-grid', style: { '--cols': cols } }, cards),
    );

    // 시작 미리보기: 모든 카드를 잠깐 보여 준 뒤 뒤집어 기억 게임 시작 (유아 난이도 완화)
    cards.forEach(c => c.classList.add('open'));
    speak('잘 봐요! 어디에 같은 글자가 있을까요?');
    setTimeout(() => {
      if (signal.aborted) return;
      cards.forEach(c => c.classList.remove('open'));
      lock = false;
      speak('이제 같은 글자 짝을 찾아 보세요!');
    }, 1800);
  });
}
