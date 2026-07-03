// 도감 — 모은 자모, 만든 글자, 구출한 주민
import { register, go } from '../app.js';
import { el, topbar, iconBtn } from '../ui.js';
import { store } from '../store.js';
import { speak, sfx } from '../audio.js';
import { JAMO, ALL_CONSONANTS, ALL_VOWELS, TOWER_STAGES, VILLAGE_STAGES } from '../data.js';
import { demoSyllable } from '../hangul.js';

const ALL_JAMO = [...ALL_CONSONANTS, ...ALL_VOWELS];
const SYLLABLES = TOWER_STAGES.flatMap(st => st.targets);
const RESIDENTS = VILLAGE_STAGES.flatMap(st => st.words);

function render() {
  const s = el('div', {
    style: { backgroundImage: 'url(public/assets/images/backgrounds/world_map.jpg)' },
  });

  const grid = el('div', { class: 'dex-grid panel', style: { flex: '1', minHeight: '0', margin: '0 clamp(12px, 4vw, 60px) 16px', padding: '10px' } });

  const collected = new Set(store.get().jamo);
  const rescued = new Set(store.get().residents);
  const jamoCount = ALL_JAMO.filter(ch => collected.has(ch)).length;
  const sylCount = SYLLABLES.filter(t => collected.has(t.s)).length;

  let tab = 'jamo';

  function item({ has, glyph, label, onSpeak }) {
    return el('button', {
      class: `dex-item ${has ? '' : 'locked'}`,
      onclick: () => {
        if (!has) { sfx('wrong'); return; }
        sfx('tap');
        onSpeak();
      },
    },
      el('span', { class: 'g' }, glyph),
      el('span', { class: 'n' }, has ? label : '???'),
    );
  }

  function renderGrid() {
    grid.replaceChildren();
    if (tab === 'jamo') {
      ALL_JAMO.forEach(ch => grid.append(item({
        has: collected.has(ch),
        glyph: ch,
        label: JAMO[ch].name,
        onSpeak: () => speak(`${JAMO[ch].name}! ${JAMO[ch].words[0].w}의 ${demoSyllable(ch)}.`),
      })));
    } else if (tab === 'syl') {
      SYLLABLES.forEach(t => grid.append(item({
        has: collected.has(t.s),
        glyph: t.s,
        label: `${t.e} ${t.w}`,
        onSpeak: () => speak(`${t.s}! ${t.w}의 ${t.s}.`),
      })));
    } else {
      RESIDENTS.forEach(({ w, e }) => grid.append(item({
        has: rescued.has(w),
        glyph: e,
        label: w,
        onSpeak: () => speak(w),
      })));
    }
  }

  const tabs = [
    { id: 'jamo', label: `✨ 자모 (${jamoCount}/${ALL_JAMO.length})` },
    { id: 'syl',  label: `🧩 만든 글자 (${sylCount}/${SYLLABLES.length})` },
    { id: 'res',  label: `🏡 주민 (${rescued.size}/${RESIDENTS.length})` },
  ].map(t => {
    const btn = el('button', {
      class: `dex-tab ${t.id === tab ? 'active' : ''}`,
      onclick: () => {
        sfx('tap');
        tab = t.id;
        s.querySelectorAll('.dex-tab').forEach(b => b.classList.toggle('active', b === btn));
        renderGrid();
      },
    }, t.label);
    return btn;
  });

  s.append(
    el('div', { class: 'scrim' }),
    topbar({
      left: [iconBtn('◀', '뒤로', () => { sfx('tap'); go('map'); })],
      right: [iconBtn('🏠', '홈', () => { sfx('tap'); go('title'); })],
    }),
    el('div', { style: { position: 'relative', zIndex: '2', display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0', gap: '8px', paddingTop: '4px' } },
      el('div', { style: { textAlign: 'center' } }, el('div', { class: 'sign' }, '📖 누리의 도감')),
      el('div', { class: 'dex-tabs' }, tabs),
      grid,
    ),
  );

  renderGrid();
  s._onShow = () => speak('내가 모은 글자와 친구들이에요. 눌러 보면 소리를 들려줘요!');
  return s;
}

register('dex', render);
