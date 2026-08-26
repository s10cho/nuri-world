// 글자 조합 — 자음 + 모음 조각으로 글자 만들기 (글자 조각의 탑)
import { el, cardColor, shuffle, fxBurstAt, sleep } from '../ui.js';
import { speak, sfx, canSpeak } from '../audio.js';
import { store } from '../store.js';
import { decompose, objectParticle, pickDistractors } from '../hangul.js';
import { ALL_CONSONANTS, ALL_VOWELS } from '../data.js';

const PRAISE = ['글자가 태어났어요!', '우와, 멋진 글자를 만들었어요!', '조각을 딱 맞췄네요, 대단해요!'];

/**
 * @param {GameContext} ctx
 * @param {{ targets: TowerTarget[] }} opts
 * @returns {Promise<GameResult>}
 */
export function runBuild({ area, signal }, { targets }) {
  return new Promise(resolve => {
    signal.addEventListener('abort', () => resolve({ mistakes }), { once: true });
    let idx = 0;
    let mistakes = 0;
    let seq = 0; // 문항 순번 — 지연 프롬프트가 다음 문항으로 넘어간 뒤 재생되는 것 방지
    // 안내 문장은 한 곳에서 만든다 — 아래 showModel 판단과 실제 재생이 어긋나지 않게.
    /** @param {TowerTarget} t */
    const promptLine = t => `${t.s}! ${t.w}의 ${t.s}. 조각을 모아 ${t.s}${objectParticle(t.s)} 만들어 보세요!`;
    // 목표 글자를 흐리게 보여 주는 '시각 대체'는 소리를 낼 방법이 아예 없을 때만 켠다.
    // 안내 문장 녹음이 있으면 기기에 한국어 TTS가 없어도 들려줄 수 있다.
    const showModel = !targets.every(t => canSpeak(promptLine(t)));

    function ask() {
      const mySeq = ++seq;
      const t = targets[idx];
      const parts = decompose(t.s);
      if (!parts) return; // 커리큘럼은 유효 음절만 출제하므로 실제로는 도달하지 않음
      const { cho, jung } = parts;

      const prompt = () => speak(promptLine(t), { signal });

      // 소리로 들려줄 수 없을 때만 목표 글자를 흐리게 표시, 아니면 '?'로 가려 소리로 유추
      const targetBox = el('div', {
        class: 'build-target',
        style: showModel ? { color: 'rgba(74,52,35,0.35)' } : {},
      }, showModel ? t.s : '?');
      const choSlot = el('div', { class: 'build-slot' }, '?');
      const jungSlot = el('div', { class: 'build-slot' }, '?');
      let choDone = false, jungDone = false, finished = false;

      async function checkDone() {
        if (!choDone || !jungDone || finished) return;
        finished = true;
        sfx('snap');
        targetBox.textContent = t.s;
        targetBox.style.color = '';
        targetBox.classList.add('done');
        store.addJamo(t.s); // 완성한 글자를 도감에 점진적으로 등록
        fxBurstAt(targetBox, ['✨', '⭐', '🧩']);
        // 단어 연결 보여주기
        wordReveal.replaceChildren(
          el('span', { class: 'word-emoji', style: { fontSize: 'clamp(3rem, 8vmin, 5rem)' } }, t.e),
          el('span', { class: 'word-label', style: { fontSize: 'clamp(1.5rem, 3.6vmin, 2.2rem)' } }, t.w),
        );
        wordReveal.style.visibility = 'visible';
        wordReveal.animate(
          [{ transform: 'scale(0.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
          { duration: 400, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
        );
        sfx('correct');
        await speak(`${t.s}! ${t.w}의 ${t.s}! ${PRAISE[idx % PRAISE.length]}`, { signal });
        await sleep(600, signal);
        if (signal.aborted) return;
        idx += 1;
        if (idx >= targets.length) resolve({ mistakes });
        else ask();
      }

      /** @param {string} ch @param {'cho'|'jung'} kind @param {number} i */
      function makeChoice(ch, kind, i) {
        return el('button', {
          class: `letter-card compact ${cardColor(i)}`,
          dataset: { ch },
          onclick: (/** @type {Event} */ e) => {
            if (finished || signal.aborted) return;
            const elBtn = /** @type {HTMLElement} */ (e.currentTarget);
            const need = kind === 'cho' ? cho : jung;
            const already = kind === 'cho' ? choDone : jungDone;
            if (already) return;
            if (ch === need) {
              sfx('snap');
              elBtn.classList.add('correct');
              setTimeout(() => elBtn.classList.add('dim'), 400);
              const slot = kind === 'cho' ? choSlot : jungSlot;
              slot.textContent = ch;
              slot.classList.add('filled');
              if (kind === 'cho') choDone = true; else jungDone = true;
              fxBurstAt(slot, ['✨']);
              checkDone();
            } else {
              mistakes += 1;
              sfx('wrong');
              elBtn.classList.add('wrong');
              setTimeout(() => elBtn.classList.remove('wrong'), 500);
              speak('그 조각이 아니에요. 다시 골라 볼까요?', { signal });
            }
          },
        }, ch);
      }

      // 오답 조각은 정답과 발음이 비슷한 모음(예: ㅖ/ㅒ)을 함께 내지 않는다.
      const choOptions = shuffle([cho, ...pickDistractors(ALL_CONSONANTS, cho, 2)]);
      const jungOptions = shuffle([jung, ...pickDistractors(ALL_VOWELS, jung, 2)]);

      // 단어 공개 카드 — 목표 글자 옆에 자리를 미리 잡아 두고 성공 시 표시
      const wordReveal = el('div', {
        class: 'panel',
        style: {
          visibility: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px',
          width: 'clamp(110px, 17vmin, 170px)', height: 'clamp(140px, 24vmin, 230px)', padding: '10px',
        },
      });

      area.replaceChildren(
        el('div', { class: 'prompt-bar' },
          el('button', { class: 'btn-speaker pulse', onclick: () => { sfx('tap'); prompt(); } }, '🔊'),
          el('span', {}, `조각을 맞춰 글자를 만들어요! (${idx + 1} / ${targets.length})`),
        ),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: 'clamp(14px, 3vmin, 30px)', flexWrap: 'wrap', justifyContent: 'center' } },
          el('div', { class: 'build-slots' }, choSlot, el('span', {}, '＋'), jungSlot, el('span', {}, '＝')),
          targetBox,
          wordReveal,
        ),
        el('div', { class: 'choices' },
          el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' } },
            el('div', { class: 'ribbon', style: { padding: '4px 18px', fontSize: '0.95rem' } }, '자음 조각'),
            el('div', { class: 'choices' }, choOptions.map((c, i) => makeChoice(c, 'cho', i))),
          ),
          el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' } },
            el('div', { class: 'ribbon', style: { padding: '4px 18px', fontSize: '0.95rem' } }, '모음 조각'),
            el('div', { class: 'choices' }, jungOptions.map((v, i) => makeChoice(v, 'jung', i + 3))),
          ),
        ),
      );

      sleep(400, signal).then(() => { if (!signal.aborted && mySeq === seq) prompt(); });
    }

    ask();
  });
}
