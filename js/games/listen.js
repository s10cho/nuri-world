// 소리 듣고 글자 찾기 — 듣기 변별 게임
import { el, cardColor, shuffle, fxBurstAt, sleep } from '../ui.js';
import { speak, sfx, hasVoiceAsset } from '../audio.js';
import { JAMO } from '../data.js';
import { objectParticle, pickDistractors } from '../hangul.js';

const PRAISE = ['딩동댕! 잘 찾았어요!', '우와, 정말 잘 들었어요!', '맞아요! 멋져요!', '열심히 듣더니 해냈어요!'];
const RETRY = ['괜찮아요, 다시 한번 들어 볼까요?', '음, 소리를 한 번 더 들어 보세요!'];

/**
 * @param {GameContext} ctx
 * @param {{ pool: string[], focus: string[], rounds?: number }} opts
 * @returns {Promise<GameResult>}
 */
export function runListen({ area, signal }, { pool, focus, rounds = 4 }) {
  return new Promise(resolve => {
    let round = 0;
    let mistakes = 0;
    let seq = 0; // 라운드 순번 — 지연 프롬프트가 다음 라운드로 넘어간 뒤 재생되는 것 방지

    // 화면 이탈(signal abort) 시 게임을 종료해 stage 루프의 await가 멈추지 않게 한다
    signal.addEventListener('abort', () => resolve({ mistakes }), { once: true });

    // 새로 배운 글자(focus)가 골고루 나오도록 출제 순서 구성
    /** @type {string[]} */
    const targets = [];
    const focusShuffled = shuffle(focus);
    for (let i = 0; i < rounds; i++) targets.push(focusShuffled[i % focusShuffled.length]);

    function ask() {
      const mySeq = ++seq;
      const target = targets[round];
      const name = JAMO[target].name;
      // 자모 이름 단독 녹음(예: "이응")이 있으면 그걸 재생 — TTS가 불안정/무음인 기기에서도
      // 목표 소리가 확실히 들리게 한다. 문장 프롬프트는 녹음이 없어 TTS에만 의존해 무음 위험.
      const nameRecorded = hasVoiceAsset(name);
      const prompt = () => nameRecorded
        ? speak(name, { signal })
        : speak(`${name}! ${name}${objectParticle(name)} 찾아 주세요.`, { signal });
      // 녹음 파일이 유일하게 보장되는 소리원(源) — 녹음이 있으면 그 소리를 재생(모델 숨김),
      // 없으면(예: 유·으·이) TTS에만 의존해 무음일 수 있으니 목표 글자를 화면에 보여 줘
      // 소리 없이도 반드시 풀 수 있게 한다.
      const showModel = !nameRecorded;

      // 보기 3개: 정답 + 오답 2개. 오답은 정답과 발음이 비슷한 자모(예: ㅖ/ㅒ)를
      // 제외해 소리로 고르기 어려운 문제가 되지 않게 한다.
      const wrongs = pickDistractors(pool, target, 2);
      const options = shuffle([target, ...wrongs]);

      const spk = el('button', { class: 'btn-speaker pulse', onclick: () => { sfx('tap'); prompt(); } }, '🔊');
      let solved = false;

      const cards = options.map((ch, i) =>
        el('button', {
          class: `letter-card ${cardColor(i + round)}`,
          dataset: { ch },
          onclick: async (/** @type {Event} */ e) => {
            if (solved || signal.aborted) return;
            const cardEl = /** @type {HTMLElement} */ (e.currentTarget);
            if (ch === target) {
              solved = true;
              sfx('correct');
              cardEl.classList.add('correct');
              cards.forEach(c => { if (c !== cardEl) c.classList.add('dim'); });
              fxBurstAt(cardEl, ['⭐', '✨', '💛']);
              await speak(PRAISE[Math.floor(Math.random() * PRAISE.length)], { signal });
              if (signal.aborted) return;
              round += 1;
              if (round >= rounds) resolve({ mistakes });
              else ask();
            } else {
              mistakes += 1;
              sfx('wrong');
              cardEl.classList.add('wrong');
              setTimeout(() => cardEl.classList.remove('wrong'), 500);
              speak(RETRY[Math.floor(Math.random() * RETRY.length)], { signal });
            }
          },
        }, ch),
      );

      // TTS 없을 때만: 찾아야 할 목표 글자를 모델로 표시
      const modelRow = showModel
        ? el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' } },
            el('div', { class: 'ribbon', style: { padding: '4px 18px' } }, '이 글자를 찾아요!'),
            el('div', { class: `letter-card ${cardColor(round)}`, dataset: { ch: target }, style: { pointerEvents: 'none' } }, target),
          )
        : null;

      area.replaceChildren(.../** @type {HTMLElement[]} */ ([
        el('div', { class: 'prompt-bar' }, spk,
          el('span', {}, showModel ? '같은 글자를 찾아 보세요!' : '어떤 글자의 소리일까요? 잘 듣고 찾아 보세요!')),
        modelRow,
        el('div', { class: 'choices' }, cards),
        el('div', { class: 'round-dots' },
          targets.map((_, i) => el('span', { class: 'dot' + (i < round ? ' done' : i === round ? ' now' : '') })),
        ),
      ].filter(Boolean)));

      sleep(400, signal).then(() => { if (!signal.aborted && mySeq === seq) prompt(); });
    }

    ask();
  });
}
