// 배우기 — 새 글자를 하나씩 만나기 (구체물 단어와 짝지어 소개)
import { el, cardColor, fxBurstAt, sleep } from '../ui.js';
import { speak, sfx } from '../audio.js';
import { store } from '../store.js';
import { JAMO, ALL_CONSONANTS } from '../data.js';

function introLine(ch) {
  const info = JAMO[ch];
  const word = info.words[0].w;
  if (ALL_CONSONANTS.includes(ch)) {
    // 자음: 예시 단어의 실제 첫 글자를 소리로 제시 (예시 단어는 그 자음으로 시작함)
    return `${info.name}! ${word[0]}, ${word}의 첫소리예요.`;
  }
  // 모음: 예시 단어에 담긴 모음 소리를 제시
  return `${info.name}! ${info.words[0].w}의 ${info.name} 소리예요.`;
}

export function runLearn({ area, screen }, { jamoList }) {
  return new Promise(resolve => {
    let idx = 0;
    let seq = 0; // 현재 카드 순번 — 지연 안내가 다음 카드로 넘어간 뒤 재생되는 것 방지

    function show() {
      const mySeq = ++seq;
      const ch = jamoList[idx];
      const info = JAMO[ch];
      // 도감에 점진적으로 등록 — 중도에 나가도 만난 글자는 기록됨
      store.addJamo(ch);

      const card = el('button', { class: `letter-card big ${cardColor(idx)}` }, ch);
      card.addEventListener('click', () => {
        sfx('tap');
        fxBurstAt(card, ['✨', '💫']);
        speak(introLine(ch));
      });

      const words = el('div', { class: 'choices' },
        info.words.map(w =>
          el('button', {
            class: 'panel',
            style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '14px 22px' },
            onclick: e => {
              sfx('tap');
              fxBurstAt(e.currentTarget, ['💛']);
              speak(w.w);
            },
          },
            el('span', { style: { fontSize: 'clamp(2.6rem, 7vmin, 4.4rem)', lineHeight: '1' } }, w.e),
            el('span', { style: { fontSize: 'clamp(1.1rem, 2.6vmin, 1.6rem)' } }, w.w),
          ),
        ),
      );

      const isLast = idx === jamoList.length - 1;
      const nextBtn = el('button', {
        class: 'btn-big',
        onclick: async () => {
          sfx('whoosh');
          idx += 1;
          if (idx >= jamoList.length) resolve({ mistakes: 0 });
          else show();
        },
      }, isLast ? '다 만났어요! ✅' : '다음 글자 ▶');

      area.replaceChildren(
        el('div', { class: 'prompt-bar' },
          el('button', { class: 'btn-speaker', onclick: () => speak(introLine(ch)) }, '🔊'),
          el('span', {}, '글자를 눌러서 소리를 들어 보세요!'),
        ),
        card,
        words,
        nextBtn,
      );

      card.animate(
        [{ transform: 'scale(0.5) rotate(-8deg)', opacity: 0 }, { transform: 'scale(1) rotate(0)', opacity: 1 }],
        { duration: 450, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
      );
      sleep(350).then(() => { if (!screen?._dead && mySeq === seq) speak(introLine(ch)); });
    }

    show();
  });
}
