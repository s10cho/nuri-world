// 화면 레이아웃 전수 검사 — 가로 화면이 짧은 기기에서 버튼이 잘리는지 본다.
//
//   npm run audit:layout                                  # 로컬 dev 서버(5173)
//   APP_URL=https://s10cho.github.io/nuri-world/ npm run audit:layout
//
// 앱은 html,body { overflow: hidden } 이라 넘치는 내용이 스크롤되지 않고 '잘린다'.
// 화면 밖으로 밀린 버튼은 아예 누를 수 없으므로, 기기별 가로 해상도를 흉내 내
// 조작 요소가 뷰포트를 벗어나는지, 마지막 큰 버튼이 바닥에 얼마나 붙는지 잰다.
//
// 화면마다 한 번만 부팅하고 해상도만 바꿔 가며 잰다(레이아웃은 CSS가 결정하므로 유효하다).

process.env.APP_URL ||= 'http://localhost:5173/nuri-world/';

const {
  APP_URL, SCENES, withChrome, seedProgress, bootToTitle, runSteps, sleep, probe,
} = await import('./app-drive.mjs');

// 가로로 눕힌 실제 기기 폭×높이(CSS 픽셀). 높이가 짧은 순으로 둔다.
const VIEWPORTS = [
  { w: 640,  h: 360, name: '640×360  저가 폰' },
  { w: 740,  h: 360, name: '740×360  보급형 폰' },
  { w: 851,  h: 393, name: '851×393  iPhone 15' },
  { w: 896,  h: 414, name: '896×414  큰 폰' },
  { w: 1024, h: 600, name: '1024×600 작은 태블릿' },
  { w: 1280, h: 800, name: '1280×800 태블릿' },
];

/** 마지막 큰 버튼이 바닥에 이보다 가까우면 답답하다고 본다(px) */
const TIGHT = 12;

// 눌러야 하는 것들. 이 중 하나라도 뷰포트를 벗어나면 게임이 진행 불가가 된다.
const TAPPABLE = 'button, .btn-big, .map-spot, .stage-pad, .letter-card, .choice, .dex-cell';

const MEASURE = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const visible = el => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = el => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 18)
    || (el.className || el.tagName).toString().split(' ')[0].slice(0, 18);
  // 스크롤되는 조상이 있으면 화면 밖이어도 '스크롤하면 닿는다'. 도감처럼 원래 긴 목록이 그렇다.
  // 조상이 없으면 html,body { overflow:hidden } 때문에 영영 못 누른다 — 이쪽이 진짜 문제다.
  const scrollableAncestor = el => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return true;
    }
    return false;
  };

  const off = [];
  for (const el of document.querySelectorAll(${JSON.stringify(TAPPABLE)})) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const out = {
      bottom: Math.round(r.bottom - vh),
      top: Math.round(-r.top),
      right: Math.round(r.right - vw),
      left: Math.round(-r.left),
    };
    const worst = Math.max(out.bottom, out.top, out.right, out.left);
    if (worst > 1) off.push({ label: label(el), ...out, worst, scrollable: scrollableAncestor(el) });
  }
  off.sort((a, b) => b.worst - a.worst);

  const bigs = [...document.querySelectorAll('.btn-big')].filter(visible);
  const last = bigs[bigs.length - 1];

  return {
    vw, vh,
    stuck: off.filter(o => !o.scrollable).slice(0, 6),   // 스크롤로도 못 닿음 — 치명
    needScroll: off.filter(o => o.scrollable).length,    // 스크롤하면 닿음 — 참고
    bottomGap: last ? Math.round(vh - last.getBoundingClientRect().bottom) : null,
    lastBtn: last ? label(last) : null,
  };
})()`;

const rows = [];

await withChrome({ width: 1280, height: 800 }, async cdp => {
  console.log(`대상: ${APP_URL}\n`);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
  });
  await seedProgress(cdp);

  for (const scene of SCENES) {
    await bootToTitle(cdp, scene.id);
    await runSteps(cdp, scene.steps, scene.id);
    const where = await cdp.eval(probe);
    console.log(`\n■ ${scene.id.padEnd(8)} ${scene.desc}  [${where}]`);

    for (const v of VIEWPORTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: v.w, height: v.h, deviceScaleFactor: 1, mobile: false,
      });
      await sleep(450); // 리사이즈 후 재배치 대기
      const m = await cdp.eval(MEASURE);
      rows.push({ scene: scene.id, vp: v.name, ...m });

      const flags = [];
      if (m.stuck.length) {
        flags.push(`못 누름 ${m.stuck.length}개 → ` + m.stuck
          .map(o => `${o.label}(${['bottom', 'top', 'right', 'left']
            .filter(k => o[k] > 1).map(k => `${k} ${o[k]}px`).join(',')})`)
          .join(' / '));
      }
      if (m.bottomGap !== null && m.bottomGap < TIGHT && m.bottomGap >= 0) {
        flags.push(`바닥여백 ${m.bottomGap}px (${m.lastBtn})`);
      }
      const note = m.needScroll ? ` (스크롤하면 닿는 것 ${m.needScroll}개)` : '';
      console.log(`   ${v.name.padEnd(22)} ${flags.length ? '\u26a0 ' + flags.join(' | ') : '\u2713'}${note}`);
    }
    // 다음 화면 부팅은 넓은 화면에서 시작한다(좁은 상태로 부팅하면 단계 클릭이 어긋날 수 있다)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
    });
  }
});

// ---- 요약 -------------------------------------------------------------------
const stuck = rows.filter(r => r.stuck.length);
const tight = rows.filter(r => r.bottomGap !== null && r.bottomGap < TIGHT && r.bottomGap >= 0);
console.log(`\n${'='.repeat(70)}`);
console.log(`검사: 화면 ${SCENES.length}개 × 해상도 ${VIEWPORTS.length}개 = ${rows.length}건`);
console.log(`스크롤로도 못 누르는 요소가 있는 조합: ${stuck.length}건`);
console.log(`마지막 버튼 바닥여백 ${TIGHT}px 미만: ${tight.length}건`);
if (stuck.length) {
  console.log('\n[못 누름]');
  for (const r of stuck) console.log(`  ${r.scene.padEnd(8)} ${r.vp.padEnd(22)} ${r.stuck.map(o => `${o.label} ${o.worst}px`).join(', ')}`);
}
if (tight.length) {
  console.log('\n[바닥에 붙음]');
  for (const r of tight) console.log(`  ${r.scene.padEnd(8)} ${r.vp.padEnd(22)} ${r.bottomGap}px  ${r.lastBtn}`);
}
process.exitCode = stuck.length ? 1 : 0;
